/**
 * Normalize — build the unified Artifact table from raw data.
 *
 * Input: GitHubData (repos, PRs, reviews, profile) + StructuredInventory per repo.
 * Output: `Record<artifact_id, Artifact>` — every commit, PR, repo, review, release
 * gets a stable id that claims can point at.
 *
 * ID conventions (all stable across runs given the same source):
 *   commit:<repo>/<shortSha>
 *   pr:<owner>/<repo>#<number>
 *   repo:<owner>/<repo>
 *   review:<owner>/<repo>#<pr>:<iso_date>
 *   release:<owner>/<repo>@<tag>
 *   web:<sha256(url)-first12>
 *
 * The artifact table is intentionally richer than what a single worker
 * will read — workers use `query_artifacts` to pull slices.
 */

import type { Artifact } from "./schemas.js";
import type {
  GitHubData,
  GitHubPR,
  GitHubReview,
  RepoRef,
  StructuredInventory,
  StructuredCommit,
} from "./types.js";

export interface NormalizeInput {
  github: GitHubData;
  /** Per-repo inventories keyed by repo fullName (e.g., "owner/name"). */
  inventories: Record<string, StructuredInventory>;
}

export interface NormalizeResult {
  artifacts: Record<string, Artifact>;
  /** Secondary indexes for fast querying by workers. */
  indexes: ArtifactIndexes;
}

export interface ArtifactIndexes {
  /** Artifacts by type. */
  byType: Record<string, string[]>;
  /** Artifacts by repo fullName (commits, PRs, reviews, releases under a repo). */
  byRepo: Record<string, string[]>;
  /** PRs where the user is external (contributed to someone else's repo). */
  externalPrIds: string[];
  /** Repos owned by the user. */
  ownedRepoIds: string[];
  /** Repos where user contributed externally. */
  externalRepoFullNames: string[];
}

const now = () => new Date().toISOString();

