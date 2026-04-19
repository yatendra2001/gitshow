import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { z } from "zod";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { auth } from "@/auth";
import { createIntakeSession } from "@/lib/intake";

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
  const session = await auth();
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
  s: { intakeId: string; handle: string; model: string },
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
    GH_TOKEN: requireVar(env, "GH_TOKEN"),
  };
}

function requireVar(env: CloudflareEnv, name: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}
