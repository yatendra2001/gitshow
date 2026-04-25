import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { getIntakeForUser } from "@/lib/intake";
import { getUserGitHubToken } from "@/lib/user-token";

/**
 * GET /api/intake/[id]/repos — owned repos for the intake picker.
 *
 * The "Repos to skip" multi-select on the intake page calls this to
 * populate its options. We hit GitHub directly with the user's
 * OAuth token (the same one the worker uses for `gh api`) and project
 * down to the minimum fields the picker actually needs:
 *   full_name · description · primary_language · stars · pushed_at
 *   plus the `archived` and `fork` flags so the UI can sort/badge.
 *
 * Auth: must own the intake (user_id match). Anyone else → 404.
 *
 * Response shape: { repos: RepoSummary[] }. Capped at 200 owned repos
 * (the max signal-bearing universe — anyone with more than that
 * doesn't need a picker, they need to see the top 200 by recency).
 */

const MAX_REPOS = 200;

export interface RepoSummary {
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  language: string | null;
  stars: number;
  archived: boolean;
  fork: boolean;
  /** ISO timestamp; null if never pushed. */
  pushed_at: string | null;
}

interface GhRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  language: string | null;
  stargazers_count: number;
  archived: boolean;
  fork: boolean;
  pushed_at: string | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const intake = await getIntakeForUser(env.DB, id, session.user.id);
  if (!intake) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const token = await getUserGitHubToken(env.DB, session.user.id);
  if (!token) {
    return NextResponse.json(
      {
        error: "no_github_token",
        detail: "Sign out and back in so we can read your repos.",
      },
      { status: 403 },
    );
  }

  // Page through /user/repos until we hit MAX_REPOS or run out. We use
  // `affiliation=owner` so contribution-only repos don't fill the
  // picker — those aren't the user's authorship and shouldn't be
  // skippable from this UI.
  const repos: RepoSummary[] = [];
  for (let page = 1; repos.length < MAX_REPOS && page <= 5; page++) {
    const resp = await fetch(
      `https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "GitShow/0.4 (intake picker)",
        },
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      // Fail loud — the picker is non-essential, but a 401 means the
      // user's token is dead and we should surface it instead of
      // showing an empty picker that looks like "no repos".
      return NextResponse.json(
        {
          error: "github_api_failed",
          status: resp.status,
          detail: text.slice(0, 240),
        },
        { status: 502 },
      );
    }
    const page_repos = (await resp.json()) as GhRepo[];
    if (page_repos.length === 0) break;
    for (const r of page_repos) {
      if (repos.length >= MAX_REPOS) break;
      repos.push({
        full_name: r.full_name,
        name: r.name,
        owner: r.owner.login,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        archived: r.archived,
        fork: r.fork,
        pushed_at: r.pushed_at,
      });
    }
    if (page_repos.length < 100) break;
  }

  return NextResponse.json({ repos });
}
