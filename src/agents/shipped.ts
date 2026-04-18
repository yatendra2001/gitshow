/**
 * Shipped agent — the receipts list.
 *
 * For each shipped project: name, one-line description in human terms,
 * stack tags, and one killer stat that varies per project type.
 *
 * Cap at 7 projects. If more exist, cut the weakest.
 */

import { runAgentWithSubmit } from "./base.js";
import { renderDiscoverSummary } from "./prompt-helpers.js";
import {
  WorkerOutputSchema,
  type WorkerOutput,
  type Artifact,
  type ScanSession,
  type DiscoverOutput,
} from "../schemas.js";
import type { SessionUsage } from "../session.js";
import * as z from "zod/v4";

export interface ShippedInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  workerOutputs: WorkerOutput[];
  artifacts: Record<string, Artifact>;
  onProgress?: (text: string) => void;
}

const SHIPPED_OUTPUT_SCHEMA = WorkerOutputSchema.extend({
  claims: WorkerOutputSchema.shape.claims.max(7),
});

const SHIPPED_PROMPT = `You build the "shipped" list on a developer dossier — a receipts section, not a case-study section.

For each project, produce one claim with:
  - text: "ProjectName — one line what-it-does-in-the-world, in human terms, NOT technical ones. e.g. 'Flutter AI chat app, iOS/Android/Windows — 200+ GitHub stars'"
  - label: the killer-stat headline (see hierarchy below)
  - sublabel: short context ("Solo · 13 months · <month-year> · <stack tags>")
  - extra.stack: array of 3-6 tech tags
  - extra.repos: array of repo ids included in this project
  - evidence_ids: the repo + inventory + commits that prove it

## Killer-stat hierarchy (pick the strongest available per project)

  1. Third-party recognition. "<hackathon> winner", "1 of N on <curated list>", "<press mention>".
  2. Adoption. "200+ stars", "14k weekly npm downloads", "App Store rank", "N paying users".
  3. Shipped output. "82 features shipped", "launched 3 services", "5 releases in 4 weeks".
  4. Speed / range. "built in 48 hours", "3 languages in production", "104 days cold → prod".
  5. Commit rank / share. WEAKEST — only when nothing else fits. If using, prefer "#1 of N engineers" framing with a team-size denominator rather than raw "% of commits".

Rules:
- Max 7 projects. If more qualify, cut the weakest.
- ONLY include shipped projects — not abandoned work, not tinkering. If a project has <=2 commits or was never deployed/used, skip it.
- NEVER fake numbers. If you can't confirm a stat, pick a different stat.
- Cross-repo projects: group multiple repos into one project if they're the same system (e.g., "NextJS web + React Native companion" as one project).
- Forks / archived: skip unless there's real contribution evidence.
- Inventory metadata exposes \`features_shipped\` / \`bugs_fixed\` per repo — use those for category #3 instead of raw commit counts.

Call submit_worker_output with up to 7 claims, beat="shipped-line".`;

export async function runShippedAgent(
  input: ShippedInput,
): Promise<WorkerOutput> {
  const userMessage = buildInput(input);

  const { result } = await runAgentWithSubmit({
    model: input.session.model,
    systemPrompt: SHIPPED_PROMPT,
    input: userMessage,
    submitToolName: "submit_worker_output",
    submitToolDescription: "Submit up to 7 shipped-project claims, each with evidence.",
    submitSchema: SHIPPED_OUTPUT_SCHEMA as z.ZodType<WorkerOutput>,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: "shipped",
    onProgress: input.onProgress,
  });

  return { ...result, worker: "shipped" };
}

function buildInput(input: ShippedInput): string {
  const lines: string[] = [renderDiscoverSummary(input.discover)];

  // List repos with summary so the agent can group them
  const repoIds = Object.keys(input.artifacts).filter(
    (id) => id.startsWith("repo:") && !input.artifacts[id].id.includes("inventory"),
  );
  const repos = repoIds
    .map((id) => input.artifacts[id])
    .filter((a) => !(a.metadata as Record<string, unknown>).is_external)
    .sort((a, b) => {
      const sa = Number((a.metadata as Record<string, unknown>).stars ?? 0);
      const sb = Number((b.metadata as Record<string, unknown>).stars ?? 0);
      return sb - sa;
    });

  lines.push(`## Owned repos`);
  for (const a of repos) {
    const m = a.metadata as Record<string, unknown>;
    if (m.is_archived) continue;
    const langs = Array.isArray(m.languages) ? (m.languages as string[]).slice(0, 4).join("/") : "?";
    const commits = m.user_commit_count ?? 0;
    const stars = m.stars ?? 0;
    lines.push(`- [${a.id}] ${m.full_name} · ${commits} commits · ★${stars} · ${langs}${a.excerpt ? ` — ${a.excerpt.slice(0, 100)}` : ""}`);
  }
  lines.push(``);

  // Inventory signals per repo
  const invIds = Object.keys(input.artifacts).filter((id) => id.startsWith("inventory:"));
  if (invIds.length > 0) {
    lines.push(`## Inventory summaries (per repo)`);
    for (const id of invIds) {
      const a = input.artifacts[id];
      const m = a.metadata as Record<string, unknown>;
      lines.push(`- [${id}] ${m.repo} · ${m.user_commits} commits · ${m.active_days}d active · ${m.surviving_loc}loc surviving`);
    }
    lines.push(``);
  }

  lines.push(`## Worker claims (for killer-stat inspiration)`);
  for (const w of input.workerOutputs) {
    for (const c of w.claims) {
      lines.push(`- [${w.worker}] ${c.text} — [${c.evidence_ids.join(", ")}]`);
    }
  }
  lines.push(``);

  lines.push(`Build the shipped list. Group related repos. Up to 7. Call submit_worker_output.`);
  return lines.join("\n");
}
