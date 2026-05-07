import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { DEFAULT_SCAN_MODEL } from "@gitshow/shared/models";
import { requireAdminApi } from "@/lib/admin";
import { forceFailScan } from "@/lib/admin-scan-control";
import { getUserGitHubToken } from "@/lib/user-token";

/**
 * POST /api/admin/users/[userId]/rerun — operator-only.
 *
 * Force-cancels any in-flight scan for the user (destroys the Fly
 * machine + flips the row to failed) and spawns a fresh scan with the
 * same handle / socials / context_notes the user originally provided.
 * Used to recover from stuck scans without making the user click
 * "Restart" themselves.
 *
 * Auth: admin allowlist (lib/admin.ts) — same gate as the admin panel.
 *
 * Body:  ignored (we infer everything from the prior scan).
 *
 * Why we lift config from the prior scan: the user filled in their
 * intake fields once and we don't want to re-prompt. `socials_json` and
 * `context_notes` live on the scan row already; the handle is on the
 * user_profiles row (canonical) or — fallback — the user's GitHub
 * `login`.
 */

export const dynamic = "force-dynamic";

interface UserRow {
  id: string;
  login: string | null;
}

interface PriorScanConfig {
  handle: string;
  model: string | null;
  socials_json: string | null;
  context_notes: string | null;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { userId } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const user = await env.DB.prepare(
    `SELECT id, login FROM users WHERE id = ? LIMIT 1`,
  )
    .bind(userId)
    .first<UserRow>();
  if (!user) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  const ghToken = await getUserGitHubToken(env.DB, userId);
  if (!ghToken) {
    return NextResponse.json(
      { error: "no_github_token", detail: "User has no GitHub OAuth token on file." },
      { status: 422 },
    );
  }

  // Cancel any in-flight scan for this user. We allow a rerun even if
  // there's no prior scan (fresh start), so this loop is best-effort.
  const inflight = await env.DB.prepare(
    `SELECT id FROM scans
       WHERE user_id = ? AND status IN ('queued','running')
       ORDER BY created_at DESC`,
  )
    .bind(userId)
    .all<{ id: string }>();
  for (const row of inflight.results ?? []) {
    await forceFailScan(
      env.DB,
      row.id,
      `superseded by admin rerun (${gate.session.user.login ?? gate.session.user.id})`,
    );
  }

  // Pull config from the most recent scan if there is one — preserves
  // whatever socials / context_notes the user supplied at intake.
  const prior = await env.DB.prepare(
    `SELECT handle, model, socials_json, context_notes
       FROM scans WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<PriorScanConfig>();

  const handle = prior?.handle ?? user.login;
  if (!handle) {
    return NextResponse.json(
      { error: "no_handle", detail: "Cannot rerun without a GitHub handle." },
      { status: 422 },
    );
  }
  const model = prior?.model ?? DEFAULT_SCAN_MODEL;
  const socials = safeJsonObject(prior?.socials_json);

  const scanId = `scan-${nanoid(10)}`;
  const sessionId = `or-${nanoid(14)}`;
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO scans
       (id, user_id, handle, session_id, model, status, current_phase,
        cost_cents, llm_calls, socials_json, context_notes,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', NULL, 0, 0, ?, ?, ?, ?)`,
  )
    .bind(
      scanId,
      userId,
      handle,
      sessionId,
      model,
      prior?.socials_json ?? null,
      prior?.context_notes ?? null,
      now,
      now,
    )
    .run();

  try {
    const fly = FlyClient.fromEnv();
    const machine = await fly.spawnScanMachine({
      scanId,
      env: buildMachineEnv(env, {
        scanId,
        handle,
        model,
        twitter: socials.twitter,
        linkedin: socials.linkedin,
        website: socials.website,
        contextNotes: prior?.context_notes ?? undefined,
        userGhToken: ghToken,
      }),
    });
    await env.DB.prepare(
      `UPDATE scans SET fly_machine_id = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(machine.id, Date.now(), scanId)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await env.DB.prepare(
      `UPDATE scans SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(`fly spawn (admin rerun): ${msg.slice(0, 500)}`, Date.now(), scanId)
      .run();
    return NextResponse.json(
      { error: "spawn_failed", detail: msg, scan_id: scanId },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    superseded: (inflight.results ?? []).map((r) => r.id),
  });
}

function safeJsonObject(raw: string | null | undefined): {
  twitter?: string;
  linkedin?: string;
  website?: string;
} {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v ? v : {};
  } catch {
    return {};
  }
}

function buildMachineEnv(
  env: CloudflareEnv,
  s: {
    scanId: string;
    handle: string;
    model: string;
    twitter?: string;
    linkedin?: string;
    website?: string;
    contextNotes?: string;
    userGhToken: string;
  },
): Record<string, string> {
  const out: Record<string, string> = {
    SCAN_ID: s.scanId,
    HANDLE: s.handle,
    MODEL: s.model,
    PIPELINE: "resume",
    GITSHOW_CLOUD_MODE: "1",
    CF_ACCOUNT_ID: requireVar(env, "CF_ACCOUNT_ID"),
    CF_API_TOKEN: requireVar(env, "CF_API_TOKEN"),
    D1_DATABASE_ID: requireVar(env, "D1_DATABASE_ID"),
    R2_BUCKET_NAME: requireVar(env, "R2_BUCKET_NAME"),
    R2_ACCESS_KEY_ID: requireVar(env, "R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: requireVar(env, "R2_SECRET_ACCESS_KEY"),
    OPENROUTER_API_KEY: requireVar(env, "OPENROUTER_API_KEY"),
    GH_TOKEN: s.userGhToken,
  };
  if (s.twitter) out.TWITTER = s.twitter;
  if (s.linkedin) out.LINKEDIN = s.linkedin;
  if (s.website) out.WEBSITE = s.website;
  if (s.contextNotes) out.CONTEXT_NOTES = s.contextNotes;
  if (env.REALTIME_ENDPOINT) out.REALTIME_ENDPOINT = env.REALTIME_ENDPOINT;
  if (env.PIPELINE_SHARED_SECRET)
    out.PIPELINE_SHARED_SECRET = env.PIPELINE_SHARED_SECRET;
  const optional = env as unknown as Record<string, string | undefined>;
  if (optional.RESEND_API_KEY) out.RESEND_API_KEY = optional.RESEND_API_KEY;
  if (optional.EMAIL_FROM) out.EMAIL_FROM = optional.EMAIL_FROM;
  if (optional.PUBLIC_APP_URL) out.PUBLIC_APP_URL = optional.PUBLIC_APP_URL;
  if (optional.TINYFISH_API_KEY) out.TINYFISH_API_KEY = optional.TINYFISH_API_KEY;
  return out;
}

function requireVar(env: CloudflareEnv, name: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}
