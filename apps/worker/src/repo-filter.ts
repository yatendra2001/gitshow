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
//
// Depth of contribution outranks raw star count. A user's 200-commit
// solo project with 10 stars beats a 25-star fork they barely touched.
// Stars only become decisive at the famous-OSS threshold (1k+) where
// the external reach is the headline by itself.

const COMMIT_DEPTH_WEIGHT = 3;
const STAR_LOG_WEIGHT = 4;
const RECENCY_WEIGHT = 15;
const LANGUAGE_WEIGHT = 2;
const PRIVATE_BONUS = 8;
/**
 * External (contributor) impact: log2(stars) × commits. A merged PR to
 * a 20k-star repo is a flagship signal even with 1 commit; a PR to a
 * 50-star repo only matters if you contributed substantially.
 */
const EXTERNAL_STAR_WEIGHT = 12;

/**
 * Stepped bonus for OWNED repos with traction. Your own 200-star
 * project is a meaningful achievement — bump it well above similar
 * unstarred work.
 */
function ownerFameBonus(stars: number): number {
  if (stars >= 1000) return 80;
  if (stars >= 200) return 40;
  if (stars >= 50) return 20;
  if (stars >= 20) return 10;
  if (stars >= 10) return 5;
  return 0;
}

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
  const stars = repo.stargazerCount ?? 0;
  const external = isExternal(repo.relationship);

  // External path — the value is reach × evidence-of-contribution.
  // 1 commit to a 20k-star OSS project >>> 200 commits in a personal
  // CRUD app, so we let star-log dominate but require a commit.
  if (external) {
    const reach = EXTERNAL_STAR_WEIGHT * Math.log2(stars + 1);
    const depthMultiplier = Math.max(1, Math.log2(commitCount + 1));
    return reach * depthMultiplier + RECENCY_WEIGHT * recencyFactor(repo.pushedAt);
  }

  // Owned / collaborator path — depth dominates, fame is a step bonus.
  let s =
    COMMIT_DEPTH_WEIGHT * commitCount +
    ownerFameBonus(stars) +
    STAR_LOG_WEIGHT * Math.log2(stars + 1) +
    RECENCY_WEIGHT * recencyFactor(repo.pushedAt) +
    LANGUAGE_WEIGHT * repo.languages.length +
    (repo.isPrivate ? PRIVATE_BONUS : 0);

  // Fork penalty — a fork you barely touched isn't your work, even if
  // upstream is famous. Only forks with substantial author commits
  // escape the cut.
  if (repo.isFork && commitCount < 10) {
    s *= 0.3;
  }

  return s;
}

/**
 * Assign analysis tier based on what we know about the repo.
 *
 * Two principles:
 *   1. Depth-of-contribution > raw stars. A barely-touched fork should
 *      never deep-tier even if it's a fork of a famous project. Stars
 *      only override that at the genuinely-famous threshold (1k+),
 *      where the external impact is itself the story.
 *   2. External contributions get tiered by reach × commits. A merged
 *      PR to a 20k-star OSS project is a flagship; a 1-commit PR to a
 *      50-star repo isn't.
 *
 * The clone is cheap (~10s); the LLM judge is where cost lives. So we
 * deep-tier whenever there's a credible signal that the user actually
 * built something here.
 */
function assignTier(repo: RepoRef, commitCount: number): AnalysisTier {
  const rel = repo.relationship;
  const stars = repo.stargazerCount ?? 0;

  // Reviewer-only → metadata. No code to show.
  if (rel === "reviewer") return "metadata";

  // External contributor — never clone. The user only authored a tiny
  // fraction of the source tree, so a clone gives us nothing useful
  // (blame would read 0.01% authorship). The github-facts fetcher
  // already emits CONTRIBUTED_TO edges for these via the GitHub API,
  // which is everything the renderer needs to surface "contributed N
  // PRs to facebook/react" on the resume. Cloning flutter/engine just
  // to learn it's flutter/engine is a tax we don't need to pay.
  //
  // (Earlier this returned "deep" for 1k+ star contributions, which
  // dragged in 100+ giant external clones per scan and pegged the
  // worker at load-15 for an hour.)
  if (rel === "contributor") return "metadata";

  // Owned / collaborator / org_member.

  // Pure fork with no real contribution → metadata, regardless of
  // upstream stars or how recently it was pushed. Catches the
  // "starred-then-forked someone else's project" case.
  if (repo.isFork && commitCount < 2) return "metadata";

  // Archived & stale → metadata
  if (repo.isArchived && daysSince(repo.pushedAt) > 730) return "metadata";

  // Substantial owner-side commits → deep no matter what.
  if (commitCount >= 20) return "deep";

  // Owned with traction (10+ stars on the user's own repo) is a real
  // signal worth digging into, even if commit count is modest.
  if (stars >= 10 && (commitCount >= 1 || repo.primaryLanguage)) return "deep";

  // Has a real language + recently pushed → deep
  if (repo.primaryLanguage && daysSince(repo.pushedAt) < 730) return "deep";

  // Has commits but no detected language → still deep
  if (commitCount >= 5) return "deep";

  // Has a language but stale → light (clone to check, but don't run agent)
  if (repo.primaryLanguage) return "light";

  // Recent but no language (docs repo, config repo) → light
  if (daysSince(repo.pushedAt) < 365) return "light";

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