export function normalize(input: NormalizeInput): NormalizeResult {
  const artifacts: Record<string, Artifact> = {};
  const byType: Record<string, string[]> = {};
  const byRepo: Record<string, string[]> = {};
  const externalPrIds: string[] = [];
  const ownedRepoIds: string[] = [];
  const externalRepoFullNames = new Set<string>();

  const recordedAt = now();

  const push = (a: Artifact, repoFullName?: string) => {
    artifacts[a.id] = a;
    (byType[a.type] ??= []).push(a.id);
    if (repoFullName) (byRepo[repoFullName] ??= []).push(a.id);
  };

  // ── Repos (all — owned + contributions) ─────────────────────
  // The `github.ownedRepos` list is now a union: owned, collaborator,
  // org_member, and drive-by contributor repos. We emit a repo artifact
  // for each, with `relationship` metadata so agents can tell
  // "facebook/react — merged PRs" apart from "yatendra/my-side-project".
  //
  // There is only ONE commit count per repo exposed to agents:
  // `user_commit_count`. Before normalize finishes, we overwrite this with
  // the authoritative git-log value from inventory when one is available.
  // Any earlier PR-based estimate is intentionally not surfaced — multiple
  // numbers for the same thing confuse agents.
  for (const repo of input.github.ownedRepos) {
    const id = repoArtifactId(repo.fullName);
    const rel = repo.relationship ?? "owner";
    const relationshipIsExternal =
      rel === "contributor" || rel === "reviewer";
    push(
      {
        id,
        type: "repo",
        source_url: `https://github.com/${repo.fullName}`,
        title: repo.name,
        excerpt: repo.description ?? undefined,
        metadata: {
          owner: repo.owner,
          full_name: repo.fullName,
          is_private: repo.isPrivate,
          is_fork: repo.isFork,
          is_archived: repo.isArchived,
          primary_language: repo.primaryLanguage,
          languages: repo.languages,
          stars: repo.stargazerCount,
          forks: repo.forkCount,
          pushed_at: repo.pushedAt,
          created_at: repo.createdAt,
          user_commit_count: repo.userCommitCount,
          commit_count_source: "pr_estimate",
          is_external: relationshipIsExternal,
          /**
           * How the user relates to this repo:
           *   owner        — their own repo
           *   collaborator — personal invite on someone else's repo
           *   org_member   — repo sits under an org they belong to
           *   contributor  — drive-by (merged PR or commit-search hit)
           *   reviewer     — only reviewed someone else's PR here
           */
          relationship: rel,
          relationships: repo.relationships ?? [rel],
          discovered_via: repo.discoveredVia ?? [],
          contribution_signals: repo.contributionSignals ?? null,
        },
        recorded_at: recordedAt,
      },
      repo.fullName,
    );
    if (relationshipIsExternal) {
      externalRepoFullNames.add(repo.fullName);
    } else {
      ownedRepoIds.push(id);
    }
  }

  // ── Repos (external) synthesized from external PRs ──────────
  const externalRepoRefs = collectExternalRepoRefs(input.github);
  for (const repo of externalRepoRefs) {
    const id = repoArtifactId(repo.fullName);
    if (artifacts[id]) continue; // already recorded as owned (unlikely here)
    push(
      {
        id,
        type: "repo",
        source_url: `https://github.com/${repo.fullName}`,
        title: repo.fullName,
        metadata: {
          ...repo,
          is_external: true,
        },
        recorded_at: recordedAt,
      },
      repo.fullName,
    );
    externalRepoFullNames.add(repo.fullName);
  }

  // ── PRs (authored) ──────────────────────────────────────────
  for (const pr of input.github.authoredPRs) {
    const id = prArtifactId(pr);
    push(
      {
        id,
        type: "pr",
        source_url: `https://github.com/${pr.repoFullName}/pull/${pr.number}`,
        title: pr.title,
        metadata: {
          repo: pr.repoFullName,
          number: pr.number,
          state: pr.state,
          merged: pr.merged,
          created_at: pr.createdAt,
          merged_at: pr.mergedAt,
          closed_at: pr.closedAt,
          review_decision: pr.reviewDecision,
          additions: pr.additions,
          deletions: pr.deletions,
          changed_files: pr.changedFiles,
          is_external: pr.isExternal,
          cycle_time_days: cycleTimeDays(pr),
        },
        recorded_at: recordedAt,
      },
      pr.repoFullName,
    );
    if (pr.isExternal) externalPrIds.push(id);
  }

  // ── Reviews submitted by the user on others' PRs ───────────
  for (const rv of input.github.submittedReviews) {
    const id = reviewArtifactId(rv);
    push(
      {
        id,
        type: "review",
        source_url: `https://github.com/${rv.repoFullName}/pull/${rv.prNumber}`,
        title: `Review on ${rv.repoFullName}#${rv.prNumber}`,
        excerpt: rv.body ? rv.body.slice(0, 800) : undefined,
        metadata: {
          repo: rv.repoFullName,
          pr_number: rv.prNumber,
          state: rv.state,
          submitted_at: rv.submittedAt,
        },
        recorded_at: recordedAt,
      },
      rv.repoFullName,
    );
  }

  // ── Commits (meaningful, from per-repo inventory) ─────────
  // No cap — every meaningful commit becomes an artifact. Workers query
  // the table by filter/search, so more data = more precise claims.
  for (const [repoFullName, inv] of Object.entries(input.inventories)) {
    const meaningful = inv.commits.filter((c) => c.meaningful);
    for (const c of meaningful) {
      const id = commitArtifactId(repoFullName, c.shortSha);
      push(
        {
          id,
          type: "commit",
          source_url: `https://github.com/${repoFullName}/commit/${c.sha}`,
          title: c.subject.slice(0, 200),
          metadata: {
            repo: repoFullName,
            sha: c.sha,
            short_sha: c.shortSha,
            author: c.authorName,
            email: c.email,
            date: c.date,
            files_changed: c.filesChanged,
            insertions: c.insertions,
            deletions: c.deletions,
            category: c.category,
            meaningful: c.meaningful,
          },
          recorded_at: recordedAt,
        },
        repoFullName,
      );
    }
  }

  // ── Unify commit counts: git log is authoritative ─────────
  // When an inventory exists for a repo we just added, overwrite the
  // repo artifact's user_commit_count with the git-log value. The PR-based
  // estimate from fetchRepos is discarded — agents need ONE number per repo.
  for (const [repoFullName, inv] of Object.entries(input.inventories)) {
    const repoId = repoArtifactId(repoFullName);
    const existing = artifacts[repoId];
    if (!existing) continue;
    const meta = existing.metadata as Record<string, unknown>;
    meta.user_commit_count = inv.stats.userCommits;
    meta.commit_count_source = "git_log";
    meta.total_commits = inv.stats.totalCommits;
    meta.total_contributors = inv.stats.contributors;
  }

  // ── Per-repo inventory summary as a pseudo-artifact ────────
  // Includes TEAM SIGNAL (total contributors, other top contributors, user's
  // rank) so discover + workers can infer employment context — e.g. "user
  // is top contributor on a 27-person repo with 2 years of history" reads
  // very differently from "user is sole author."
  for (const [repoFullName, inv] of Object.entries(input.inventories)) {
    const id = `inventory:${repoFullName}`;
    const userEmail = inv.identity?.email?.toLowerCase();
    const others = inv.topContributors
      .filter((c) => !userEmail || c.email.toLowerCase() !== userEmail)
      .slice(0, 8);
    const userCommits = inv.stats.userCommits;
    const totalCommits = inv.stats.totalCommits;
    const userShare = totalCommits > 0 ? userCommits / totalCommits : 0;
    // Rank: 1 = top contributor, etc.
    const rankedByCommits = [...inv.topContributors].sort((a, b) => b.commits - a.commits);
    const userRank = userEmail
      ? rankedByCommits.findIndex((c) => c.email.toLowerCase() === userEmail) + 1
      : 0;

    // Heuristic employment-context flag: multi-person repo where the user
    // has sustained presence AND is a top contributor.
    const looksLikeTeamRepo =
      inv.stats.contributors >= 2 &&
      userCommits >= 30 &&
      inv.stats.activeDays >= 60 &&
      userShare < 0.95; // not solo

    // Daily activity aggregate — per-date {ins, del, commits} for this user.
    // Chart-ready. Filtered to user's commits only (inv.commits already is).
    const dailyAct = new Map<string, { ins: number; del: number; c: number }>();
    // Shipped-by-category counts — the signal agents should PREFER these
    // over raw commit totals. A "27% of all commits" framing undersells
    // real work; "X features shipped, Y bugs fixed" reads as product
    // contribution.
    const shipped = {
      features: 0,   // feature + meaningful
      bugs_fixed: 0, // bugfix + meaningful
      refactors: 0,
      docs: 0,
      tests: 0,
      infra: 0,
    };
    for (const c of inv.commits) {
      if (c.date) {
        const d = c.date.slice(0, 10); // YYYY-MM-DD
        const cur = dailyAct.get(d) ?? { ins: 0, del: 0, c: 0 };
        cur.ins += c.insertions;
        cur.del += c.deletions;
        cur.c += 1;
        dailyAct.set(d, cur);
      }
      if (!c.meaningful) continue;
      switch (c.category) {
        case "feature":   shipped.features += 1; break;
        case "bugfix":    shipped.bugs_fixed += 1; break;
        case "refactor":  shipped.refactors += 1; break;
        case "docs":      shipped.docs += 1; break;
        case "test":      shipped.tests += 1; break;
        case "infra":     shipped.infra += 1; break;
      }
    }
    const dailyActivity = [...dailyAct.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, ins: v.ins, del: v.del, c: v.c }));

    push(
      {
        id,
        type: "repo",
        source_url: `https://github.com/${repoFullName}`,
        title: `Inventory for ${repoFullName}`,
        metadata: {
          repo: repoFullName,
          is_inventory: true,
          user_commits: userCommits,
          total_commits: totalCommits,
          non_user_commits: inv.stats.nonUserCommits,
          user_commit_share: Math.round(userShare * 1000) / 1000,
          user_rank_in_repo: userRank,
          total_contributors: inv.stats.contributors,
          other_top_contributors: others.map((c) => ({
            name: c.name,
            email: c.email,
            commits: c.commits,
          })),
          looks_like_team_repo: looksLikeTeamRepo,
          active_days: inv.stats.activeDays,
          is_early_committer: inv.stats.isEarlyCommitter,
          languages: inv.languageLoc.slice(0, 8).map((l) => ({
            ext: l.extension,
            insertions: l.insertions,
          })),
          surviving_loc: inv.survivingStats.aggregateSurvivingEstimate,
          durable_replaced: inv.survivingStats.aggregateDurable,
          ephemeral_replaced: inv.survivingStats.aggregateEphemeral,
          raw_durability: inv.survivingStats.rawDurabilityScore,
          first_commit: inv.stats.firstCommitDate,
          last_commit: inv.stats.lastCommitDate,
          longest_streak_days: inv.temporal.streaks.longestConsecutiveDays,
          commits_by_hour: inv.temporal.commitsByHour,
          commits_by_day_of_week: inv.temporal.commitsByDayOfWeek,
          daily_activity: dailyActivity,
          // Shipped-by-category: PREFERRED framing over raw commit totals.
          // "82 features shipped" beats "27% of all commits" every time.
          features_shipped: shipped.features,
          bugs_fixed: shipped.bugs_fixed,
          refactors: shipped.refactors,
          docs_commits: shipped.docs,
          tests_commits: shipped.tests,
          infra_commits: shipped.infra,
        },
        recorded_at: recordedAt,
      },
      repoFullName,
    );
  }

  return {
    artifacts,
    indexes: {
      byType,
      byRepo,
      externalPrIds,
      ownedRepoIds,
      externalRepoFullNames: [...externalRepoFullNames],
    },
  };
}

