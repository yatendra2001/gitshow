/**
 * Repo filtering and tiered analysis assignment.
 *
 * IMPORTANT: We do NOT reject repos. Every repo is included in the profile.
 * Instead, we assign analysis tiers:
 *   - deep:     Full clone + FIFO lifecycle + blame + ownership + agent analysis
 *   - light:    Clone + basic inventory (commits, languages, files), no agent call
 *   - metadata: GitHub API data only, no clone
 *
 * This ensures we can connect dots across repos — even a 3-commit shared-types
 * library might be the glue between 5 other repos.
 *
 * Relationships drive the tiering too:
 *   - owner / collaborator / org_member → tier by activity (existing logic)
 *   - contributor (drive-by PR or commit-search) → tier by signals from
 *     contributionsCollection. A PR to facebook/react should never be
 *     `metadata` — external impact is the whole signal.
 *   - reviewer-only → `metadata` (we won't clone)
 */

import type {
  GitHubData,
  RepoRef,
  FilterResult,
  AnalysisTier,
  RepoRelationship,
} from "./types.js";

// ---------------------------------------------------------------------------
// Scoring weights (for ranking within tiers)
// ---------------------------------------------------------------------------

const COMMIT_WEIGHT = 1;
const STAR_WEIGHT = 5;
const RECENCY_WEIGHT = 20;
const LANGUAGE_WEIGHT = 3;
const PRIVATE_BONUS = 10;
/**
 * External contribution bonus — a merged PR to a ~thousand-star repo is
 * more signal than most solo projects. Scaled by log2(stars).
 */
const EXTERNAL_STAR_WEIGHT = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysSince(dateStr: string | null): number {
  if (!dateStr) return Infinity;
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

function recencyFactor(pushedAt: string | null): number {
  const days = daysSince(pushedAt);
  if (days < 30) return 1.0;
  if (days < 180) return 0.5;
  if (days < 365) return 0.2;
  return 0.05;
}

function isExternal(rel: RepoRelationship | undefined): boolean {
  return rel === "contributor" || rel === "reviewer";
}

function isOwnedOrMember(rel: RepoRelationship | undefined): boolean {
  return rel === "owner" || rel === "collaborator" || rel === "org_member";
}

/**
 * Estimate user commit count per repo. Combines:
 *   - PR search (1 per PR regardless of merge state)
 *   - PushEvent payload size from /events (raw commits)
 *   - contributionsCollection commits (drive-by repos the user doesn't own)
 *   - commit-search results (last-resort for truly external drive-bys)
 *
 * We take the *max* across sources because they double-count — a PR
 * shows up in PR search AND in contributionsCollection, but represents
 * the same underlying commit.
 */
function buildCommitCounts(data: GitHubData): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (key: string, n: number) => {
    const cur = counts.get(key) ?? 0;
    if (n > cur) counts.set(key, n);
  };

  for (const pr of data.authoredPRs) {
    const key = pr.repoFullName.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const ev of data.recentEvents) {
    if (ev.type !== "PushEvent") continue;
    const key = ev.repoFullName.toLowerCase();
    const size = typeof ev.payload.size === "number" ? ev.payload.size : 1;
    counts.set(key, (counts.get(key) ?? 0) + size);
  }

  // Layer in contribution signals — these are the only source for repos
  // the user doesn't own and didn't PR to (direct-push drive-bys).
  for (const repo of data.ownedRepos) {
    const key = repo.fullName.toLowerCase();
    const sig = repo.contributionSignals;
    if (!sig) continue;
    bump(key, sig.commits ?? 0);
  }

  return counts;
}

/** Score a repo for ranking purposes. */
function scoreRepo(repo: RepoRef, commitCount: number): number {
  const external = isExternal(repo.relationship);
  const externalBonus = external
    ? EXTERNAL_STAR_WEIGHT * Math.log2(repo.stargazerCount + 1)
    : 0;
  return (
    COMMIT_WEIGHT * commitCount +
    STAR_WEIGHT * Math.log2(repo.stargazerCount + 1) +
    RECENCY_WEIGHT * recencyFactor(repo.pushedAt) +
    LANGUAGE_WEIGHT * repo.languages.length +
    (repo.isPrivate ? PRIVATE_BONUS : 0) +
    externalBonus
  );
}

