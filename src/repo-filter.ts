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
 */

import type { GitHubData, RepoRef, FilterResult, AnalysisTier } from "./types.js";

// ---------------------------------------------------------------------------
// Scoring weights (for ranking within tiers)
// ---------------------------------------------------------------------------

const COMMIT_WEIGHT = 1;
const STAR_WEIGHT = 5;
const RECENCY_WEIGHT = 20;
const LANGUAGE_WEIGHT = 3;
const PRIVATE_BONUS = 10;

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

/** Estimate user commit count from PRs and push events. */
function buildCommitCounts(data: GitHubData): Map<string, number> {
  const counts = new Map<string, number>();

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

  return counts;
}

/** Score a repo for ranking purposes. */
function scoreRepo(repo: RepoRef, commitCount: number): number {
  return (
    COMMIT_WEIGHT * commitCount +
    STAR_WEIGHT * Math.log2(repo.stargazerCount + 1) +
    RECENCY_WEIGHT * recencyFactor(repo.pushedAt) +
    LANGUAGE_WEIGHT * repo.languages.length +
    (repo.isPrivate ? PRIVATE_BONUS : 0)
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
 * deep:     Has a programming language + any activity signal → full clone + FIFO + agent
 * light:    Has activity but no code language (HTML-only, docs repos) → clone + inventory
 * metadata: No activity at all, or pure forks with no work
 */
function assignTier(repo: RepoRef, commitCount: number): AnalysisTier {
  // Pure fork with no visible contributions → metadata
  if (repo.isFork && commitCount < 2 && daysSince(repo.pushedAt) > 365) return "metadata";

  // Archived with no recent activity → metadata
  if (repo.isArchived && daysSince(repo.pushedAt) > 730) return "metadata";

  // No language detected and no commits → metadata (empty/template repos)
  if (!repo.primaryLanguage && commitCount === 0 && daysSince(repo.pushedAt) > 365) return "metadata";

  // Has a real programming language + pushed in last 2 years → deep
  // We can't trust commitCount from API (direct pushes = 0), so any
  // repo with code and recent activity gets the full treatment.
  if (repo.primaryLanguage && daysSince(repo.pushedAt) < 730) return "deep";

  // Has known commits (from PRs/events) → deep regardless of language
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

  for (const repo of data.ownedRepos) {
    const key = repo.fullName.toLowerCase();
    const commitCount = commitCounts.get(key) ?? 0;

    repo.userCommitCount = commitCount;
    repo.significanceScore = Math.round(scoreRepo(repo, commitCount) * 100) / 100;

    const tier = assignTier(repo, commitCount);
    repo.analysisTier = tier;

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

  // Sort each tier by significance score
  deep.sort((a, b) => (b.significanceScore ?? 0) - (a.significanceScore ?? 0));
  light.sort((a, b) => (b.significanceScore ?? 0) - (a.significanceScore ?? 0));

  // Build external repo list — repos the user contributed to but doesn't own
  const ownedSet = new Set(data.ownedRepos.map((r) => r.fullName.toLowerCase()));
  const externalNames = new Set<string>();

  for (const pr of data.authoredPRs) {
    if (pr.isExternal && pr.merged) {
      externalNames.add(pr.repoFullName.toLowerCase());
    }
  }

  const external: RepoRef[] = [];
  for (const fullName of externalNames) {
    if (ownedSet.has(fullName)) continue;
    const parts = fullName.split("/");
    const prsForRepo = data.authoredPRs.filter(
      (pr) => pr.repoFullName.toLowerCase() === fullName
    );
    external.push({
      name: parts[1] ?? fullName,
      owner: parts[0] ?? "",
      fullName: prsForRepo[0]?.repoFullName ?? fullName,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      description: null,
      primaryLanguage: null,
      languages: [],
      stargazerCount: 0,
      forkCount: 0,
      pushedAt: prsForRepo[0]?.mergedAt ?? null,
      createdAt: null,
      userCommitCount: prsForRepo.length,
      significanceScore: prsForRepo.length,
      analysisTier: "deep", // external repos always get deep analysis
    });
  }

  return { deep, light, metadata, external };
}
