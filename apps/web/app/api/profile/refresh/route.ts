import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { auth } from "@/auth";

/**
 * POST /api/profile/refresh
 *
 * Kicks off a fresh full scan for the authenticated user, reusing
 * their known handle from user_profiles. One-click "re-scan me" —
 * exactly the action a returning user wants to take every few weeks
 * to see their updated numbers.
 *
 * Throttle: at most one scan per 24h (guards against a tight loop
 * on a user double-click). The web UI can also just hide the button
 * while a scan is running.
 */

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const uid = session.user.id;

  // Look up the handle from user_profiles. First scan users must hit
  // /api/intake instead.
  const row = await env.DB.prepare(
    `SELECT handle, last_scan_at FROM user_profiles WHERE user_id = ? LIMIT 1`,
  )
    .bind(uid)
    .first<{ handle: string; last_scan_at: number | null }>();
  if (!row) {
    return NextResponse.json(
      {
        error: "no_profile_yet",
        detail: "Run the intake flow first — POST /api/intake.",
      },
      { status: 409 },
    );
  }

  // Block if they scanned in the last 24h.
  if (
    row.last_scan_at !== null &&
    Date.now() - row.last_scan_at < COOLDOWN_MS
  ) {
    const waitMs = COOLDOWN_MS - (Date.now() - row.last_scan_at);
    return NextResponse.json(
      {
        error: "cooldown",
        wait_minutes: Math.round(waitMs / 60_000),
      },
      { status: 429 },
    );
  }

  // Block if a scan is currently running.
  const running = await env.DB.prepare(
    `SELECT id FROM scans WHERE user_id = ? AND status IN ('queued','running') LIMIT 1`,
  )
    .bind(uid)
    .first<{ id: string }>();
  if (running) {
    return NextResponse.json(
      { error: "already_running", scanId: running.id },
      { status: 409 },
    );
  }

  const scanId = `scan-${nanoid(10)}`;
  const sessionId = `or-${nanoid(14)}`;
  const model = "anthropic/claude-sonnet-4.6";
  const now = Date.now();

  try {
    await env.DB.prepare(
      `INSERT INTO scans
         (id, user_id, handle, session_id, model, status, current_phase,
          cost_cents, llm_calls, socials_json, context_notes,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', NULL, 0, 0, NULL, ?, ?, ?)`,
    )
      .bind(
        scanId,
        uid,
        row.handle,
        sessionId,
        model,
        "Refresh scan — prior profile exists; look for meaningful deltas.",
        now,
        now,
      )
      .run();
  } catch (err) {
    return NextResponse.json(
      { error: "db", detail: (err as Error).message },
      { status: 500 },
    );
  }

  try {
    const fly = FlyClient.fromEnv();
    const machine = await fly.spawnScanMachine({
      scanId,
      env: buildEnv(env, { scanId, handle: row.handle, model }),
    });
    await env.DB.prepare(
      `UPDATE scans SET fly_machine_id = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(machine.id, Date.now(), scanId)
      .run();
  } catch (err) {
    await env.DB.prepare(
      `UPDATE scans SET status='failed', error=?, updated_at=? WHERE id=?`,
    )
      .bind(
        `fly spawn: ${(err as Error).message.slice(0, 500)}`,
        Date.now(),
        scanId,
      )
      .run();
    return NextResponse.json(
      { error: "spawn", detail: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ scanId }, { status: 201 });
}

function buildEnv(
  env: CloudflareEnv,
  s: { scanId: string; handle: string; model: string },
): Record<string, string> {
  const out: Record<string, string> = {
    SCAN_ID: s.scanId,
    HANDLE: s.handle,
    MODEL: s.model,
    GITSHOW_CLOUD_MODE: "1",
    CF_ACCOUNT_ID: require_(env, "CF_ACCOUNT_ID"),
    CF_API_TOKEN: require_(env, "CF_API_TOKEN"),
    D1_DATABASE_ID: require_(env, "D1_DATABASE_ID"),
    R2_BUCKET_NAME: require_(env, "R2_BUCKET_NAME"),
    R2_ACCESS_KEY_ID: require_(env, "R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: require_(env, "R2_SECRET_ACCESS_KEY"),
    OPENROUTER_API_KEY: require_(env, "OPENROUTER_API_KEY"),
    GH_TOKEN: require_(env, "GH_TOKEN"),
  };
  const opt = env as unknown as Record<string, string | undefined>;
  if (opt.REALTIME_ENDPOINT) out.REALTIME_ENDPOINT = opt.REALTIME_ENDPOINT;
  if (opt.PIPELINE_SHARED_SECRET)
    out.PIPELINE_SHARED_SECRET = opt.PIPELINE_SHARED_SECRET;
  if (opt.RESEND_API_KEY) out.RESEND_API_KEY = opt.RESEND_API_KEY;
  if (opt.EMAIL_FROM) out.EMAIL_FROM = opt.EMAIL_FROM;
  if (opt.PUBLIC_APP_URL) out.PUBLIC_APP_URL = opt.PUBLIC_APP_URL;
  return out;
}

function require_(env: CloudflareEnv, name: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}
