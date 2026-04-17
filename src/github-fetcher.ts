/**
 * Fetches all GitHub data for a user via the `gh` CLI.
 * Requires `gh` to be installed and authenticated.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type {
  GitHubData,
  GitHubProfile,
  RepoRef,
  GitHubPR,
  GitHubReview,
  GitHubEvent,
} from "./types.js";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_GH_RETRIES = 3;

async function ghJson<T>(args: string[]): Promise<T> {
  let lastError: string = "";

  for (let attempt = 1; attempt <= MAX_GH_RETRIES; attempt++) {
    try {
      const { stdout } = await execFile("gh", args, {
        maxBuffer: 20 * 1024 * 1024,
        timeout: 60_000,
      });
      return JSON.parse(stdout) as T;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;

      // Retry on rate limits and transient server errors
      const isRetryable =
        msg.includes("rate limit") ||
        msg.includes("429") ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("timeout") ||
        msg.includes("ECONNRESET") ||
        msg.includes("socket hang up");

      if (isRetryable && attempt < MAX_GH_RETRIES) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        console.warn(
          `[gh] Transient error (attempt ${attempt}/${MAX_GH_RETRIES}): ${msg.slice(0, 100)}`
        );
        console.warn(`[gh] Retrying in ${backoffMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      // Non-retryable or exhausted retries — return empty
      console.warn(`[gh] command failed: gh ${args.join(" ")}\n  ${msg.slice(0, 200)}`);
      return [] as unknown as T;
    }
  }

  console.warn(`[gh] Exhausted retries: gh ${args.join(" ")}\n  ${lastError.slice(0, 200)}`);
  return [] as unknown as T;
}

// ---------------------------------------------------------------------------
// Individual fetchers
// ---------------------------------------------------------------------------

interface RawGHProfile {
  login: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  avatar_url: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
}

async function fetchProfile(handle: string): Promise<GitHubProfile> {
  const raw = await ghJson<RawGHProfile>(["api", `/users/${handle}`]);
  return {
    login: raw.login ?? handle,
    name: raw.name ?? null,
    bio: raw.bio ?? null,
    location: raw.location ?? null,
    avatarUrl: raw.avatar_url ?? null,
    publicRepos: raw.public_repos ?? 0,
    followers: raw.followers ?? 0,
    following: raw.following ?? 0,
    createdAt: raw.created_at ?? new Date().toISOString(),
  };
}

interface RawRepo {
  name: string;
  owner: { login: string };
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  description: string | null;
  primaryLanguage: { name: string } | null;
  languages: Array<{ name: string }>;
  stargazerCount: number;
  forkCount: number;
  pushedAt: string | null;
  createdAt: string | null;
}

async function fetchRepos(handle: string): Promise<RepoRef[]> {
  const raw = await ghJson<RawRepo[]>([
    "repo",
    "list",
    handle,
    "--json",
    "name,owner,isPrivate,isFork,isArchived,description,primaryLanguage,languages,stargazerCount,forkCount,pushedAt,createdAt",
    "--limit",
    "500",
  ]);
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => ({
    name: r.name,
    owner: r.owner?.login ?? handle,
    fullName: `${r.owner?.login ?? handle}/${r.name}`,
    isPrivate: r.isPrivate ?? false,
    isFork: r.isFork ?? false,
    isArchived: r.isArchived ?? false,
    description: r.description ?? null,
    primaryLanguage: r.primaryLanguage?.name ?? null,
    languages: Array.isArray(r.languages)
      ? r.languages.map((l) => l.name)
      : [],
    stargazerCount: r.stargazerCount ?? 0,
    forkCount: r.forkCount ?? 0,
    pushedAt: r.pushedAt ?? null,
    createdAt: r.createdAt ?? null,
  }));
}

interface RawPR {
  repository: { nameWithOwner: string };
  number: number;
  title: string;
  state: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergedAt: string | null;
  createdAt: string;
  closedAt: string | null;
}

async function fetchAuthoredPRs(handle: string): Promise<GitHubPR[]> {
  // gh search prs uses --merged flag (not --is=merged) and doesn't expose
  // additions/deletions/changedFiles in search results. We fetch basic data
  // from search and can enrich individual PRs later via `gh pr view`.
  const raw = await ghJson<RawPR[]>([
    "search",
    "prs",
    `--author=${handle}`,
    "--merged",
    "--json",
    "repository,number,title,state,createdAt,closedAt,updatedAt",
    "--limit",
    "200",
  ]);
  if (!Array.isArray(raw)) return [];
  const lowerHandle = handle.toLowerCase();
  return raw.map((pr) => {
    const repoFullName = pr.repository?.nameWithOwner ?? "";
    const repoOwner = repoFullName.split("/")[0]?.toLowerCase() ?? "";
    return {
      repoFullName,
      number: pr.number,
      title: pr.title ?? "",
      state: "merged" as const,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changedFiles ?? 0,
      merged: true,
      mergedAt: pr.closedAt ?? null,
      createdAt: pr.createdAt ?? new Date().toISOString(),
      closedAt: pr.closedAt ?? null,
      reviewDecision: null,
      isExternal: repoOwner !== lowerHandle,
    };
  });
}

interface RawEvent {
  type: string;
  repo: { name: string };
  created_at: string;
  payload: Record<string, unknown>;
}

async function fetchEvents(handle: string): Promise<GitHubEvent[]> {
  const raw = await ghJson<RawEvent[]>([
    "api",
    `/users/${handle}/events?per_page=100`,
  ]);
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => ({
    type: e.type ?? "",
    repoFullName: e.repo?.name ?? "",
    createdAt: e.created_at ?? new Date().toISOString(),
    payload: e.payload ?? {},
  }));
}

async function fetchEmails(): Promise<string[]> {
  try {
    const raw = await ghJson<Array<{ email: string; verified: boolean }>>(["api", "/user/emails"]);
    if (!Array.isArray(raw)) return [];
    return raw.filter((e) => e.verified).map((e) => e.email);
  } catch {
    // Only works when the authenticated user matches; 403 is expected otherwise.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Review fetching (best-effort from events)
// ---------------------------------------------------------------------------

interface RawReview {
  user: { login: string };
  state: string;
  body: string;
  submitted_at: string;
}

async function fetchReviews(
  handle: string,
  events: GitHubEvent[],
): Promise<GitHubReview[]> {
  // Collect unique repos from PullRequestReviewEvent
  const reviewRepos = new Set<string>();
  for (const ev of events) {
    if (ev.type === "PullRequestReviewEvent") {
      reviewRepos.add(ev.repoFullName);
    }
  }

  // Limit to 5 repos to avoid rate-limit pressure
  const repos = [...reviewRepos].slice(0, 5);
  const reviews: GitHubReview[] = [];
  const lowerHandle = handle.toLowerCase();

  for (const repo of repos) {
    try {
      const prs = await ghJson<Array<{ number: number }>>([
        "api",
        `/repos/${repo}/pulls?state=all&per_page=30`,
      ]);
      if (!Array.isArray(prs)) continue;

      // Fetch reviews for up to 10 PRs per repo
      for (const pr of prs.slice(0, 10)) {
        try {
          const rawReviews = await ghJson<RawReview[]>([
            "api",
            `/repos/${repo}/pulls/${pr.number}/reviews`,
          ]);
          if (!Array.isArray(rawReviews)) continue;
          for (const r of rawReviews) {
            if (r.user?.login?.toLowerCase() !== lowerHandle) continue;
            reviews.push({
              repoFullName: repo,
              prNumber: pr.number,
              state: (r.state ?? "COMMENTED") as GitHubReview["state"],
              body: r.body ?? "",
              submittedAt: r.submitted_at ?? new Date().toISOString(),
            });
          }
        } catch {
          // Individual PR review fetch failed — skip
        }
      }
    } catch {
      // Repo PR list failed — skip
    }
  }

  return reviews;
}

// ---------------------------------------------------------------------------
// Org repo discovery
// ---------------------------------------------------------------------------

interface RawOrg {
  login: string;
}

/**
 * Discover repos from organizations the user belongs to.
 * Then cross-reference with PRs and events to find repos the user actually
 * contributes to. These are as important as owned repos for deep analysis.
 */
