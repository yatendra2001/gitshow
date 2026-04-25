import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { z } from "zod";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { DEFAULT_SCAN_MODEL } from "@gitshow/shared/models";
import { requireProApi } from "@/lib/entitlements";
import { getIntakeForUser, markIntakeConsumed } from "@/lib/intake";
import { getUserGitHubToken } from "@/lib/user-token";

/**
 * POST /api/intake/[id]/answers
 *
 * Body: { socials?, blog_urls?, skip_repos? }
 *
 * Spawns the full scan with the user-supplied URLs threaded through
 * as worker env vars and marks the intake row as consumed. Returns
 * { scanId } for the client to redirect to.
 */

const BodySchema = z.object({
  /**
   * Structured social links supplied by the user up-front. These are
   * propagated to the worker as LINKEDIN/TWITTER/WEBSITE env vars — the
   * work/education agents use them as LinkedIn inputs; blog_urls feeds
   * the blog-import agent.
   */
  socials: z
    .object({
      linkedin: z.string().url().optional().or(z.literal("")),
      twitter: z.string().max(60).optional().or(z.literal("")),
      website: z.string().url().optional().or(z.literal("")),
      youtube: z.string().url().optional().or(z.literal("")),
      /** ORCID iD URL — feeds the orcid + semantic-scholar fetchers. */
      orcid: z.string().url().optional().or(z.literal("")),
      /** Stack Overflow profile URL — feeds the stackoverflow fetcher. */
      stackoverflow: z.string().url().optional().or(z.literal("")),
    })
    .optional(),
  blog_urls: z
    .array(z.string().url())
    .max(5)
    .optional(),
  /**
   * Repo full names ("owner/name") the user picked from the
   * "Repos to skip" multi-select on the intake page. The worker
   * filters these out of the github-fetched repo set before any
   * downstream stage — so a one-off fork or a personal-investing
   * page never makes it into the portfolio.
   */
  skip_repos: z
    .array(z.string().regex(/^[\w.-]+\/[\w.-]+$/, "must be owner/name"))
    .max(100)
    .optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Pro-gated: this endpoint spawns the full scan. Without this
  // guard a cancelled user with a stale draft could still trigger
  // an expensive generation by replaying the intake-answers call.
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const session = gate.session;
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

  // Spawn the full scan.
  const scanId = `scan-${nanoid(10)}`;
  const sessionId = `or-${nanoid(14)}`;
  // Default lives in @gitshow/shared/models — change it there and all
  // entry points follow.
  const model = DEFAULT_SCAN_MODEL;
  const now = Date.now();

  const socials = parse.data.socials ?? {};
  const blogUrls = parse.data.blog_urls ?? [];
  const skipRepos = parse.data.skip_repos ?? [];

  try {
    await env.DB.prepare(
      `INSERT INTO scans
         (id, user_id, handle, session_id, model, status, current_phase,
          cost_cents, llm_calls, socials_json,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', NULL, 0, 0, ?, ?, ?)`,
    )
      .bind(
        scanId,
        session.user.id,
        intake.handle,
        sessionId,
        model,
        Object.keys(socials).length > 0 ? JSON.stringify(socials) : null,
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
        linkedin: socials.linkedin || undefined,
        twitter: socials.twitter || undefined,
        website: socials.website || undefined,
        youtube: socials.youtube || undefined,
        orcid: socials.orcid || undefined,
        stackoverflow: socials.stackoverflow || undefined,
        blogUrls,
        skipRepos,
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
    linkedin?: string;
    twitter?: string;
    website?: string;
    youtube?: string;
    orcid?: string;
    stackoverflow?: string;
    blogUrls?: string[];
    skipRepos?: string[];
    userGhToken: string;
  },
): Record<string, string> {
  const out: Record<string, string> = {
    SCAN_ID: s.scanId,
    HANDLE: s.handle,
    MODEL: s.model,
    // Phase 2 pivot: this intake flow now exclusively feeds the resume
    // pipeline. The old claim pipeline path still exists on the worker
    // (PIPELINE=claim) for rollback, but new scans go resume-first.
    PIPELINE: "resume",
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
  if (s.linkedin) out.LINKEDIN = s.linkedin;
  if (s.twitter) out.TWITTER = s.twitter;
  if (s.website) out.WEBSITE = s.website;
  if (s.youtube) out.YOUTUBE = s.youtube;
  if (s.orcid) out.ORCID = s.orcid;
  if (s.stackoverflow) out.STACKOVERFLOW = s.stackoverflow;
  if (s.blogUrls && s.blogUrls.length > 0)
    out.BLOG_URLS = s.blogUrls.join(",");
  if (s.skipRepos && s.skipRepos.length > 0)
    out.SKIP_REPOS = s.skipRepos.join(",");
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
  if (optional.TINYFISH_API_KEY) out.TINYFISH_API_KEY = optional.TINYFISH_API_KEY;
  return out;
}

function requireVar(env: CloudflareEnv, name: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}
