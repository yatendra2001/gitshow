/**
 * Fetches the most complete picture of a user's GitHub footprint we can
 * assemble from the REST + GraphQL APIs using the user's own OAuth token.
 *
 * Data sources (union-merged, de-duped by repo fullName):
 *
 *   1. GET /user/repos?affiliation=owner,collaborator,organization_member&visibility=all
 *      — every repo the authenticated user has any access to. This is
 *      the *big* expansion over the previous `gh repo list <handle>`
 *      call, which only returned repos owned by that handle.
 *
 *   2. GraphQL `viewer.contributionsCollection` looped year-by-year
 *      (API caps each query at 1 year). Surfaces repos where the user
 *      CONTRIBUTED but doesn't own — PRs merged into third-party repos,
 *      commits to teammates' repos, reviews of others' work. Respects
 *      the user's "Include private contributions on my profile" toggle.
 *
 *   3. GET /search/commits?q=author-email:<email> for each verified
 *      email. Catches one-off drive-by commits to repos the user isn't
 *      a member of. Default branch only — a hard GitHub limit.
 *
 *   4. Existing PR + event + review fetchers (unchanged) for the
 *      narrative around each contribution.
 *
 * Org access state:
 *   We list the user's orgs (public + private via read:org), then for
 *   each org check whether /user/repos returned any repos. Zero →
 *   locked (SSO or OAuth-app policy). The UI uses this list to surface
 *   one-click remediation.
 *
 * Auth: relies on the caller having `gh auth login` or `GH_TOKEN` set
 * with scopes `repo read:org read:user user:email` (auth.ts requests all
 * four on sign-in).
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./util.js";
import type {
  GitHubData,
  GitHubProfile,
  GitHubPR,
  GitHubReview,
  GitHubEvent,
  OrgAccess,
  RepoRef,
  RepoRelationship,
} from "./types.js";

const execFile = promisify(execFileCb);
const ghLog = logger.child({ src: "gh-fetcher" });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_GH_RETRIES = 3;
const CONTRIBUTIONS_YEARS_BACK = 10;
const COMMIT_SEARCH_MAX_PAGES = 3; // 3 × 100 results = 300 commits per email
const GH_CLI_ARG_LIMIT = 200_000; // rough, keeps arg list well under exec limit

// ---------------------------------------------------------------------------
// Low-level `gh` helpers
// ---------------------------------------------------------------------------

/**
 * Invoke `gh` with retries on transient errors. Returns parsed JSON on
 * success, or the caller-supplied fallback when everything fails.
 */
async function ghJson<T>(args: string[], fallback: T): Promise<T> {
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_GH_RETRIES; attempt++) {
    try {
      const { stdout } = await execFile("gh", args, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 90_000,
      });
      return JSON.parse(stdout) as T;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;

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
        ghLog.warn(
          { attempt, max_attempts: MAX_GH_RETRIES, backoff_ms: backoffMs, error: msg.slice(0, 200) },
          "transient error, retrying",
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      ghLog.warn(
        { args: summarizeArgs(args), error: msg.slice(0, 400) },
        "command failed, returning fallback",
      );
      return fallback;
    }
  }

  ghLog.warn(
    { args: summarizeArgs(args), last_error: lastError.slice(0, 400) },
    "exhausted retries, returning fallback",
  );
  return fallback;
}

function summarizeArgs(args: string[]): string {
  return args
    .map((a) => (a.length > 200 ? `${a.slice(0, 200)}…` : a))
    .join(" ");
}

/** Paginated REST GET — calls `gh api --paginate` and parses the array. */
async function ghPaginated<T>(endpoint: string): Promise<T[]> {
  return ghJson<T[]>(["api", "--paginate", endpoint], []);
}

// ---------------------------------------------------------------------------
// Profile + emails
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
  const raw = await ghJson<RawGHProfile>(["api", `/users/${handle}`], {
    login: handle,
    name: null,
    bio: null,
    location: null,
    avatar_url: null,
    public_repos: 0,
    followers: 0,
    following: 0,
    created_at: new Date().toISOString(),
  });
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

async function fetchEmails(): Promise<string[]> {
  const raw = await ghJson<Array<{ email: string; verified: boolean }>>(
    ["api", "/user/emails"],
    [],
  );
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e.verified && e.email && !e.email.endsWith("@users.noreply.github.com"))
    .map((e) => e.email);
}