// ──────────────────────────────────────────────────────────────
// ID helpers — kept in one place so they're consistent
// ──────────────────────────────────────────────────────────────

export function repoArtifactId(fullName: string): string {
  return `repo:${fullName}`;
}

export function prArtifactId(pr: GitHubPR): string {
  return `pr:${pr.repoFullName}#${pr.number}`;
}

export function commitArtifactId(repoFullName: string, shortSha: string): string {
  return `commit:${repoFullName}@${shortSha}`;
}

export function reviewArtifactId(rv: GitHubReview): string {
  return `review:${rv.repoFullName}#${rv.prNumber}:${rv.submittedAt}`;
}

export function webArtifactId(url: string): string {
  // Stable short id for web artifacts — hash-based
  return `web:${hash12(url)}`;
}

function hash12(str: string): string {
  // Small, deterministic, dependency-free. Not crypto — just a stable id.
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < str.length; i++) {
    h1 = Math.imul(h1 ^ str.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 ^ str.charCodeAt(i), 0x100000001b3 & 0xffffffff);
  }
  const h = ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).slice(0, 12);
  return h.padStart(12, "0");
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function cycleTimeDays(pr: GitHubPR): number | null {
  if (!pr.merged || !pr.mergedAt) return null;
  const created = Date.parse(pr.createdAt);
  const merged = Date.parse(pr.mergedAt);
  if (!Number.isFinite(created) || !Number.isFinite(merged)) return null;
  return Math.round(((merged - created) / (1000 * 60 * 60 * 24)) * 10) / 10;
}

