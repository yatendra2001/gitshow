import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import {
  draftResumeKey,
  publishedResumeKey,
} from "@/lib/resume-io";

/**
 * POST /api/profile/delete
 *
 * Wipes everything tied to the authenticated user:
 *   - scans (cascades: scan_events, claims)
 *   - messages (cascades: agent_questions → agent_answers)
 *   - notifications
 *   - push_subscriptions
 *   - intake_sessions
 *   - user_profiles (the D1 pointer for /{handle})
 *   - R2 resumes/{handle}/{published,draft}.json (what /{handle} actually renders)
 *   - R2 assets/{userId}/* (uploaded media — logos, project images, etc.)
 *
 * The users row itself is untouched so the next GitHub OAuth flow
 * lands the user in a fresh state.
 */
export async function POST() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const uid = session.user.id;
  const handle = session.user.login ?? null;

  // D1 on Cloudflare Workers supports batched statements. Scans has
  // ON DELETE CASCADE to events + claims; messages to
  // agent_questions (and agent_answers cascades from that).
  const stmts = [
    env.DB.prepare(`DELETE FROM scans WHERE user_id = ?`).bind(uid),
    env.DB.prepare(`DELETE FROM messages WHERE user_id = ?`).bind(uid),
    env.DB.prepare(`DELETE FROM notifications WHERE user_id = ?`).bind(uid),
    env.DB.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?`).bind(uid),
    env.DB.prepare(`DELETE FROM intake_sessions WHERE user_id = ?`).bind(uid),
    env.DB.prepare(`DELETE FROM user_profiles WHERE user_id = ?`).bind(uid),
  ];

  try {
    await env.DB.batch(stmts);
  } catch (err) {
    return NextResponse.json(
      { error: "delete_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }

  // Tear down R2. Without this the public /{handle} keeps rendering
  // from `resumes/{handle}/published.json` even after D1 is wiped —
  // which is how a user who "deleted" their profile still saw their
  // page live in the wild.
  if (env.BUCKET && handle) {
    await wipeR2ForUser(env.BUCKET, handle, uid).catch((err) => {
      // R2 wipe is best-effort — D1 is already gone, the dashboard will
      // show EmptyState, and a follow-up sweep can reap stragglers.
      console.error("profile.delete.r2_cleanup_failed", err);
    });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Delete every R2 object we own for this user. Two prefixes:
 *   - `resumes/{handle}/` — draft.json + published.json
 *   - `assets/{userId}/`  — uploaded media
 *
 * List+delete in pages to handle users with many uploads without
 * blowing the Workers 30s wall-clock. R2 list() returns up to 1000 per
 * call by default; we loop until truncated=false.
 */
async function wipeR2ForUser(
  bucket: R2Bucket,
  handle: string,
  userId: string,
): Promise<void> {
  // Fixed-key deletes first — cheap, and crucially these are what
  // /{handle} reads from.
  await Promise.all([
    bucket.delete(publishedResumeKey(handle)).catch(() => {}),
    bucket.delete(draftResumeKey(handle)).catch(() => {}),
  ]);

  await deletePrefix(bucket, `assets/${userId}/`);
}

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    const keys = page.objects.map((o) => o.key);
    if (keys.length > 0) {
      await bucket.delete(keys);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
