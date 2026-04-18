/**
 * Disclosure agent — finds a real flaw + genuine comeback, or returns null.
 *
 * "One honest disclosure (sometimes)." It's the most differentiating part
 * of the page and the easiest to fake. Our rule: BOTH signals must fire —
 * a flaw the data proves AND evidence the dev is moving past it. Otherwise
 * cut the section entirely. Do NOT manufacture remediation.
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

export interface DisclosureInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  workerOutputs: WorkerOutput[];
  artifacts: Record<string, Artifact>;
  onProgress?: (text: string) => void;
  /** Hiring-manager revise-loop signal — reviewer's critique + prior disclosure. */
  reviseInstruction?: string;
  priorDisclosure?: WorkerOutput;
}

// 0 or 1 disclosure claim — the agent may return none.
const DISCLOSURE_OUTPUT_SCHEMA = WorkerOutputSchema.extend({
  claims: WorkerOutputSchema.shape.claims.max(1),
});

const DISCLOSURE_PROMPT = `You write the OPTIONAL honest disclosure on a developer dossier. One sentence naming a real weakness + one sentence showing evidence they're moving past it.

Structure:
  "<weakness stated plainly, backed by data>. <comeback sentence citing specific recent evidence>."

Example shape (not literal text — use this developer's real data):
  "<flaw stated with a specific number or span> at <their specific org/repo> — <recent evidence proving they've started closing the gap>."

Example (bad, manufactured remediation — DO NOT DO THIS):
  "<flaw> — but working on improving."

HARD RULE: You must cite evidence for BOTH halves:
  - >=1 evidence_id proving the weakness
  - >=1 evidence_id proving the comeback

If you can't find both, submit an EMPTY claims array. Silence beats a fake comeback.

Set beat="disclosure". Call submit_worker_output.`;

export async function runDisclosureAgent(
  input: DisclosureInput,
): Promise<WorkerOutput> {
  const userMessage = buildInput(input);

  const { result } = await runAgentWithSubmit({
    model: input.session.model,
    systemPrompt: DISCLOSURE_PROMPT,
    input: userMessage,
    submitToolName: "submit_worker_output",
    submitToolDescription:
      "Submit 0 or 1 disclosure claim. If no clean flaw+comeback pair, submit empty claims array.",
    submitSchema: DISCLOSURE_OUTPUT_SCHEMA as z.ZodType<WorkerOutput>,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: "disclosure",
    onProgress: input.onProgress,
  });

  return { ...result, worker: "disclosure" };
}

function buildInput(input: DisclosureInput): string {
  const parts: string[] = [renderDiscoverSummary(input.discover)];

  if (input.reviseInstruction && input.priorDisclosure) {
    const prior = input.priorDisclosure.claims[0]?.text;
    parts.push(
      `## Revision (a reviewer flagged your previous disclosure)`,
      prior ? `Previous disclosure: ${prior}` : `(previous disclosure was empty)`,
      ``,
      `Reviewer said:`,
      input.reviseInstruction,
      ``,
      `Produce a DIFFERENT disclosure that addresses the critique. If the right answer is to emit NO disclosure (data doesn't cleanly support one), submit empty claims.`,
      ``,
    );
  }

  parts.push(
    renderWorkerClaims(input.workerOutputs, "## Worker claims (for context)"),
    ``,
    `Find a real weakness + evidence of movement past it. If you can't find both cleanly, submit an empty claims array.`,
  );
  return parts.join("\n");
}