async function fetchOrgContributedRepos(
  handle: string,
  authoredPRs: GitHubPR[],
  events: GitHubEvent[],
): Promise<RepoRef[]> {
  // 1. Get orgs the user belongs to
  // Use /user/orgs (authenticated) first — it sees private memberships.
  // Fall back to /users/{handle}/orgs (public only) if that fails.
  let orgs = await ghJson<RawOrg[]>(["api", "/user/orgs"]);
  if (!Array.isArray(orgs) || orgs.length === 0) {
    orgs = await ghJson<RawOrg[]>(["api", `/users/${handle}/orgs`]);
  }
  if (!Array.isArray(orgs) || orgs.length === 0) return [];

  const orgNames = new Set(orgs.map((o) => o.login.toLowerCase()));

  // 2. Collect all repos the user has activity in (from PRs + events)
  const activeRepos = new Map<string, number>(); // fullName -> activity count

  for (const pr of authoredPRs) {
    const owner = pr.repoFullName.split("/")[0]?.toLowerCase() ?? "";
    if (orgNames.has(owner)) {
      const key = pr.repoFullName;
      activeRepos.set(key, (activeRepos.get(key) ?? 0) + 1);
    }
  }

  for (const ev of events) {
    const owner = ev.repoFullName.split("/")[0]?.toLowerCase() ?? "";
    if (orgNames.has(owner)) {
      const key = ev.repoFullName;
      activeRepos.set(key, (activeRepos.get(key) ?? 0) + 1);
    }
  }

  if (activeRepos.size === 0) return [];

  // 3. Fetch metadata for active org repos
  // Sort by activity count, take top 10 to avoid rate limit issues
  const topActive = [...activeRepos.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const orgRepos: RepoRef[] = [];

  for (const [fullName, activityCount] of topActive) {
    try {
      const raw = await ghJson<{
        name: string;
        owner: { login: string };
        isPrivate: boolean;
        isFork: boolean;
        isArchived: boolean;
        description: string | null;
        primaryLanguage: { name: string } | null;
        languages: { nodes: Array<{ name: string }> };
        stargazerCount: number;
        forkCount: number;
        pushedAt: string | null;
        createdAt: string | null;
      }>(["repo", "view", fullName, "--json",
        "name,owner,isPrivate,isFork,isArchived,description,primaryLanguage,languages,stargazerCount,forkCount,pushedAt,createdAt"]);

      if (!raw || !raw.name) continue;

      orgRepos.push({
        name: raw.name,
        owner: raw.owner?.login ?? fullName.split("/")[0] ?? "",
        fullName,
        isPrivate: raw.isPrivate ?? false,
        isFork: raw.isFork ?? false,
        isArchived: raw.isArchived ?? false,
        description: raw.description ?? null,
        primaryLanguage: raw.primaryLanguage?.name ?? null,
        languages: Array.isArray(raw.languages?.nodes)
          ? raw.languages.nodes.map((l) => l.name)
          : [],
        stargazerCount: raw.stargazerCount ?? 0,
        forkCount: raw.forkCount ?? 0,
        pushedAt: raw.pushedAt ?? null,
        createdAt: raw.createdAt ?? null,
        userCommitCount: activityCount,
      });
    } catch {
      // Skip repos we can't access
    }
  }

  return orgRepos;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function fetchGitHubData(handle: string): Promise<GitHubData> {
  // Run independent fetches in parallel
  const [profile, ownedRepos, authoredPRs, recentEvents, userEmails] =
    await Promise.all([
      fetchProfile(handle),
      fetchRepos(handle),
      fetchAuthoredPRs(handle),
      fetchEvents(handle),
      fetchEmails(),
    ]);

  // Discover org repos the user contributes to (depends on PRs + events)
  const orgRepos = await fetchOrgContributedRepos(handle, authoredPRs, recentEvents);

  // Merge org repos into owned repos (deduplicate by fullName)
  const ownedSet = new Set(ownedRepos.map((r) => r.fullName.toLowerCase()));
  for (const repo of orgRepos) {
    if (!ownedSet.has(repo.fullName.toLowerCase())) {
      ownedRepos.push(repo);
      ownedSet.add(repo.fullName.toLowerCase());
    }
  }

  // Mark PRs to repos we now consider "owned" (org repos) as non-external
  const allOwnedLower = ownedSet;
  for (const pr of authoredPRs) {
    if (allOwnedLower.has(pr.repoFullName.toLowerCase())) {
      pr.isExternal = false;
    }
  }

  // Reviews depend on events, so run after
  const submittedReviews = await fetchReviews(handle, recentEvents);

  console.warn(
    `[gh] Fetched: ${ownedRepos.length} repos (${orgRepos.length} from orgs), ` +
    `${authoredPRs.length} PRs, ${submittedReviews.length} reviews`
  );

  return {
    profile,
    ownedRepos,
    userEmails,
    authoredPRs,
    submittedReviews,
    recentEvents,
  };
}