// ---------------------------------------------------------------------------
// Org membership
// ---------------------------------------------------------------------------

interface RawOrg {
  login: string;
  description?: string | null;
  avatar_url?: string | null;
  name?: string | null;
}

async function fetchOrgs(): Promise<RawOrg[]> {
  // /user/orgs requires read:org for private memberships; public ones
  // are always visible. If read:org isn't granted (legacy tokens) we
  // still get public orgs back.
  const raw = await ghPaginated<RawOrg>("/user/orgs?per_page=100");
  return Array.isArray(raw) ? raw : [];
}

// ---------------------------------------------------------------------------
// The big one: /user/repos with affiliation + visibility=all
// ---------------------------------------------------------------------------

interface RawUserRepo {
  name: string;
  full_name: string;
  owner: { login: string; type?: string };
  private: boolean;
  fork: boolean;
  archived: boolean;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string | null;
  created_at: string | null;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
}

async function fetchAccessibleRepos(handle: string): Promise<RepoRef[]> {
  // affiliation: owner = you own it; collaborator = explicit invite;
  // organization_member = any repo in any org you belong to and have
  // read access to. visibility=all means public + private mixed.
  const endpoint =
    "/user/repos?affiliation=owner,collaborator,organization_member&visibility=all&per_page=100";
  const raw = await ghPaginated<RawUserRepo>(endpoint);

  const lowerHandle = handle.toLowerCase();
  const out: RepoRef[] = [];
  for (const r of raw) {
    if (!r?.full_name) continue;
    const ownerLogin = r.owner?.login ?? "";
    const isOwnerHandle = ownerLogin.toLowerCase() === lowerHandle;
    const ownerIsUser = r.owner?.type === "User";

    let relationship: RepoRelationship;
    if (isOwnerHandle) relationship = "owner";
    else if (ownerIsUser) relationship = "collaborator";
    else relationship = "org_member";

    out.push({
      name: r.name,
      owner: ownerLogin,
      fullName: r.full_name,
      isPrivate: Boolean(r.private),
      isFork: Boolean(r.fork),
      isArchived: Boolean(r.archived),
      description: r.description ?? null,
      primaryLanguage: r.language ?? null,
      languages: r.language ? [r.language] : [],
      stargazerCount: r.stargazers_count ?? 0,
      forkCount: r.forks_count ?? 0,
      pushedAt: r.pushed_at ?? null,
      createdAt: r.created_at ?? null,
      relationship,
      relationships: [relationship],
      discoveredVia: ["user-repos"],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// GraphQL: contributionsCollection loop
// ---------------------------------------------------------------------------

interface ContribGraphResponse {
  data?: {
    viewer?: {
      contributionsCollection?: {
        hasAnyRestrictedContributions: boolean;
        restrictedContributionsCount: number;
        totalCommitContributions: number;
        totalIssueContributions: number;
        totalPullRequestContributions: number;
        totalPullRequestReviewContributions: number;
        commitContributionsByRepository: Array<{
          repository: {
            nameWithOwner: string;
            isPrivate: boolean;
            isFork: boolean;
            isArchived: boolean;
            description: string | null;
            primaryLanguage: { name: string } | null;
            stargazerCount: number;
            forkCount: number;
            pushedAt: string | null;
            createdAt: string | null;
            owner: { login: string };
          };
          contributions: { totalCount: number };
        }>;
        pullRequestContributionsByRepository: Array<{
          repository: { nameWithOwner: string; owner: { login: string } };
          contributions: { totalCount: number };
        }>;
        issueContributionsByRepository: Array<{
          repository: { nameWithOwner: string; owner: { login: string } };
          contributions: { totalCount: number };
        }>;
        pullRequestReviewContributionsByRepository: Array<{
          repository: { nameWithOwner: string; owner: { login: string } };
          contributions: { totalCount: number };
        }>;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

const CONTRIBUTIONS_QUERY = `
query($from:DateTime!, $to:DateTime!) {
  viewer {
    contributionsCollection(from: $from, to: $to) {
      hasAnyRestrictedContributions
      restrictedContributionsCount
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      commitContributionsByRepository(maxRepositories: 100) {
        repository {
          nameWithOwner
          isPrivate
          isFork
          isArchived
          description
          primaryLanguage { name }
          stargazerCount
          forkCount
          pushedAt
          createdAt
          owner { login }
        }
        contributions { totalCount }
      }
      pullRequestContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner owner { login } }
        contributions { totalCount }
      }
      issueContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner owner { login } }
        contributions { totalCount }
      }
      pullRequestReviewContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner owner { login } }
        contributions { totalCount }
      }
    }
  }
}
`.trim();

interface ContributionSummary {
  /** Per-repo aggregated signals across all years we looked at. */
  repos: Map<string, ContributionRepoAgg>;
  totals: {
    commits: number;
    prs: number;
    issues: number;
    reviews: number;
    restricted: number;
  };
  /** True when any year reported restrictedContributionsCount > 0 AND
   *  hasAnyRestrictedContributions was true (the user has private work
   *  but hasn't opted to surface it on their profile). */
  privateContributionsHidden: boolean;
  /** True when we saw any repo attributed with a private contribution
   *  (i.e. the toggle is ON and we got real data back). */
  privateContributionsVisible: boolean;
}

interface ContributionRepoAgg {
  fullName: string;
  ownerLogin: string;
  isPrivate: boolean;
  commits: number;
  prsOpened: number;
  issues: number;
  reviews: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** Repository metadata captured the first time we saw it. */
  meta: {
    isFork: boolean;
    isArchived: boolean;
    description: string | null;
    primaryLanguage: string | null;
    stargazerCount: number;
    forkCount: number;
    pushedAt: string | null;
    createdAt: string | null;
  } | null;
}

async function fetchContributions(profile: GitHubProfile): Promise<ContributionSummary> {
  const agg: ContributionSummary = {
    repos: new Map(),
    totals: { commits: 0, prs: 0, issues: 0, reviews: 0, restricted: 0 },
    privateContributionsHidden: false,
    privateContributionsVisible: false,
  };

  const now = new Date();
  const createdAt = profile.createdAt ? new Date(profile.createdAt) : null;

  for (let i = 0; i < CONTRIBUTIONS_YEARS_BACK; i++) {
    const to = new Date(now);
    to.setFullYear(to.getFullYear() - i);
    const from = new Date(to);
    from.setFullYear(from.getFullYear() - 1);

    // If the window predates the user's account entirely, stop looping.
    if (createdAt && to < createdAt) break;

    const windowLog = `${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}`;
    const resp = await ghJson<ContribGraphResponse>(
      [
        "api",
        "graphql",
        "-f",
        `query=${CONTRIBUTIONS_QUERY}`,
        "-F",
        `from=${from.toISOString()}`,
        "-F",
        `to=${to.toISOString()}`,
      ],
      { data: { viewer: { contributionsCollection: undefined } } } as ContribGraphResponse,
    );

    const cc = resp.data?.viewer?.contributionsCollection;
    if (!cc) {
      ghLog.warn({ window: windowLog, errors: resp.errors }, "contributions window empty");
      continue;
    }

    agg.totals.commits += cc.totalCommitContributions ?? 0;
    agg.totals.prs += cc.totalPullRequestContributions ?? 0;
    agg.totals.issues += cc.totalIssueContributions ?? 0;
    agg.totals.reviews += cc.totalPullRequestReviewContributions ?? 0;
    agg.totals.restricted += cc.restrictedContributionsCount ?? 0;

    if (cc.hasAnyRestrictedContributions && cc.commitContributionsByRepository.length === 0) {
      // Signal (not definitive): the user has private contributions but
      // none of them are surfacing repo-level. Almost always means the
      // toggle is off.
      agg.privateContributionsHidden = true;
    }

    for (const row of cc.commitContributionsByRepository ?? []) {
      if (!row?.repository?.nameWithOwner) continue;
      const rec = upsertContribRepo(agg.repos, row.repository);
      rec.commits += row.contributions?.totalCount ?? 0;
      touchSeen(rec, to);
      if (row.repository.isPrivate) agg.privateContributionsVisible = true;
    }
    for (const row of cc.pullRequestContributionsByRepository ?? []) {
      if (!row?.repository?.nameWithOwner) continue;
      const rec = upsertContribRepo(agg.repos, row.repository);
      rec.prsOpened += row.contributions?.totalCount ?? 0;
      touchSeen(rec, to);
    }
    for (const row of cc.issueContributionsByRepository ?? []) {
      if (!row?.repository?.nameWithOwner) continue;
      const rec = upsertContribRepo(agg.repos, row.repository);
      rec.issues += row.contributions?.totalCount ?? 0;
      touchSeen(rec, to);
    }
    for (const row of cc.pullRequestReviewContributionsByRepository ?? []) {
      if (!row?.repository?.nameWithOwner) continue;
      const rec = upsertContribRepo(agg.repos, row.repository);
      rec.reviews += row.contributions?.totalCount ?? 0;
      touchSeen(rec, to);
    }
  }

  return agg;
}

interface RepoLikeContribution {
  nameWithOwner: string;
  owner: { login: string };
  isPrivate?: boolean;
  isFork?: boolean;
  isArchived?: boolean;
  description?: string | null;
  primaryLanguage?: { name: string } | null;
  stargazerCount?: number;
  forkCount?: number;
  pushedAt?: string | null;
  createdAt?: string | null;
}

function upsertContribRepo(
  m: Map<string, ContributionRepoAgg>,
  repo: RepoLikeContribution,
): ContributionRepoAgg {
  const key = repo.nameWithOwner.toLowerCase();
  const existing = m.get(key);
  if (existing) {
    // Enrich metadata from whichever row gave us the richest payload.
    if (!existing.meta && repo.isPrivate !== undefined) {
      existing.meta = {
        isFork: Boolean(repo.isFork),
        isArchived: Boolean(repo.isArchived),
        description: repo.description ?? null,
        primaryLanguage: repo.primaryLanguage?.name ?? null,
        stargazerCount: repo.stargazerCount ?? 0,
        forkCount: repo.forkCount ?? 0,
        pushedAt: repo.pushedAt ?? null,
        createdAt: repo.createdAt ?? null,
      };
      existing.isPrivate = Boolean(repo.isPrivate);
    }
    return existing;
  }
  const rec: ContributionRepoAgg = {
    fullName: repo.nameWithOwner,
    ownerLogin: repo.owner?.login ?? repo.nameWithOwner.split("/")[0] ?? "",
    isPrivate: Boolean(repo.isPrivate),
    commits: 0,
    prsOpened: 0,
    issues: 0,
    reviews: 0,
    firstSeen: null,
    lastSeen: null,
    meta:
      repo.isPrivate !== undefined
        ? {
            isFork: Boolean(repo.isFork),
            isArchived: Boolean(repo.isArchived),
            description: repo.description ?? null,
            primaryLanguage: repo.primaryLanguage?.name ?? null,
            stargazerCount: repo.stargazerCount ?? 0,
            forkCount: repo.forkCount ?? 0,
            pushedAt: repo.pushedAt ?? null,
            createdAt: repo.createdAt ?? null,
          }
        : null,
  };
  m.set(key, rec);
  return rec;
}

function touchSeen(rec: ContributionRepoAgg, d: Date) {
  const iso = d.toISOString();
  if (!rec.firstSeen || iso < rec.firstSeen) rec.firstSeen = iso;
  if (!rec.lastSeen || iso > rec.lastSeen) rec.lastSeen = iso;
}

// ---------------------------------------------------------------------------
// Commit search — drive-by contributions
// ---------------------------------------------------------------------------

interface CommitSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: Array<{
    sha: string;
    repository: { full_name: string; owner: { login: string }; private?: boolean };
    author: { login: string } | null;
    committer: { login: string } | null;
    commit: { author: { email: string; name: string; date: string } };
  }>;
}

interface CommitSearchRepo {
  fullName: string;
  ownerLogin: string;
  commits: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
}

async function fetchCommitSearchRepos(
  emails: string[],
): Promise<Map<string, CommitSearchRepo>> {
  const out = new Map<string, CommitSearchRepo>();
  if (emails.length === 0) return out;

  for (const email of emails) {
    // Skip junk that search rejects.
    if (!email.includes("@") || email.length > 120) continue;
    for (let page = 1; page <= COMMIT_SEARCH_MAX_PAGES; page++) {
      // Using `gh api` with the search/commits endpoint.
      // Note: `search/commits` has a total limit of 1000 results, so
      // beyond page 10 GitHub will error; we cap at COMMIT_SEARCH_MAX_PAGES.
      const q = `author-email:${email}`;
      const endpoint = `/search/commits?q=${encodeURIComponent(q)}&per_page=100&page=${page}`;
      const resp = await ghJson<CommitSearchResponse>(
        ["api", endpoint],
        { total_count: 0, incomplete_results: false, items: [] },
      );
      if (!resp || !Array.isArray(resp.items) || resp.items.length === 0) break;
      for (const item of resp.items) {
        const full = item.repository?.full_name;
        if (!full) continue;
        const key = full.toLowerCase();
        const date = item.commit?.author?.date ?? null;
        const existing = out.get(key);
        if (existing) {
          existing.commits += 1;
          if (date) {
            if (!existing.firstCommitAt || date < existing.firstCommitAt)
              existing.firstCommitAt = date;
            if (!existing.lastCommitAt || date > existing.lastCommitAt)
              existing.lastCommitAt = date;
          }
        } else {
          out.set(key, {
            fullName: full,
            ownerLogin: item.repository.owner?.login ?? full.split("/")[0] ?? "",
            commits: 1,
            firstCommitAt: date,
            lastCommitAt: date,
          });
        }
      }
      // Stop early if we got less than a full page — nothing more to fetch.
      if (resp.items.length < 100) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PR search — kept from the previous fetcher
// ---------------------------------------------------------------------------

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
  const lowerHandle = handle.toLowerCase();
  const all: GitHubPR[] = [];
  const seen = new Set<string>();

  // `gh search prs` doesn't accept `--not-merged` (it's parsed as a value
  // for `--closed` and rejected as "not a date/time format"). Just ask
  // for closed PRs; the dedup `seen` set below skips the merged ones the
  // first pass already captured.
  const passes: Array<{ label: string; extra: string[] }> = [
    { label: "merged", extra: ["--merged"] },
    { label: "closed", extra: ["--closed"] },
    { label: "open", extra: ["--state=open"] },
  ];

  for (const pass of passes) {
    const args = [
      "search",
      "prs",
      `--author=${handle}`,
      ...pass.extra,
      "--json",
      "repository,number,title,state,createdAt,closedAt,updatedAt",
      "--limit",
      "1000",
    ];
    const raw = await ghJson<RawPR[]>(args, []);
    if (!Array.isArray(raw)) continue;
    for (const pr of raw) {
      const repoFullName = pr.repository?.nameWithOwner ?? "";
      if (!repoFullName) continue;
      const key = `${repoFullName}#${pr.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const repoOwner = repoFullName.split("/")[0]?.toLowerCase() ?? "";
      const isMerged = pass.label === "merged";
      const stateOut: GitHubPR["state"] = isMerged
        ? "merged"
        : pass.label === "closed"
          ? "closed"
          : "open";
      all.push({
        repoFullName,
        number: pr.number,
        title: pr.title ?? "",
        state: stateOut,
        additions: pr.additions ?? 0,
        deletions: pr.deletions ?? 0,
        changedFiles: pr.changedFiles ?? 0,
        merged: isMerged,
        mergedAt: isMerged ? (pr.closedAt ?? null) : null,
        createdAt: pr.createdAt ?? new Date().toISOString(),
        closedAt: pr.closedAt ?? null,
        reviewDecision: null,
        isExternal: repoOwner !== lowerHandle,
      });
    }
  }

  return all;
}

// ---------------------------------------------------------------------------
// Events + reviews — kept from the previous fetcher
// ---------------------------------------------------------------------------

interface RawEvent {
  type: string;
  repo: { name: string };
  created_at: string;
  payload: Record<string, unknown>;
}

async function fetchEvents(handle: string): Promise<GitHubEvent[]> {
  const raw = await ghJson<RawEvent[]>(
    ["api", `/users/${handle}/events?per_page=100`],
    [],
  );
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => ({
    type: e.type ?? "",
    repoFullName: e.repo?.name ?? "",
    createdAt: e.created_at ?? new Date().toISOString(),
    payload: e.payload ?? {},
  }));
}

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
  const reviewRepos = new Set<string>();
  for (const ev of events) {
    if (ev.type === "PullRequestReviewEvent") reviewRepos.add(ev.repoFullName);
  }

  const reviews: GitHubReview[] = [];
  const lowerHandle = handle.toLowerCase();

  for (const repo of reviewRepos) {
    const prs = await ghJson<Array<{ number: number }>>(
      ["api", `/repos/${repo}/pulls?state=all&per_page=100`],
      [],
    );
    if (!Array.isArray(prs)) continue;

    for (const pr of prs) {
      const rawReviews = await ghJson<RawReview[]>(
        ["api", `/repos/${repo}/pulls/${pr.number}/reviews`],
        [],
      );
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
    }
  }

  return reviews;
}

// ---------------------------------------------------------------------------
// Merge step — de-dupe by fullName, attach strongest relationship,
// fold in contribution signals + commit-search evidence
// ---------------------------------------------------------------------------

const RELATIONSHIP_STRENGTH: Record<RepoRelationship, number> = {
  owner: 5,
  collaborator: 4,
  org_member: 3,
  contributor: 2,
  reviewer: 1,
};

function strongestRelationship(
  relationships: RepoRelationship[],
): RepoRelationship {
  let best: RepoRelationship = relationships[0] ?? "contributor";
  let bestScore = RELATIONSHIP_STRENGTH[best];
  for (const r of relationships) {
    const s = RELATIONSHIP_STRENGTH[r];
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return best;
}

function mergeRepos(args: {
  handle: string;
  accessible: RepoRef[];
  contributions: Map<string, ContributionRepoAgg>;
  commitSearch: Map<string, CommitSearchRepo>;
  authoredPRs: GitHubPR[];
  reviews: GitHubReview[];
}): RepoRef[] {
  const { accessible, contributions, commitSearch, authoredPRs, reviews } = args;
  const byKey = new Map<string, RepoRef>();

  // Seed with the accessible set (owner/collaborator/org_member).
  for (const r of accessible) {
    byKey.set(r.fullName.toLowerCase(), r);
  }

  // Layer in contribution signals. Promote the repo if not already there.
  for (const [key, c] of contributions) {
    const existing = byKey.get(key);
    if (existing) {
      const prior = existing.relationships ?? [];
      if (!prior.includes("contributor")) {
        const updated = [...prior, "contributor" as RepoRelationship];
        existing.relationships = updated;
        existing.relationship = strongestRelationship(updated);
      }
      existing.discoveredVia = Array.from(
        new Set([...(existing.discoveredVia ?? []), "contributions-graphql"]),
      );
      existing.contributionSignals = {
        ...(existing.contributionSignals ?? {}),
        commits: c.commits,
        prsOpened: c.prsOpened,
        issues: c.issues,
        reviews: c.reviews,
        firstContribution: c.firstSeen,
        lastContribution: c.lastSeen,
      };
    } else {
      const parts = c.fullName.split("/");
      byKey.set(key, {
        name: parts[1] ?? c.fullName,
        owner: c.ownerLogin || parts[0] || "",
        fullName: c.fullName,
        isPrivate: c.isPrivate,
        isFork: c.meta?.isFork ?? false,
        isArchived: c.meta?.isArchived ?? false,
        description: c.meta?.description ?? null,
        primaryLanguage: c.meta?.primaryLanguage ?? null,
        languages: c.meta?.primaryLanguage ? [c.meta.primaryLanguage] : [],
        stargazerCount: c.meta?.stargazerCount ?? 0,
        forkCount: c.meta?.forkCount ?? 0,
        pushedAt: c.meta?.pushedAt ?? c.lastSeen,
        createdAt: c.meta?.createdAt ?? null,
        relationship: "contributor",
        relationships: ["contributor"],
        discoveredVia: ["contributions-graphql"],
        contributionSignals: {
          commits: c.commits,
          prsOpened: c.prsOpened,
          issues: c.issues,
          reviews: c.reviews,
          firstContribution: c.firstSeen,
          lastContribution: c.lastSeen,
        },
      });
    }
  }

  // Layer in commit-search repos (drive-by contributions).
  for (const [key, c] of commitSearch) {
    const existing = byKey.get(key);
    if (existing) {
      existing.discoveredVia = Array.from(
        new Set([...(existing.discoveredVia ?? []), "commit-search"]),
      );
      const prior = existing.relationships ?? [];
      if (!prior.includes("contributor") && !prior.includes("owner")) {
        const updated = [...prior, "contributor" as RepoRelationship];
        existing.relationships = updated;
        existing.relationship = strongestRelationship(updated);
      }
      const sig = existing.contributionSignals ?? {};
      existing.contributionSignals = {
        ...sig,
        commits: Math.max(sig.commits ?? 0, c.commits),
        firstContribution:
          sig.firstContribution && c.firstCommitAt
            ? sig.firstContribution < c.firstCommitAt
              ? sig.firstContribution
              : c.firstCommitAt
            : (sig.firstContribution ?? c.firstCommitAt),
        lastContribution:
          sig.lastContribution && c.lastCommitAt
            ? sig.lastContribution > c.lastCommitAt
              ? sig.lastContribution
              : c.lastCommitAt
            : (sig.lastContribution ?? c.lastCommitAt),
      };
    } else {
      const parts = c.fullName.split("/");
      byKey.set(key, {
        name: parts[1] ?? c.fullName,
        owner: c.ownerLogin || parts[0] || "",
        fullName: c.fullName,
        isPrivate: false,
        isFork: false,
        isArchived: false,
        description: null,
        primaryLanguage: null,
        languages: [],
        stargazerCount: 0,
        forkCount: 0,
        pushedAt: c.lastCommitAt,
        createdAt: null,
        relationship: "contributor",
        relationships: ["contributor"],
        discoveredVia: ["commit-search"],
        contributionSignals: {
          commits: c.commits,
          firstContribution: c.firstCommitAt,
          lastContribution: c.lastCommitAt,
        },
      });
    }
  }

  // Mark repos where the user has authored PRs as contributor (even if
  // contributionsCollection missed them). Creates a synthetic entry when
  // the repo wasn't seen elsewhere — otherwise a one-off PR to a repo we
  // never contributed commits to would silently drop.
  const prByRepo = new Map<string, GitHubPR[]>();
  for (const pr of authoredPRs) {
    const key = pr.repoFullName.toLowerCase();
    (prByRepo.get(key) ?? prByRepo.set(key, []).get(key)!).push(pr);
  }
  for (const [key, prs] of prByRepo) {
    const existing = byKey.get(key);
    if (existing) {
      const prior = existing.relationships ?? [];
      if (!prior.includes("contributor") && !prior.includes("owner")) {
        const updated = [...prior, "contributor" as RepoRelationship];
        existing.relationships = updated;
        existing.relationship = strongestRelationship(updated);
      }
      existing.discoveredVia = Array.from(
        new Set([...(existing.discoveredVia ?? []), "pr-search"]),
      );
    } else {
      const fullName = prs[0]?.repoFullName ?? key;
      const parts = fullName.split("/");
      const merged = prs.filter((p) => p.merged).length;
      const lastSeen =
        prs
          .map((p) => p.mergedAt ?? p.closedAt ?? p.createdAt)
          .sort()
          .reverse()[0] ?? null;
      const firstSeen =
        prs
          .map((p) => p.createdAt)
          .sort()[0] ?? null;
      byKey.set(key, {
        name: parts[1] ?? fullName,
        owner: parts[0] ?? "",
        fullName,
        isPrivate: false,
        isFork: false,
        isArchived: false,
        description: null,
        primaryLanguage: null,
        languages: [],
        stargazerCount: 0,
        forkCount: 0,
        pushedAt: lastSeen,
        createdAt: null,
        relationship: "contributor",
        relationships: ["contributor"],
        discoveredVia: ["pr-search"],
        contributionSignals: {
          prsOpened: prs.length,
          prsMerged: merged,
          firstContribution: firstSeen,
          lastContribution: lastSeen,
        },
      });
    }
  }

  // Same for review repos.
  const reviewRepos = new Set<string>();
  for (const rv of reviews) reviewRepos.add(rv.repoFullName.toLowerCase());
  for (const key of reviewRepos) {
    const r = byKey.get(key);
    if (!r) continue;
    const prior = r.relationships ?? [];
    if (!prior.includes("reviewer") && !prior.includes("owner")) {
      const updated = [...prior, "reviewer" as RepoRelationship];
      r.relationships = updated;
      r.relationship = strongestRelationship(updated);
    }
  }

  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Org access state — compute which orgs we couldn't see
// ---------------------------------------------------------------------------

function computeOrgAccess(
  orgs: RawOrg[],
  repos: RepoRef[],
): OrgAccess[] {
  const repoOwnerCount = new Map<string, number>();
  for (const r of repos) {
    const key = (r.owner ?? "").toLowerCase();
    if (!key) continue;
    repoOwnerCount.set(key, (repoOwnerCount.get(key) ?? 0) + 1);
  }

  return orgs.map((o) => {
    const loginLower = o.login.toLowerCase();
    const visible = repoOwnerCount.get(loginLower) ?? 0;
    // Heuristic: member of the org but we got 0 repos back — either SSO
    // enforcement without an authorized token, or the org has OAuth-app
    // access policy enabled and hasn't approved us. We can't always tell
    // from one call alone, so we default to sso_required (since the SSO
    // URL works for both flows: GitHub redirects to the right page).
    const state: OrgAccess["state"] = visible === 0 ? "sso_required" : "ok";
    const resolveUrl =
      state === "sso_required"
        ? `https://github.com/orgs/${o.login}/sso`
        : undefined;
    return {
      login: o.login,
      displayName: o.name ?? o.login,
      avatarUrl: o.avatar_url ?? null,
      state,
      resolveUrl,
      reposVisible: visible,
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function fetchGitHubData(handle: string): Promise<GitHubData> {
  // Parallel phase 1: calls that don't depend on anything else.
  const [profile, userEmails, orgs, accessibleRepos, authoredPRs, recentEvents] =
    await Promise.all([
      fetchProfile(handle),
      fetchEmails(),
      fetchOrgs(),
      fetchAccessibleRepos(handle),
      fetchAuthoredPRs(handle),
      fetchEvents(handle),
    ]);

  // Phase 2: contributions (needs profile.createdAt) + commit search
  // (needs emails). Both run in parallel.
  const [contributions, commitSearch] = await Promise.all([
    fetchContributions(profile),
    fetchCommitSearchRepos(userEmails),
  ]);

  // Phase 3: reviews — depends on events
  const submittedReviews = await fetchReviews(handle, recentEvents);

  // Merge everything into a single repo list, collapsing duplicates.
  const mergedRepos = mergeRepos({
    handle,
    accessible: accessibleRepos,
    contributions: contributions.repos,
    commitSearch,
    authoredPRs,
    reviews: submittedReviews,
  });

  // Mark each PR as external based on the final repo set (org repos no
  // longer count as external even if the owner isn't the handle).
  const ownedOrMember = new Set<string>();
  for (const r of mergedRepos) {
    const rel = r.relationship;
    if (rel === "owner" || rel === "collaborator" || rel === "org_member") {
      ownedOrMember.add(r.fullName.toLowerCase());
    }
  }
  for (const pr of authoredPRs) {
    pr.isExternal = !ownedOrMember.has(pr.repoFullName.toLowerCase());
  }

  // Compute org access state.
  const orgAccess = computeOrgAccess(orgs, mergedRepos);

  // Aggregate stats for the UI.
  const countByRelationship = (rel: RepoRelationship) =>
    mergedRepos.filter((r) => r.relationship === rel).length;

  const fetchStats = {
    ownedRepos: countByRelationship("owner"),
    orgRepos:
      countByRelationship("org_member") + countByRelationship("collaborator"),
    contributionRepos: countByRelationship("contributor"),
    commitSearchRepos: [...commitSearch.keys()].filter((k) => {
      const r = mergedRepos.find((x) => x.fullName.toLowerCase() === k);
      return r && r.discoveredVia?.includes("commit-search");
    }).length,
    orgsVisible: orgAccess.filter((o) => o.state === "ok").length,
    orgsLocked: orgAccess.filter((o) => o.state !== "ok").length,
    privateContributionCount: contributions.totals.restricted,
    restrictedContributionCount: contributions.totals.restricted,
  };

  ghLog.info(
    {
      owned_repos: fetchStats.ownedRepos,
      org_repos: fetchStats.orgRepos,
      contribution_repos: fetchStats.contributionRepos,
      commit_search_repos: fetchStats.commitSearchRepos,
      orgs_visible: fetchStats.orgsVisible,
      orgs_locked: fetchStats.orgsLocked,
      prs: authoredPRs.length,
      reviews: submittedReviews.length,
      private_contributions_visible: contributions.privateContributionsVisible,
      private_contributions_hidden: contributions.privateContributionsHidden,
      arg_limit: GH_CLI_ARG_LIMIT,
    },
    "github-fetch complete",
  );

  return {
    profile,
    ownedRepos: mergedRepos,
    userEmails,
    authoredPRs,
    submittedReviews,
    recentEvents,
    orgAccess,
    privateContributionsVisible:
      contributions.privateContributionsVisible ||
      !contributions.privateContributionsHidden,
    fetchStats,
  };
}
