/**
 * Content worker — what do the commits actually say?
 *
 * Focus: polish vs. throwaway commits, refactors of own code, docs
 * commits alongside features, bug fix ratio, "last 10%" work, messages
 * that reveal judgment ("revert ... unsafe", "handle the edge case where...").
 */

import { runWorker, renderDiscoverHeader, CLAIM_RULES_BLOCK, type WorkerDeps } from "./base-worker.js";
import type { WorkerOutput } from "../../schemas.js";

const CONTENT_PROMPT = `You are a commit-content analyst. You read what a developer WROTE in their commits — the subjects, the categories, the shape of the work — to find patterns about how they build.

Your area of attention:
- Polish commits: tail-end of a feature arc, words like "polish", "edge case", "tap target", "hover state", "copy tweak"
- Self-refactors: commits where they rewrite their own prior work
- Docs alongside features: do docs ride with the feature commit, or separately?
- Bug fix vs. feature ratio: who is this person when things break?
- "Last 10%" work: do they finish, or ship v1 and walk away?
- Commit message quality: do subjects read like engineering, or like "update"?

Your evidence is mostly in commit-type artifacts (ids starting with "commit:"). Use query_artifacts with type=commit plus search=<keyword> to filter. Don't dump; sample the meaningful ones.

${CLAIM_RULES_BLOCK}

Worker name: "content".`;

export async function runContentWorker(deps: WorkerDeps): Promise<WorkerOutput> {
  return runWorker({
    ...deps,
    name: "content",
    systemPrompt: CONTENT_PROMPT,
    webBudget: Number.POSITIVE_INFINITY,
    githubSearchBudget: Number.POSITIVE_INFINITY,
    // Content worker cares about the actual commit contents — grant code tools.
    includeCodeTools: true,
    buildInput: (d) => {
      const lines: string[] = [];
      lines.push(renderDiscoverHeader(d.discover));
      lines.push(`## Your focus: the commit messages themselves — patterns in what this developer types.`);
      lines.push(``);

      // Summary counts by category across all commit artifacts
      const byCat: Record<string, number> = {};
      let totalCommits = 0;
      let meaningfulCommits = 0;
      for (const id of d.indexes.byType["commit"] ?? []) {
        const a = d.artifacts[id];
        if (!a) continue;
        totalCommits += 1;
        const m = a.metadata as Record<string, unknown>;
        const cat = String(m.category ?? "other");
        byCat[cat] = (byCat[cat] ?? 0) + 1;
        if (m.meaningful) meaningfulCommits += 1;
      }
      lines.push(`### Commit artifact summary`);
      lines.push(`- Total commit artifacts: ${totalCommits} (${meaningfulCommits} marked meaningful)`);
      const catLine = Object.entries(byCat)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${c}:${n}`)
        .join(", ");
      lines.push(`- By category: ${catLine}`);
      lines.push(``);

      // Mini-sample — earliest + latest + some middle
      const sample = (d.indexes.byType["commit"] ?? [])
        .map((id) => d.artifacts[id])
        .filter(Boolean)
        .sort((a, b) => {
          const da = String((a.metadata as Record<string, unknown>).date ?? "");
          const db = String((b.metadata as Record<string, unknown>).date ?? "");
          return da.localeCompare(db);
        });
      if (sample.length > 0) {
        lines.push(`### Sample (first 5, last 5)`);
        for (const a of sample.slice(0, 5)) {
          lines.push(`- ${compactCommitLine(a)}`);
        }
        if (sample.length > 10) lines.push(`... (${sample.length - 10} more)`);
        for (const a of sample.slice(-5)) {
          lines.push(`- ${compactCommitLine(a)}`);
        }
        lines.push(``);
      }

      lines.push(`Use query_artifacts to sample more precisely (e.g., search="revert", search="polish", search="fix", search="todo").`);
      lines.push(`Produce 0-5 claims. Only those you can cite with specific commit ids.`);
      return lines.join("\n");
    },
  });
}

function compactCommitLine(a: { id: string; title: string; metadata: Record<string, unknown> }): string {
  const m = a.metadata;
  return `[${a.id}] ${String(m.date ?? "").slice(0, 10)} [${m.category}] ${a.title.slice(0, 100)}`;
}