interface ExternalRepoSummary {
  fullName: string;
  pr_count: number;
  merged_count: number;
  review_count: number;
  first_seen: string | null;
  last_seen: string | null;
}

function collectExternalRepoRefs(g: GitHubData): ExternalRepoSummary[] {
  const map = new Map<string, ExternalRepoSummary>();
  for (const pr of g.authoredPRs) {
    if (!pr.isExternal) continue;
    const cur = map.get(pr.repoFullName) ?? {
      fullName: pr.repoFullName,
      pr_count: 0,
      merged_count: 0,
      review_count: 0,
      first_seen: null,
      last_seen: null,
    };
    cur.pr_count += 1;
    if (pr.merged) cur.merged_count += 1;
    if (!cur.first_seen || pr.createdAt < cur.first_seen) cur.first_seen = pr.createdAt;
    if (!cur.last_seen || pr.createdAt > cur.last_seen) cur.last_seen = pr.createdAt;
    map.set(pr.repoFullName, cur);
  }
  for (const rv of g.submittedReviews) {
    const cur = map.get(rv.repoFullName);
    if (!cur) continue; // only count reviews on repos we already flagged external via authored PRs
    cur.review_count += 1;
  }
  return [...map.values()];
}

/**
 * Describe an artifact in a compact text form for feeding to LLM prompts.
 * Workers render selected artifacts this way to stay token-efficient.
 */
