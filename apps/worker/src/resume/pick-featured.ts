/**
 * Pick featured project candidates — the top ~20 repos that deserve a
 * full-resolution card in the "My Projects" grid.
 *
 * Scoring heuristic (unweighted rank composite):
 *   1. Pinned repos (always in, regardless of score).
 *   2. Stars × 3 + merged-PRs × 2 + user_commit_count × 0.5.
 *   3. Non-fork, non-archived only.
 *   4. Has README OR homepage URL (quality filter).
 *
 * Falls back gracefully — if a user has <20 repos total, everything they
 * own gets a full card.
 *
 * This runs BEFORE the projects-agent fan-out and decides which repos
 * pay the 3-5 web-research calls per project budget.
 */

import type { Artifact } from "../schemas.js";
import type { GitHubData, RepoRef } from "../types.js";

// Curated "My Projects" grid — the template caps visible cards around
// 4-6. Previously set to 20 which blew the wall-clock (each card spends
// a ~2min web-research budget). The exhaustive timeline lives in
// buildLog — it carries the breadth signal, not this section.
const TARGET = 6;

export function pickFeatured(
  github: GitHubData,
  artifacts: Record<string, Artifact>,
  targetCount: number = TARGET,
): string[] {
  // Note: the current GitHubFetcher doesn't yet surface pinned repos.
  // When it does, preserve pinned ordering here. For now we lean
  // entirely on the score heuristic.
  //
  // Featured = owned + collaborator only. Drive-by contributor repos
  // (merged PRs into facebook/react, etc.) belong in the open-source
  // contributions section / build log, not the "My Projects" grid —
  // the user didn't build them.
  const candidates = github.ownedRepos
    .filter((r: RepoRef) => {
      const rel = r.relationship ?? "owner";
      if (rel === "contributor" || rel === "reviewer") return false;
      if (r.isFork || r.isArchived) return false;
      // Noise filter: contribution-graph mirrors, dotfiles, config
      // dumps, and sandbox clones routinely score high on commits but
      // are never real "projects". Drop them by name + description
      // signal before they reach the deep-research agent.
      if (isNoiseRepo(r)) return false;
      return true;
    })
    .map((r: RepoRef) => ({
      repo: r,
      score: scoreRepo(r, artifacts),
    }))
    .filter((c) => c.score > 0);

  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, targetCount).map((c) => c.repo.fullName);
}

/**
 * Repo-name + description heuristics for repos that LOOK prolific
 * (high commits) but aren't real projects. Contribution-graph mirrors
 * in particular explode commit counts via bulk import and show up as
 * false top-6 candidates. Caught here rather than asking the LLM to
 * notice, because the LLM has already committed to writing a card by
 * the time the projects-agent sees them.
 */
const NOISE_NAME_PATTERNS = [
  /^\.?dotfiles$/i,
  /^\.?config$/i,
  /^learn(ing)?$/i,
  /^playground$/i,
  /^sandbox$/i,
  /^scratch$/i,
  /^testing?$/i,
  /^tmp$/i,
  /mirror$/i,
  /contrib(utions?)[-_]?(importer|mirror|graph|sync)/i,
];

// Generic only — no vendor-specific keywords. This catches the 80%
// obvious-noise case cheaply; the robust answer is a Kimi repo-judge
// stage (read README + source files, decide if real) coming in a
// follow-up PR.
const NOISE_DESC_PATTERNS = [
  /auto-?generated\s+mock/i,
  /contributions?\s+importer/i,
  /contribution-?graph\s+mirror/i,
  /no\s+real\s+source\s+code/i,
  /mirror(ed)?\s+of\s+(?:a\s+)?private/i,
];

function isNoiseRepo(repo: RepoRef): boolean {
  const name = repo.name ?? "";
  if (NOISE_NAME_PATTERNS.some((p) => p.test(name))) return true;
  const desc = repo.description ?? "";
  if (NOISE_DESC_PATTERNS.some((p) => p.test(desc))) return true;
  return false;
}

function scoreRepo(
  repo: RepoRef,
  artifacts: Record<string, Artifact>,
): number {
  const stars = repo.stargazerCount ?? 0;
  const commits = repo.userCommitCount ?? 0;
  const m = (artifacts[`repo:${repo.fullName}`]?.metadata as Record<string, unknown> | undefined) ?? {};
  const hasReadme = Boolean(m.has_readme);

  // Quality floor: must have meaningful commit history OR stars to
  // warrant a deep card. Otherwise it's just a scratch repo.
  if (!hasReadme && commits < 5 && stars === 0) return 0;

  return stars * 3 + commits * 0.5;
}