/**
 * Assign analysis tier based on what we know about the repo.
 *
 * Philosophy: if a repo has a real programming language and any sign of
 * activity, deep-analyze it. We can't count commits from the API reliably
 * (direct pushes without PRs show as 0), so we err on the side of cloning.
 * The clone + pre-compute is cheap (~10s). The agent call is where cost is,
 * but that's where the value is too.
 *
 * External (contributor/reviewer) repos skip the full clone — we don't own
 * them, we just want to surface the PR/commit signal for the resume. They
 * always get `deep` so the projects/work agents see the full signal.
 */
function assignTier(repo: RepoRef, commitCount: number): AnalysisTier {
  const rel = repo.relationship;

  // Reviewer-only → metadata. No code to show.
  if (rel === "reviewer") return "metadata";

  // Drive-by contributor repos → deep (surface external impact on resume),
  // but inventory-runner skips cloning these. The projects agent still
  // reads their artifacts + contribution signals.
  if (rel === "contributor") return "deep";

  // Owned / collaborator / org_member → existing activity-based tiering.

  // Pure fork with no visible contributions → metadata
  if (repo.isFork && commitCount < 2 && daysSince(repo.pushedAt) > 365) return "metadata";

  // Archived with no recent activity → metadata
  if (repo.isArchived && daysSince(repo.pushedAt) > 730) return "metadata";

  // No language detected and no commits → metadata (empty/template repos)
  if (!repo.primaryLanguage && commitCount === 0 && daysSince(repo.pushedAt) > 365) return "metadata";

  // Has a real programming language + pushed in last 2 years → deep
  if (repo.primaryLanguage && daysSince(repo.pushedAt) < 730) return "deep";

  // Has known commits (from PRs/events/contrib) → deep regardless of language
  if (commitCount >= 5) return "deep";

  // Has a language but stale → light (clone to check, but don't run agent)
  if (repo.primaryLanguage) return "light";

  // Recent but no language (docs repo, config repo) → light
  if (daysSince(repo.pushedAt) < 365) return "light";

  // Everything else → metadata
  return "metadata";
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function filterRepos(data: GitHubData): FilterResult {
  const commitCounts = buildCommitCounts(data);

  const deep: RepoRef[] = [];
  const light: RepoRef[] = [];
  const metadata: RepoRef[] = [];
  const external: RepoRef[] = [];

  for (const repo of data.ownedRepos) {
    const key = repo.fullName.toLowerCase();
    const commitCount = commitCounts.get(key) ?? 0;

    repo.userCommitCount = commitCount;
    repo.significanceScore = Math.round(scoreRepo(repo, commitCount) * 100) / 100;

    const tier = assignTier(repo, commitCount);
    repo.analysisTier = tier;

    // External repos live in their own bucket so agents can reason about
    // "projects I shipped" vs "places I contributed". They may also
    // appear in `deep` when the tier landed there, but the `external`
    // list is the canonical source for the Projects agent's
    // external-contribution pass.
    if (isExternal(repo.relationship)) {
      external.push(repo);
      if (tier === "deep") deep.push(repo);
      else if (tier === "light") light.push(repo);
      else metadata.push(repo);
      continue;
    }

    switch (tier) {
      case "deep":
        deep.push(repo);
        break;
      case "light":
        light.push(repo);
        break;
      case "metadata":
        metadata.push(repo);
        break;
    }
  }

  // Sort: owned/collaborator first, then by significance. This way the
  // inventory cap (first N of `deep`) never starves owned projects.
  const tierSort = (a: RepoRef, b: RepoRef) => {
    const aOwned = isOwnedOrMember(a.relationship) ? 1 : 0;
    const bOwned = isOwnedOrMember(b.relationship) ? 1 : 0;
    if (aOwned !== bOwned) return bOwned - aOwned;
    return (b.significanceScore ?? 0) - (a.significanceScore ?? 0);
  };
  deep.sort(tierSort);
  light.sort(tierSort);
  external.sort((a, b) => (b.significanceScore ?? 0) - (a.significanceScore ?? 0));

  return { deep, light, metadata, external };
}
