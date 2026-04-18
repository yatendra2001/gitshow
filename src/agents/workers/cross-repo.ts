/**
 * Cross-repo worker — looks at contributions across orgs.
 *
 * Focus: external PRs, org breadth, ramp-up speed in unfamiliar codebases,
 * hackathon/OSS/adoption patterns. Heavy user of search_github.
 */

import { runWorker, renderDiscoverHeader, CLAIM_RULES_BLOCK, type WorkerDeps } from "./base-worker.js";
import type { WorkerOutput } from "../../schemas.js";

const CROSS_REPO_PROMPT = `You are a cross-repo investigator. You look at what a developer ships BEYOND their own repos — PRs to strangers' codebases, contributions across orgs, ramp-up speed into unfamiliar projects.

Your area of attention:
- Merged PRs to repos the developer does NOT own
- Diversity of orgs / projects touched
- Ramp speed (time from first commit/PR to a merged contribution in a new codebase)
- Whether external contributions are one-offs or sustained over time
- Reviews submitted on others' PRs (trust signal — maintainers asked them)

You have four tools:
  - query_artifacts — filter the pre-fetched artifact table
  - search_github — find PRs / issues / commits across all of GitHub by author
  - browse_web — fetch specific URLs (release notes, project pages, org sites)
  - search_web — find mentions of the developer beyond their profile

Be aggressive: if you see a hint of ANY notable OSS project or unknown org in the external PR list, use search_github and browse_web to find the full picture. Don't stop at the pre-fetched slice.

${CLAIM_RULES_BLOCK}

When done, call submit_worker_output exactly once. Worker name: "cross-repo".`;

export async function runCrossRepoWorker(deps: WorkerDeps): Promise<WorkerOutput> {
  return runWorker({
    ...deps,
    name: "cross-repo",
    systemPrompt: CROSS_REPO_PROMPT,
    // No caps — dig as deep as needed.
    webBudget: Number.POSITIVE_INFINITY,
    githubSearchBudget: Number.POSITIVE_INFINITY,
    includeCodeTools: true,
    buildInput: (d) => {
      const lines: string[] = [];
      lines.push(renderDiscoverHeader(d.discover));
      lines.push(`## Your focus: contributions BEYOND owned repos.`);
      lines.push(``);

      // Enumerate external contribs from pre-fetched artifact table
      const externalRepoNames = d.indexes.externalRepoFullNames;
      lines.push(`### External repos from pre-fetch (${externalRepoNames.length})`);
      for (const name of externalRepoNames.slice(0, 20)) {
        const prIds = (d.indexes.byRepo[name] ?? []).filter((id) => id.startsWith("pr:"));
        const prs = prIds.map((id) => d.artifacts[id]).filter(Boolean);
        const merged = prs.filter((p) => (p.metadata as Record<string, unknown>).merged).length;
        lines.push(`- ${name}: ${merged}/${prs.length} merged — sample ids: ${prIds.slice(0, 3).join(", ")}`);
      }
      if (externalRepoNames.length === 0) {
        lines.push(`(none detected in pre-fetch — try search_github with "author:@HANDLE is:pr is:merged" to discover)`);
      }
      lines.push(``);

      // Hint: reviews can also signal external engagement
      const reviewCount = (d.indexes.byType["review"] ?? []).length;
      lines.push(`### Reviews submitted: ${reviewCount} (check if reviews on others' repos are substantial)`);
      lines.push(``);

      lines.push(`Now investigate. Produce 0-5 claims. Fewer good claims beat more weak ones.`);
      return lines.join("\n");
    },
  });
}
