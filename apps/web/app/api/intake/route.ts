import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { z } from "zod";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { getSession } from "@/auth";
import { createIntakeSession } from "@/lib/intake";
import { getUserGitHubToken } from "@/lib/user-token";

/**
 * POST /api/intake — kick off a 60-second pre-scan that generates
 * 3-5 questions for the user to answer before the full scan.
 *
 * Body:  { handle: "yatendra2001" }
 *
 * Flow:
 *   1. Insert intake_sessions row with status='pending'.
 *   2. Spawn Fly machine with initCmd pointing at run-intake.ts.
 *   3. Return intakeId so the client can poll GET /api/intake/[id].
 */

const BodySchema = z.object({
  handle: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9-]+$/, "handle must be a GitHub username"),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parse.error.issues },
      { status: 400 },
    );
  }

  const { env } = await getCloudflareContext({ async: true });
  const intakeId = `intake-${nanoid(10)}`;
  const model = parse.data.model ?? "anthropic/claude-sonnet-4.6";

  // The user's GitHub OAuth token is REQUIRED — it's what gives the
  // Fly worker read access to their private + org repos. If missing,
  // signal upstream instead of silently downgrading to public-only.
  const userGhToken = await getUserGitHubToken(env.DB, session.user.id);
  if (!userGhToken) {
    return NextResponse.json(
      {
        error: "no_github_token",
        detail:
          "We don't have a GitHub access token for you. Sign out and back in, and approve the repo scope.",
      },
      { status: 403 },
    );
  }

  try {
    await createIntakeSession(env.DB, {
      id: intakeId,
      user_id: session.user.id,
      handle: parse.data.handle,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "db", detail: (err as Error).message },
      { status: 500 },
    );
  }

  try {
    const fly = FlyClient.fromEnv();
    await fly.spawnScanMachine({
      // FlyClient calls this "scanId" but it's just a unique name for
      // the machine. Using the intakeId keeps the Fly dashboard
      // searchable by it.
      scanId: intakeId,
      name: `intake-${intakeId}`,
      // Intake is a short one-shot — smaller machine, no need for 2048 MB.
      cpus: 1,
      memoryMb: 1024,
      initCmd: ["bun", "scripts/run-intake.ts"],
      env: buildIntakeEnv(env, {
        intakeId,
        handle: parse.data.handle,
        model,
        userGhToken,
      }),
    });
  } catch (err) {
    await env.DB.prepare(
      `UPDATE intake_sessions SET status='failed', error=?, updated_at=? WHERE id=?`,
    )
      .bind(`fly spawn: ${(err as Error).message.slice(0, 500)}`, Date.now(), intakeId)
      .run();
    return NextResponse.json(
      { error: "spawn", detail: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ intakeId }, { status: 201 });
}

function buildIntakeEnv(
  env: CloudflareEnv,
  s: { intakeId: string; handle: string; model: string; userGhToken: string },
): Record<string, string> {
  return {
    INTAKE_ID: s.intakeId,
    HANDLE: s.handle,
    MODEL: s.model,
    GITSHOW_CLOUD_MODE: "1",
    CF_ACCOUNT_ID: requireVar(env, "CF_ACCOUNT_ID"),
    CF_API_TOKEN: requireVar(env, "CF_API_TOKEN"),
    D1_DATABASE_ID: requireVar(env, "D1_DATABASE_ID"),
    OPENROUTER_API_KEY: requireVar(env, "OPENROUTER_API_KEY"),
    // Use the user's OAuth token — the `repo` scope gives access to
    // their private + org repos. The bot GH_TOKEN env (public-only)
    // is the fallback for any code that explicitly reaches for it.
    GH_TOKEN: s.userGhToken,
  };
}

function requireVar(env: CloudflareEnv, name: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}
