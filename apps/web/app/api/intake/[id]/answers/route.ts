import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { z } from "zod";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { getSession } from "@/auth";
import {
  getIntakeForUser,
  saveIntakeAnswers,
  markIntakeConsumed,
  buildContextFromIntake,
} from "@/lib/intake";
import { getUserGitHubToken } from "@/lib/user-token";

/**
 * POST /api/intake/[id]/answers
 *
 * Body: { answers: { [question_id]: string } }
 *
 * Saves the user's answers, spawns the full scan with the answers
 * folded into context_notes, and marks the intake as consumed.
 * Returns { scanId } for the client to redirect to.
 */

const BodySchema = z.object({
  answers: z.record(z.string(), z.string().max(1000)),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parse.error.issues },
      { status: 400 },
    );
  }

  const { env } = await getCloudflareContext({ async: true });
  const intake = await getIntakeForUser(env.DB, id, session.user.id);
  if (!intake) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (intake.status !== "ready" && intake.status !== "awaiting_answers") {
    return NextResponse.json(
      { error: "bad_state", status: intake.status },
      { status: 409 },
    );
  }

  const ok = await saveIntakeAnswers(
    env.DB,
    id,
    session.user.id,
    parse.data.answers,
  );
  if (!ok) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // Refresh to fold answers into context_notes for the scan.
  const refreshed = await getIntakeForUser(env.DB, id, session.user.id);
  const contextNotes = refreshed ? buildContextFromIntake(refreshed) : null;

  // Spawn the full scan with intake context baked in.
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
        session.user.id,
        intake.handle,
        sessionId,
        model,
        contextNotes,
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

  const userGhToken = await getUserGitHubToken(env.DB, session.user.id);
  if (!userGhToken) {
    return NextResponse.json(
      {
        error: "no_github_token",
        detail:
          "We don't have a GitHub access token for you. Sign out and back in so we can read your repos.",
      },
      { status: 403 },
    );
  }

  try {
    const fly = FlyClient.fromEnv();
    const machine = await fly.spawnScanMachine({
      scanId,
      env: buildScanEnv(env, {
        scanId,
        handle: intake.handle,
        model,
        contextNotes: contextNotes ?? undefined,
        userGhToken,
      }),
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

  await markIntakeConsumed(env.DB, id, session.user.id, scanId);

  return NextResponse.json({ scanId }, { status: 201 });
}

function buildScanEnv(
  env: CloudflareEnv,
  s: {
    scanId: string;
    handle: string;
    model: string;
    contextNotes?: string;
    userGhToken: string;
  },
): Record<string, string> {
  const out: Record<string, string> = {
    SCAN_ID: s.scanId,
    HANDLE: s.handle,
    MODEL: s.model,
    GITSHOW_CLOUD_MODE: "1",
    CF_ACCOUNT_ID: requireVar(env, "CF_ACCOUNT_ID"),
    CF_API_TOKEN: requireVar(env, "CF_API_TOKEN"),
    D1_DATABASE_ID: requireVar(env, "D1_DATABASE_ID"),
    R2_BUCKET_NAME: requireVar(env, "R2_BUCKET_NAME"),
    R2_ACCESS_KEY_ID: requireVar(env, "R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: requireVar(env, "R2_SECRET_ACCESS_KEY"),
    OPENROUTER_API_KEY: requireVar(env, "OPENROUTER_API_KEY"),
    // User's OAuth access_token — `repo` scope covers private + org repos.
    GH_TOKEN: s.userGhToken,
  };
  if (s.contextNotes) out.CONTEXT_NOTES = s.contextNotes;
  // Optional envs — not on CloudflareEnv's hard type yet, so read via
  // an escape-hatch cast. Missing values are fine (the sender silently
  // no-ops).
  const optional = env as unknown as Record<string, string | undefined>;
  if (optional.REALTIME_ENDPOINT) out.REALTIME_ENDPOINT = optional.REALTIME_ENDPOINT;
  if (optional.PIPELINE_SHARED_SECRET)
    out.PIPELINE_SHARED_SECRET = optional.PIPELINE_SHARED_SECRET;
  if (optional.RESEND_API_KEY) out.RESEND_API_KEY = optional.RESEND_API_KEY;
  if (optional.EMAIL_FROM) out.EMAIL_FROM = optional.EMAIL_FROM;
  if (optional.PUBLIC_APP_URL) out.PUBLIC_APP_URL = optional.PUBLIC_APP_URL;
  return out;
}

function requireVar(env: CloudflareEnv, name: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}
