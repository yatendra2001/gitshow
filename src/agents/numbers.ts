/**
 * Numbers agent — pick 3 KPI numbers CUSTOM to this developer.
 *
 * Not durability/ownership/adaptability. The labels and units are chosen
 * per-developer based on what makes them distinctive (from the discover
 * paragraph) and what the worker claims prove.
 */

import { runAgentWithSubmit } from "./base.js";
import { renderDiscoverSummary, renderWorkerClaims } from "./prompt-helpers.js";
import {
  WorkerOutputSchema,
  type WorkerOutput,
  type Artifact,
  type ScanSession,
  type DiscoverOutput,
} from "../schemas.js";
import type { SessionUsage } from "../session.js";
import * as z from "zod/v4";

export interface NumbersInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  workerOutputs: WorkerOutput[];
  artifacts: Record<string, Artifact>;
  onProgress?: (text: string) => void;
  /**
   * Hiring-manager revise-loop signal. When set, the previous numbers pick
   * + the reviewer's specific critique are prepended to the input so the
   * agent can produce a DIFFERENT pick that addresses the flaw.
   */
  reviseInstruction?: string;
  priorNumbers?: WorkerOutput;
}

const NUMBERS_OUTPUT_SCHEMA = WorkerOutputSchema.extend({
  claims: WorkerOutputSchema.shape.claims.length(3),
});

const NUMBERS_PROMPT = `You pick 3 KPI numbers for the top of a developer dossier. These sit directly under the hook. They must be:

- CUSTOM to this developer. Not a universal set. A solo shipper's numbers are not a team multiplier's numbers. Read the discover paragraph. Read the worker claims.
- Real numbers with evidence. Each claim must cite >=1 evidence_id.
- Headline + sublabel. Headline is ≤40 chars ("2 weeks", "82 features", "99%"). Sublabel is the one-line explanation ("median time from blank repo to live product").
- Each claim is a pattern/number pair in the profile's six-beat spec. Use beat="number".
- Set the claim fields: text = sublabel (full explanation), label = the headline, sublabel = the same full explanation (yes both, they serve different UI slots).

## KPI preference order (strongest → weakest)

1. **Third-party recognition** — hackathon wins, curation lists (Product Hunt and similar discovery platforms, specialist consultancy / publication featured-app lists, etc.), press mentions, fellowship acceptances. These are OTHER people validating the work. ALWAYS check worker claims + artifacts for one of these before picking commit-stat numbers.
2. **Shipped output** — "82 features shipped", "214 bugs fixed", "5 services launched". Features + bugs are in inventory metadata under \`features_shipped\` / \`bugs_fixed\`. This is the SHAPE of contribution.
3. **Cross-language / speed-of-ramp** — "104 days to ship Rust in a 70k-star codebase", "3 languages in production in one year".
4. **Commit rank / share** — "#1 of 27 contributors". This is the WEAKEST framing. Use only when nothing above applies, and even then prefer "X features shipped on a Y-person team" over "X% of all commits".

DO NOT:
- Reach for scores out of 100 unless the data earns it.
- Pick generic labels ("Lines of code", "Years on GitHub"). Those are filler.
- Pick numbers that every developer would have. If two developers could swap numbers, rewrite.
- Use raw commit-count framing when features_shipped / bugs_fixed is available for the same repo — features tell a story about product, commit counts don't.

Call submit_worker_output with exactly 3 claims.`;

export async function runNumbersAgent(input: NumbersInput): Promise<WorkerOutput> {
  const userMessage = buildNumbersInput(input);

  const { result } = await runAgentWithSubmit({
    model: input.session.model,
    systemPrompt: NUMBERS_PROMPT,
    input: userMessage,
    submitToolName: "submit_worker_output",
    submitToolDescription:
      "Submit exactly 3 number claims, each with evidence_ids, a headline (label), and sublabel.",
    submitSchema: NUMBERS_OUTPUT_SCHEMA as z.ZodType<WorkerOutput>,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: "numbers",
    onProgress: input.onProgress,
  });

  return { ...result, worker: "numbers" };
}

function buildNumbersInput(input: NumbersInput): string {
  // Surface per-repo shipped-by-category totals directly in the input so
  // the agent can prefer "82 features shipped" over "27% of commits"
  // without having to go query_artifacts for it.
  const shippedLines: string[] = [];
  for (const [id, a] of Object.entries(input.artifacts)) {
    if (!id.startsWith("inventory:")) continue;
    const m = a.metadata as Record<string, unknown>;
    const feat = Number(m.features_shipped ?? 0);
    const bugs = Number(m.bugs_fixed ?? 0);
    const refs = Number(m.refactors ?? 0);
    if (feat + bugs + refs < 5) continue; // skip trivial repos
    shippedLines.push(
      `- [${id}] ${m.repo}: ${feat} features · ${bugs} bugs fixed · ${refs} refactors · ${m.user_commits} commits total`,
    );
  }

  const parts: string[] = [renderDiscoverSummary(input.discover)];

  if (input.reviseInstruction && input.priorNumbers) {
    parts.push(
      `## Revision (a reviewer flagged your previous 3 picks)`,
      `Previous picks:`,
      ...input.priorNumbers.claims.map(
        (c) => `  - [${c.label ?? "?"}] ${c.sublabel ?? c.text}`,
      ),
      ``,
      `Reviewer said:`,
      input.reviseInstruction,
      ``,
      `Produce 3 NEW numbers addressing the reviewer's critique. Do not repeat any of the previous labels verbatim.`,
      ``,
    );
  }

  parts.push(
    renderWorkerClaims(input.workerOutputs, "## Worker claims (available evidence)"),
    ``,
    `## Shipped-by-category per repo (PREFERRED framing over raw commit counts)`,
    ...(shippedLines.length > 0 ? shippedLines : ["(no inventory data surfaced)"]),
    ``,
    `Pick 3 KPI numbers for THIS developer. Custom labels. Real evidence. Call submit_worker_output.`,
  );
  return parts.join("\n");
}
