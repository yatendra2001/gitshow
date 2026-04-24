import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { z } from "zod";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { requireProApi } from "@/lib/entitlements";
import { getUserGitHubToken } from "@/lib/user-token";

/**
 * POST /api/scan — create a scan row + spawn a Fly machine to run it.
 *
 * Body shape:
 *   {
 *     handle: "yatendra2001",
 *     socials?: { twitter, linkedin, website },
 *     context_notes?: "freeform user text that seeds the pipeline"
 *   }
 *
 * Flow:
 *   1. Auth — must be signed in.
 *   2. Generate scan_id (cuid-style, 12 chars).
 *   3. INSERT into scans with status='queued'.
 *   4. Spawn Fly Machine with env injection. The machine's entrypoint
 *      (scripts/run-scan.ts) reads SCAN_ID/HANDLE and starts the
 *      pipeline. On boot the worker flips status → 'running'.
 *   5. Return the scan id so the client can redirect to /s/[id].
 */

const BodySchema = z.object({
  handle: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9-]+$/, "handle must be a GitHub username"),
  socials: z
    .object({
      twitter: z.string().optional(),
      linkedin: z.string().optional(),
      website: z.string().optional(),
    })
    .optional(),
  context_notes: z.string().max(2000).optional(),
  model: z.string().optional(),
  /**
   * Up to 5 blog URLs imported verbatim into the Resume's `blog[]`
   * section. Any source Jina Reader can render works — Medium, dev.to,
   * Hashnode, Substack, Ghost, personal sites.
   */
  blog_urls: z.array(z.string().url()).max(5).optional(),
  /**
   * Which worker pipeline to invoke. "resume" produces the new Resume
   * JSON rendered by /{handle}; "claim" produces the legacy ProfileCard.
   * Defaults to "resume" now that the new pipeline is wired end-to-end.
   */
  pipeline: z.enum(["resume", "claim"]).optional(),
});

export async function POST(req: Request) {
  // Pro-gated: scan creation consumes Fly + OpenRouter credits, so it
  // can never run without an active subscription. A cancelled user who
  // somehow slips past the UI hits a 402 here with `upgrade_url`.
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const session = gate.session;

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parse.error.issues },
      { status: 400 },
    );
  }
  const body = parse.data;

  const { env } = await getCloudflareContext({ async: true });

  const scanId = `scan-${nanoid(10)}`;
  const sessionId = `or-${nanoid(14)}`;
  // `openrouter/auto` lets OpenRouter pick the best model per request
  // from the allowed-models list configured in our OpenRouter
  // workspace. Flip the default there without a redeploy; request
  // body still wins when it pins an explicit model.
  const model = body.model ?? "openrouter/auto";
  const pipeline = body.pipeline ?? "resume";
  const now = Date.now();

  try {
    await env.DB.prepare(
      `INSERT INTO scans
         (id, user_id, handle, session_id, model, status, current_phase,
          cost_cents, llm_calls, socials_json, context_notes,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', NULL, 0, 0, ?, ?, ?, ?)`,
    )
      .bind(
        scanId,
        session.user.id,
        body.handle,
        sessionId,
        model,
        body.socials ? JSON.stringify(body.socials) : null,
        body.context_notes ?? null,
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
      { error: "no_github_token" },
      { status: 403 },
    );
  }

  // Spawn the Fly machine. If it fails, mark the scan failed so the UI
  // can show a clear error instead of hanging in `queued`.
  try {
    const fly = FlyClient.fromEnv();
    const machine = await fly.spawnScanMachine({
      scanId,
      env: buildMachineEnv(env, {
        scanId,
        handle: body.handle,
        model,
        pipeline,
        twitter: body.socials?.twitter,
        linkedin: body.socials?.linkedin,
        website: body.socials?.website,
        contextNotes: body.context_notes,
        blogUrls: body.blog_urls,
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
      `UPDATE scans SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(`fly spawn: ${(err as Error).message.slice(0, 500)}`, Date.now(), scanId)
      .run();
    return NextResponse.json(
      { error: "spawn", detail: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ scanId }, { status: 201 });
}

function buildMachineEnv(
  env: CloudflareEnv,
  s: {
    scanId: string;
    handle: string;
    model: string;
    pipeline: "resume" | "claim";
    twitter?: string;
    linkedin?: string;
    website?: string;
    contextNotes?: string;
    blogUrls?: string[];
    userGhToken: string;
  },
): Record<string, string> {
  const out: Record<string, string> = {
    SCAN_ID: s.scanId,
    HANDLE: s.handle,
    MODEL: s.model,
    PIPELINE: s.pipeline,
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
  if (s.blogUrls && s.blogUrls.length > 0) out.BLOG_URLS = s.blogUrls.join(",");
  if (env.REALTIME_ENDPOINT) out.REALTIME_ENDPOINT = env.REALTIME_ENDPOINT;
  if (env.PIPELINE_SHARED_SECRET)
    out.PIPELINE_SHARED_SECRET = env.PIPELINE_SHARED_SECRET;
  return out;
}

function requireVar(env: CloudflareEnv, name: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}
