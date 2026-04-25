import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";

/**
 * GET /api/scan/status/{scanId} — owner-only live scan status.
 *
 * Returns the scan row + the last N `scan_events` for rendering the
 * /app/scan/{scanId} progress page. Auth: the authenticated user must
 * own the scan (user_id match); anyone else gets 404.
 */

const EVENT_LIMIT = 200;

interface ScanRow {
  id: string;
  user_id: string;
  handle: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  current_phase: string | null;
  last_completed_phase: string | null;
  error: string | null;
  cost_cents: number;
  llm_calls: number;
  last_heartbeat: number | null;
  created_at: number;
  completed_at: number | null;
  /** JSON: { orgs: OrgAccess[], privateContributionsVisible: boolean } */
  access_state: string | null;
  /** JSON: { ownedRepos, orgRepos, contributionRepos, ... } */
  data_sources: string | null;
}

interface EventRow {
  id: number;
  kind: string;
  stage: string | null;
  worker: string | null;
  status: string | null;
  duration_ms: number | null;
  message: string | null;
  /** Rich payload for reasoning-delta / tool-* / source-added — JSON string. */
  data_json: string | null;
  /** Foreign key into reasoning_id or tool_id depending on event kind. */
  parent_id: string | null;
  /** Bounds a user-initiated turn — currently unused by the resume flow. */
  message_id: string | null;
  at: number;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ scanId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { scanId } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const scan = await env.DB.prepare(
    `SELECT id, user_id, handle, status, current_phase, last_completed_phase,
            error, cost_cents, llm_calls, last_heartbeat, created_at, completed_at,
            access_state, data_sources
       FROM scans WHERE id = ? AND user_id = ? LIMIT 1`,
  )
    .bind(scanId, session.user.id)
    .first<ScanRow>();

  if (!scan) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const events = await env.DB.prepare(
    `SELECT id, kind, stage, worker, status, duration_ms, message,
            data_json, parent_id, message_id, at
       FROM scan_events
       WHERE scan_id = ?
       ORDER BY at DESC, id DESC
       LIMIT ?`,
  )
    .bind(scanId, EVENT_LIMIT)
    .all<EventRow>();

  return NextResponse.json({
    scan: {
      id: scan.id,
      handle: scan.handle,
      status: scan.status,
      current_phase: scan.current_phase,
      last_completed_phase: scan.last_completed_phase,
      error: scan.error,
      cost_usd: scan.cost_cents / 100,
      llm_calls: scan.llm_calls,
      last_heartbeat: scan.last_heartbeat,
      created_at: scan.created_at,
      completed_at: scan.completed_at,
      access_state: safeParse(scan.access_state),
      data_sources: safeParse(scan.data_sources),
    },
    events: (events.results ?? []).reverse(),
  });
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
