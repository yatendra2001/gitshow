import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isAdminSession } from "@/lib/admin";
import { getSession } from "@/auth";
import { forceFailScan, listStaleScans } from "@/lib/admin-scan-control";

/**
 * POST /api/cron/reap-stale-scans
 *
 * Finds scans still in 'queued' / 'running' that haven't emitted any
 * scan_event in >IDLE_LIMIT_MS, force-fails them, and destroys their
 * Fly machine.
 *
 * Why MAX(scan_events.at) and not last_heartbeat: heartbeat runs on a
 * separate setInterval that keeps writing even when the pipeline's
 * await-stream is deadlocked. We hit this exact failure mode on
 * 2026-05-04 — Tanmay's scan heart-beat happily for 3 days while
 * `judge:tanmayyadav2323/astral-insights-site` was frozen mid-stream.
 * Real progress shows up as scan_events; if those stop, the scan is
 * stuck regardless of what `last_heartbeat` says.
 *
 * Authorization: Bearer ${CRON_SECRET} (shared with the domains-recheck
 * cron) OR a logged-in admin session (so it's also a one-click
 * "reap now" button from the admin panel via fetch).
 */

export const dynamic = "force-dynamic";

const IDLE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(req: Request) {
  const { env } = await getCloudflareContext({ async: true });

  // Two ways to authorize: cron secret bearer (for scheduled callers)
  // or a live admin session (so the operator can hit this from the
  // admin UI without provisioning a long-lived secret).
  const authorized = await isAuthorized(req, env);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const stale = await listStaleScans(env.DB, IDLE_LIMIT_MS);
  const reaped: Array<{
    scan_id: string;
    user_id: string;
    handle: string;
    last_event_at: number | null;
    machine_destroyed: boolean;
    machine_destroy_error?: string;
  }> = [];

  for (const row of stale) {
    const ageMs = Date.now() - (row.last_event_at ?? row.created_at);
    const result = await forceFailScan(
      env.DB,
      row.id,
      `auto-reaped: no scan events in ${Math.round(ageMs / 60000)}m (phase=${row.current_phase ?? "?"})`,
    );
    if (result.ok) {
      reaped.push({
        scan_id: row.id,
        user_id: row.user_id,
        handle: row.handle,
        last_event_at: row.last_event_at,
        machine_destroyed: result.machine_destroyed,
        ...(result.machine_destroy_error
          ? { machine_destroy_error: result.machine_destroy_error }
          : {}),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    idle_limit_ms: IDLE_LIMIT_MS,
    examined: stale.length,
    reaped: reaped.length,
    rows: reaped,
  });
}

async function isAuthorized(
  req: Request,
  env: CloudflareEnv,
): Promise<boolean> {
  // 1. Bearer token (cron caller).
  const auth = req.headers.get("authorization") ?? "";
  const optional = env as unknown as Record<string, string | undefined>;
  if (auth.startsWith("Bearer ") && optional.CRON_SECRET) {
    const presented = auth.slice(7).trim();
    if (presented === optional.CRON_SECRET) return true;
  }
  // 2. Admin session cookie (manual reap from the panel).
  const session = await getSession();
  if (isAdminSession(session)) return true;
  return false;
}
