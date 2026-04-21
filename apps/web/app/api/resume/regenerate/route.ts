import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { z } from "zod";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { getSession } from "@/auth";
import { getUserGitHubToken } from "@/lib/user-token";

/**
 * POST /api/resume/regenerate — spawn a Fly machine that re-runs a
 * single resume-pipeline agent against the signed-in user's draft.
 *
 * Body:  { section: "hero" | "about" | "work" | "education" | "skills" |
 *                    "projects" | "buildLog" | "blog" }
 *
 * The worker script at `apps/worker/scripts/regenerate-section.ts` reads
 * SECTION + HANDLE + USER_GH_TOKEN env, runs the corresponding agent,
 * merges the result into `resumes/{handle}/draft.json`.
 *
 * Front-end only needs to wait — it polls `/api/resume/draft` after a
 * reasonable delay. There's no scan row for section regen (it doesn't
 * belong in the scans table; it's a targeted patch, not a full pass).
 */

const BodySchema = z.object({
  section: z.enum([
    "hero",
    "about",
    "work",
    "education",
    "skills",
    "projects",
    "buildLog",
    "blog",
  ]),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id || !session.user.login) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parse.error.issues },
      { status: 400 },
    );
  }
  const { section } = parse.data;

  const { env } = await getCloudflareContext({ async: true });

  const userGhToken = await getUserGitHubToken(env.DB, session.user.id);
  if (!userGhToken) {
    return NextResponse.json(
      { error: "no_github_token" },
      { status: 403 },
    );
  }

  const machineId = `regen-${nanoid(10)}`;
  try {
    const fly = FlyClient.fromEnv();
    const machine = await fly.spawnScanMachine({
      scanId: machineId,
      name: machineId,
      // Smaller machine — single-agent runs are cheap.
      cpus: 1,
      memoryMb: 1024,
      initCmd: ["bun", "scripts/regenerate-section.ts"],
      env: {
        SECTION: section,
        HANDLE: session.user.login,
        USER_ID: session.user.id,
        MODEL: "anthropic/claude-sonnet-4.6",
        GITSHOW_CLOUD_MODE: "1",
        CF_ACCOUNT_ID: requireVar(env, "CF_ACCOUNT_ID"),
        R2_BUCKET_NAME: requireVar(env, "R2_BUCKET_NAME"),
        R2_ACCESS_KEY_ID: requireVar(env, "R2_ACCESS_KEY_ID"),
        R2_SECRET_ACCESS_KEY: requireVar(env, "R2_SECRET_ACCESS_KEY"),
        OPENROUTER_API_KEY: requireVar(env, "OPENROUTER_API_KEY"),
        GH_TOKEN: userGhToken,
      },
    });
    return NextResponse.json(
      { ok: true, machineId: machine.id, section },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "spawn", detail: (err as Error).message.slice(0, 300) },
      { status: 500 },
    );
  }
}

function requireVar(env: CloudflareEnv, name: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}
