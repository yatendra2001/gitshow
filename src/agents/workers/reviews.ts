/**
 * Reviews worker — external validation from teammates' words.
 *
 * Looks at PRs the developer authored on TEAM repos (multi-contributor
 * codebases) and pulls review summaries + inline code comments left by
 * OTHER people. What teammates say about someone's code is independent
 * human validation — the opposite of self-report.
 *
 * Expected claim shapes:
 *   "X maintainer reviewed Y PRs, Z approved, merged by W"
 *   "maintainer Z commented 'this is a really clean refactor' on PR #..."
 *   "substantive architectural pushback on PR #... taken and shipped"
 *
 * The worker picks a few representative PRs (recent, significant by size,
 * on different code areas) and calls fetch_pr_reviews on each.
 */

import { runWorker, renderDiscoverHeader, CLAIM_RULES_BLOCK, type WorkerDeps } from "./base-worker.js";
import type { WorkerOutput } from "../../schemas.js";

const REVIEWS_PROMPT = `You pull the external voice: what TEAMMATES have actually said about this developer's code during reviews.

Workflow:
  1) Use query_artifacts to find PRs the user authored on repos where other contributors exist (team repos — check the inventories for multi-contributor signal).
  2) Pick ~5–10 representative PRs: a mix of recent + large + those on different subsystems. Favor merged PRs on team repos. Skip solo-repo PRs.
  3) For each, call fetch_pr_reviews(repo, pr_number). The tool automatically filters out self-comments and bots.
  4) Read the actual review text. Look for:
       - Maintainers / senior engineers reviewing substantively (not just "LGTM")
       - Specific technical praise ("clean abstraction", "good catch")
       - Architectural pushback that was taken and shipped (signals humility + real engineering dialogue)
       - Who merged — maintainer rank matters (core member > drive-by)
  5) Produce 1–3 claims: substantive, specific, cite the review artifact ids.

If most PRs have no reviews or only bot/trivial approvals, that's a real signal — say so in notes and submit fewer / zero claims. Don't invent praise.

${CLAIM_RULES_BLOCK}

Worker name: "reviews".`;

export async function runReviewsWorker(deps: WorkerDeps): Promise<WorkerOutput> {
  return runWorker({
    ...deps,
    name: "reviews",
    systemPrompt: REVIEWS_PROMPT,
    webBudget: Number.POSITIVE_INFINITY,
    githubSearchBudget: Number.POSITIVE_INFINITY,
    includeCodeTools: true, // grants fetch_pr_reviews too
    buildInput: (d) => {
      const lines: string[] = [];
      lines.push(renderDiscoverHeader(d.discover));
      lines.push(`## Your focus: external validation — what TEAMMATES said about this developer's code.`);
      lines.push(``);

      // Surface team-repo PRs so the worker has a starting list
      const teamRepoNames = new Set<string>();
      for (const id of Object.keys(d.artifacts)) {
        if (!id.startsWith("inventory:")) continue;
        const a = d.artifacts[id];
        const m = a.metadata as Record<string, unknown>;
        if (m.looks_like_team_repo) {
          const repoName = String(m.repo ?? "");
          if (repoName) teamRepoNames.add(repoName);
        }
      }

      if (teamRepoNames.size === 0) {
        lines.push(`No team repos detected. Submit 0 claims with a note.`);
        return lines.join("\n");
      }

      lines.push(`### Team repos to investigate`);
      for (const name of teamRepoNames) lines.push(`  - ${name}`);
      lines.push(``);

      lines.push(`### Recent user-authored PRs on team repos (sample)`);
      const prIds = (d.indexes.byType?.["pr"] ?? []).map((id) => d.artifacts[id]).filter(Boolean);
      const teamPRs = prIds
        .filter((a) => teamRepoNames.has(String((a.metadata as Record<string, unknown>).repo ?? "")))
        .sort((a, b) => {
          // Recent first
          const da = String((a.metadata as Record<string, unknown>).created_at ?? "");
          const db = String((b.metadata as Record<string, unknown>).created_at ?? "");
          return db.localeCompare(da);
        })
        .slice(0, 25);
      for (const pr of teamPRs) {
        const m = pr.metadata as Record<string, unknown>;
        lines.push(
          `  - [${pr.id}] ${m.repo}#${m.number} ${m.state}  "${pr.title?.slice(0, 80)}"  +${m.additions}/-${m.deletions}`,
        );
      }
      lines.push(``);
      lines.push(`Use fetch_pr_reviews on the ones likely to have substantive discussion. Produce 1-3 claims citing the specific review artifact ids.`);
      return lines.join("\n");
    },
  });
}
