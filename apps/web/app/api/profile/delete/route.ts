import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";

/**
 * POST /api/profile/delete
 *
 * Wipes everything tied to the authenticated user:
 *   - scans (cascades: scan_events, claims)
 *   - messages (cascades: agent_questions → agent_answers)
 *   - notifications
 *   - push_subscriptions
 *   - intake_sessions
 *   - user_profiles (the public /{handle} entry)
 *
 * The users row itself is untouched so the next GitHub OAuth flow
 * lands the user in a fresh state. R2 objects under scans/{scanId}/
 * are NOT deleted here — a follow-up cron sweeps orphaned keys so
 * this endpoint stays fast. D1 cascades handle the relational mess.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const uid = session.user.id;

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

  return NextResponse.json({ ok: true });
}
