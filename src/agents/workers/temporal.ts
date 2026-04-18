/**
 * Temporal worker — commits through time.
 *
 * Focus: cadence (streaks, bursts, focus windows), pivots without abandoning,
 * ramp + sustain patterns, what they do at 2am vs. 2pm, incident response,
 * "always shipping" vs. "boom/bust".
 */

import { runWorker, renderDiscoverHeader, CLAIM_RULES_BLOCK, type WorkerDeps } from "./base-worker.js";
import type { Artifact, WorkerOutput } from "../../schemas.js";

const TEMPORAL_PROMPT = `You are a temporal analyst for a developer profile. You look at commits + PRs through time to find patterns that reveal behavior.

Your area of attention:
- Streaks: longest consecutive commit days, patterns of focus windows
- Pivots: direction changes within a project that still merged (vs. abandonment)
- Focus blocks: did they go deep on one thing for weeks, then ship?
- Timing patterns: day-of-week / hour-of-day concentration that reveals style
- Incident response: tight cluster of commits/PRs around keywords like fix, revert, hotfix
- Sustained vs. boom/bust: do they keep shipping, or disappear for months?

You have the same 4 tools as the other workers. Most of your evidence is in the pre-fetched inventory artifacts (ids starting with "inventory:"); use query_artifacts with type=repo and search="inventory" if you need a slice.

${CLAIM_RULES_BLOCK}

Worker name: "temporal".`;

export async function runTemporalWorker(deps: WorkerDeps): Promise<WorkerOutput> {
  return runWorker({
    ...deps,
    name: "temporal",
    systemPrompt: TEMPORAL_PROMPT,
    webBudget: Number.POSITIVE_INFINITY,
    githubSearchBudget: Number.POSITIVE_INFINITY,
    includeCodeTools: true,
    buildInput: (d) => {
      const lines: string[] = [];
      lines.push(renderDiscoverHeader(d.discover));
      lines.push(`## Your focus: patterns in time — how this developer works, not what they build.`);
      lines.push(``);

      // Pull out inventory summaries
      const invIds = Object.keys(d.artifacts).filter((id) => id.startsWith("inventory:"));
      lines.push(`### Inventory summaries (${invIds.length} repos)`);
      // Sort by user_commits desc
      const invs = invIds
        .map((id) => d.artifacts[id])
        .sort((a, b) => {
          const ma = (a.metadata as Record<string, number>).user_commits ?? 0;
          const mb = (b.metadata as Record<string, number>).user_commits ?? 0;
          return mb - ma;
        })
        .slice(0, 12);
      for (const a of invs) {
        const m = a.metadata as Record<string, unknown>;
        lines.push(
          `- [${a.id}] ${m.repo}: ${m.user_commits} commits · ${m.active_days}d active · streak ${m.longest_streak_days}d · first ${m.first_commit} → last ${m.last_commit}`,
        );
      }
      lines.push(``);

      // Aggregate hour-of-day / day-of-week
      const { hour, dow } = aggregateTemporal(invs);
      if (hour) {
        lines.push(`### Aggregate commit distribution`);
        lines.push(`- Hours (0-23): [${hour.join(", ")}]`);
        if (dow) lines.push(`- Days [Mon..Sun]: [${dow.join(", ")}]`);
        lines.push(``);
      }

      lines.push(`Now investigate. Produce 0-5 claims.`);
      return lines.join("\n");
    },
  });
}

function aggregateTemporal(invs: Artifact[]): {
  hour: number[] | null;
  dow: number[] | null;
} {
  const hour = new Array(24).fill(0);
  const dow = new Array(7).fill(0);
  let hasData = false;
  for (const a of invs) {
    const m = a.metadata as Record<string, unknown>;
    const h = m.commits_by_hour;
    const d = m.commits_by_day_of_week;
    if (Array.isArray(h) && h.length === 24) {
      for (let i = 0; i < 24; i++) hour[i] += Number(h[i] ?? 0);
      hasData = true;
    }
    if (Array.isArray(d) && d.length === 7) {
      for (let i = 0; i < 7; i++) dow[i] += Number(d[i] ?? 0);
      hasData = true;
    }
  }
  return hasData ? { hour, dow } : { hour: null, dow: null };
}
