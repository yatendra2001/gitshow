/**
 * Hook Writer — generates 5 hook candidates with distinct voices.
 *
 * The candidates feed into hook/critic.ts which scores them on four axes
 * (specific, verifiable, surprising, earned) and picks a winner or
 * requests a revision round.
 */

import { runAgentWithSubmit } from "../base.js";
import { renderDiscoverSummary, renderWorkerClaims } from "../prompt-helpers.js";
import {
  HookWriterOutputSchema,
  type HookWriterOutput,
  type Artifact,
  type ScanSession,
  type DiscoverOutput,
  type WorkerOutput,
  type HookAngleSelection,
} from "../../schemas.js";
import type { SessionUsage } from "../../session.js";

export interface HookWriterInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  /** Output from the parallel workers — their claims inform the hook. */
  workerOutputs: WorkerOutput[];
  artifacts: Record<string, Artifact>;
  /**
   * Required: angle pre-selected by the angle-selector. All 5 candidates
   * must lead with this angle. This is the single biggest lever for hook
   * stability — constraining the framing BEFORE generation means five
   * independent candidate runs stay on the same storyline.
   */
  angle: HookAngleSelection;
  /** Optional critic feedback from a prior round, to revise against. */
  reviseInstruction?: string;
  onProgress?: (text: string) => void;
}

const HOOK_WRITER_PROMPT = `You write profile HOOKS — the 1-3 short declarative sentences at the top of a developer dossier that make a senior engineer say "forward this."

The ANGLE has already been selected for you — it is fixed. All 5 of your candidates MUST lead with the chosen angle. Different voice, same angle. This is how we keep the five candidates focused and stable.

The hook is the highest-stakes sentence on the page. It must:
- Be 1-3 short declarative sentences (never more). No em-dash punchlines. No "and yet" rhetorical structures. No marketing-speak.
- Pass the tired-engineer-on-Slack-at-11pm test: could they say this about themselves without it sounding like ad copy?
- Be impossible to copy onto another developer without it feeling wrong.
- Each claim inside the hook should be factually citable via the evidence_ids you provide.

## Per-angle playbook (your angle is specified below — follow the rule for it)

### CREDENTIAL_ANCHOR
Lead sentence-1 with the SINGLE strongest external validation named in the evidence. The reader should know in the first 12 words that someone external chose this developer.
  Shape A: "<Notable OSS project>'s maintainers merged his contribution after a <N>-round review and said they'd extend it themselves."
  Shape B: "Won <named competition> — placed top among <N>+ developers from <M> countries for <prize>."
  Bad (buries the lead): "Builds AI products. Also won a global hackathon."

Voice palette: direct / understated / numeric / direct-detail / numeric-context.
At least 2 of 5 candidates must name the specific source (maintainer name / program name / competition name) drawn from the worker claims.

### OPERATOR_DENSITY
Lead sentence-1 with the employer / product / team-scale triad. The reader should learn "who, what, how much" in one sentence.
  Shape A: "Founding engineer at <company> — the <product description in human terms>. #1 of <N> engineers."
  Shape B: "Lead <stack> on <company>'s <product>. <N> services across <M> runtimes, running in production for <T> months."
  Bad: "Ships a lot of code across many systems at his employer."

Voice palette: direct / understated / numeric / direct-detail / numeric-context.
At least 2 of 5 candidates must include the employer name AND a quantified team-scale stat drawn from the worker claims.

### BUILD_CADENCE
Lead sentence-1 with the rate-of-shipping fact: multiple projects, fast ramps, platform coverage.
  Shape A: "Ships end-to-end <category> products solo. <N> live right now. Median time from blank repo to <store/url> is <T weeks>."
  Shape B: "Built <something cross-language> into a <N>-star codebase <T days> after first touching it — and shipped <M> solo apps the same year."
  Bad: "Is a productive developer who ships fast."

Voice palette: direct / understated / numeric / personality (if solo identity is dominant) / direct-detail.
Numbers should emphasize VELOCITY (days, weeks, months-to-ship) over volume.

### DOMAIN_DEPTH
Lead sentence-1 with the specific domain AND the non-trivial evidence in that domain.
  Shape A: "Writes <specific subsystem> — the kind where the PR title includes the specific technique he invented."
  Shape B: "<Specific domain> engineer. Named patches to <named project's named subsystem>. Reviewed by <maintainer>."
  Bad: "Has deep expertise in machine learning."

Voice palette: direct / understated / numeric / direct-detail.
At least 2 of 5 candidates must name the SPECIFIC domain AND cite the SPECIFIC technique, PR, or named maintainer drawn from the worker claims.

## Voice palette definitions

  - direct         — plain, declarative, stacked facts. No modifiers doing heavy lifting.
  - understated    — confident without flexing. Says less, means more.
  - numeric        — opens with a precise, surprising, angle-relevant number.
  - direct-detail  — direct, plus one specific shipped system or named entity.
  - numeric-context — a scale number paired with the product/credential context.
  - personality    — reveals style through facts (BUILD_CADENCE only, when solo identity dominates).

## Hard rules

- Every candidate cites >= 1 evidence_id.
- Every candidate leads with the SELECTED ANGLE's required first-sentence shape.
- No em-dash punchlines, no "and yet", no generic adjectives, no commit-count framings as the lead.
- Mark each candidate's voice with a tag from the palette — this is metadata for the critic.

Call submit_hook_candidates exactly once with all 5.`;

export async function runHookWriter(input: HookWriterInput): Promise<HookWriterOutput> {
  const userMessage = buildHookInput(input);

  const { result } = await runAgentWithSubmit({
    model: input.session.model,
    systemPrompt: HOOK_WRITER_PROMPT,
    input: userMessage,
    submitToolName: "submit_hook_candidates",
    submitToolDescription:
      "Submit exactly 5 hook candidates in distinct voices, each with evidence_ids.",
    submitSchema: HookWriterOutputSchema,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: "hook-writer",
    onProgress: input.onProgress,
  });

  return result;
}

function buildHookInput(input: HookWriterInput): string {
  const parts: string[] = [
    `## YOUR ANGLE (fixed, do not change)`,
    `Angle: ${input.angle.angle}`,
    `Why this angle was picked: ${input.angle.reason}`,
    ``,
    `All 5 candidates must lead with this angle. See the per-angle playbook above.`,
    ``,
    renderDiscoverSummary(input.discover),
    renderWorkerClaims(input.workerOutputs),
    ``,
  ];
  if (input.reviseInstruction) {
    parts.push(
      `## Critic asked you to revise`,
      input.reviseInstruction,
      `Produce 5 NEW candidates still under the selected angle, addressing the feedback. Do not repeat prior rejected text.`,
      ``,
    );
  }
  parts.push(`Write 5 candidates. Same angle, different voices. Each with evidence_ids. Call submit_hook_candidates.`);
  return parts.join("\n");
}