export function formatArtifactForPrompt(a: Artifact): string {
  switch (a.type) {
    case "repo": {
      const m = a.metadata as Record<string, unknown>;
      if (m.is_inventory) {
        return `[${a.id}] Inventory ${m.repo}: ${m.user_commits} commits over ${m.active_days} active days, ${m.surviving_loc} loc surviving, streak ${m.longest_streak_days}d. langs: ${JSON.stringify(m.languages ?? [])}`;
      }
      const stars = m.stars ? `, ${m.stars} stars` : "";
      const langs = Array.isArray(m.languages) ? (m.languages as string[]).join("/") : "";
      const desc = a.excerpt ? ` — "${a.excerpt.slice(0, 120)}"` : "";
      const rel = typeof m.relationship === "string" ? m.relationship : "owner";
      // Drive-by contributions are framed as [contrib to X] so agents
      // read "merged PR into facebook/react" as external impact, not
      // "own project called react".
      const relLabel =
        rel === "contributor"
          ? " [contrib]"
          : rel === "collaborator"
            ? " [collaborator]"
            : rel === "org_member"
              ? " [org]"
              : rel === "reviewer"
                ? " [reviewer]"
                : "";
      const sig = m.contribution_signals as
        | { commits?: number; prsOpened?: number; reviews?: number }
        | null
        | undefined;
      const sigLabel = sig
        ? ` (${sig.commits ?? 0}c/${sig.prsOpened ?? 0}pr/${sig.reviews ?? 0}rv)`
        : "";
      return `[${a.id}] repo ${m.full_name}${stars}, ${langs}${desc}${m.is_archived ? " [archived]" : ""}${relLabel}${sigLabel}`;
    }
    case "pr": {
      const m = a.metadata as Record<string, unknown>;
      const state = m.merged ? "merged" : m.state;
      const ext = m.is_external ? " [external]" : "";
      return `[${a.id}] PR#${m.number} (${state})${ext} "${a.title}" — +${m.additions}/-${m.deletions} over ${m.changed_files} files, ${m.cycle_time_days ?? "?"}d cycle`;
    }
    case "commit": {
      const m = a.metadata as Record<string, unknown>;
      return `[${a.id}] commit ${m.short_sha} ${m.date} [${m.category}] "${a.title}" (+${m.insertions}/-${m.deletions})`;
    }
    case "review": {
      const m = a.metadata as Record<string, unknown>;
      return `[${a.id}] review ${m.state} on ${m.repo}#${m.pr_number} at ${m.submitted_at}${a.excerpt ? ` — "${a.excerpt.slice(0, 120)}"` : ""}`;
    }
    case "release": {
      return `[${a.id}] release "${a.title}"`;
    }
    case "web": {
      return `[${a.id}] web "${a.title}" — ${a.source_url}${a.excerpt ? `\n  excerpt: ${a.excerpt.slice(0, 400)}` : ""}`;
    }
    default:
      return `[${a.id}] ${a.type} "${a.title}"`;
  }
}
