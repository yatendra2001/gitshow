/**
 * Hook angle selector — STEP 1 of the two-step hook pipeline.
 *
 * Picks exactly ONE of four angles the writer must lead with:
 *   - CREDENTIAL_ANCHOR: external validation exists (maintainer approval,
 *     named company, named product, competition wins)
 *   - OPERATOR_DENSITY: volume + breadth of active systems ownership
 *   - BUILD_CADENCE: rate of standalone shipping (solo projects, fast ramps)
 *   - DOMAIN_DEPTH: unusually deep knowledge in one area
 *
 * Narrows the writer's solution space so 5 candidates stay focused on the
 * same framing. Directly addresses the instability problem we saw when the
 * writer picked randomly across all possible angles each invocation.
 */

import { runAgentWithSubmit, type AgentEventEmit } from "../base.js";
import { toolLabel } from "@gitshow/shared/phase-copy";
import { renderDiscoverSummary, renderWorkerClaims } from "../prompt-helpers.js";
import {
  HookAngleSelectionSchema,
  type HookAngleSelection,
  type DiscoverOutput,
  type WorkerOutput,
  type ScanSession,
} from "../../schemas.js";
import type { SessionUsage } from "../../session.js";

export interface AngleSelectorInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  workerOutputs: WorkerOutput[];
  onProgress?: (text: string) => void;
  /**
   * If provided (from the revise loop), the selector considers the
   * reviewer's critique and may pick a DIFFERENT angle than last time.
   * The prior angle is also passed so the selector knows what to compare.
   */
  reviseInstruction?: string;
  priorAngle?: HookAngleSelection;
  emit?: AgentEventEmit;
  messageId?: string;
}

const ANGLE_SELECTOR_PROMPT = `You are a developer-profile strategist. Your single job: given the evidence the workers have gathered about this developer, pick the ONE framing angle that dominates.

## The four angles

CREDENTIAL_ANCHOR — external validation that OTHER people chose this developer.
  Strong evidence: named maintainer approval on a notable OSS project, named employer + named product, hackathon/competition win with specific scale, 1-of-N curation on a known list, fellowship/program acceptance with publishable acceptance rate.
  Pick this when: one or more of the above is both VERIFIED in worker claims AND not transferable to another developer.

OPERATOR_DENSITY — volume + breadth of active systems ownership.
  Strong evidence: #1 or top-N committer on a multi-contributor team repo over 12+ months, 5+ distinct services/runtimes actively owned, cross-stack depth (TS + Go + K8s, etc.) with real commits in each, sustained cadence (100+ PRs/quarter).
  Pick this when: the developer is visibly carrying a real professional codebase at scale and that scale is a stronger lead than any single credential.

BUILD_CADENCE — rate of standalone shipping.
  Strong evidence: multiple solo projects that actually shipped (App Store, Play Store, live URL, >=50 stars), fast ramp-ups (blank repo to live product in days/weeks, repeatedly), platform diversity (iOS + Android + desktop + web) from one person.
  Pick this when: the developer's signal is primarily "I can take an idea from zero to shipped faster than you'd expect." Best for solo/indie profiles without a dominant employer story.

DOMAIN_DEPTH — unusually deep expertise in one area.
  Strong evidence: named domain (ML infra, WebGL rendering, compiler internals, etc.) with multiple commits/PRs showing non-trivial depth, repeated appearances of the domain across projects, specific techniques named in commit messages, reviews from domain maintainers citing the depth.
  Pick this when: the evidence clusters around a single technical area so tightly that leading with anything else would understate the person.

## Selection rules

- Pick EXACTLY ONE. The angle is an input to downstream hook generation, so ambiguity compounds.
- CREDENTIAL_ANCHOR beats OPERATOR_DENSITY when both are present AND the credential is high-signal (70k-star OSS merge, named public win, recognized-program acceptance). Otherwise OPERATOR_DENSITY wins.
- BUILD_CADENCE wins over OPERATOR_DENSITY when the developer is solo-dominant (no team repo signal).
- DOMAIN_DEPTH is the hardest to earn — only pick it when the data shows repeated, specific, deep domain engagement (not just "used LLMs in three projects").
- If you're unsure between two angles, pick the one supported by MORE independent artifacts (different repos, different maintainers, different external sources).

## Output

Call submit_angle exactly once with:
  - angle: one of the four enum values
  - reason: ONE sentence explaining why this angle dominates for THIS developer, citing the specific evidence (maintainer names / product names / scale numbers). No hedging. No "could also be X."

${/* The prompt's revise path is appended by the agent wrapper when present */ ""}`;

export async function runAngleSelector(
  input: AngleSelectorInput,
): Promise<HookAngleSelection> {
  const userMessage = buildInput(input);

  const { result } = await runAgentWithSubmit<HookAngleSelection>({
    model: input.session.model,
    systemPrompt: ANGLE_SELECTOR_PROMPT,
    input: userMessage,
    submitToolName: "submit_angle",
    submitToolDescription:
      "Submit exactly ONE angle choice with a one-sentence reason citing specific evidence.",
    submitSchema: HookAngleSelectionSchema,
    reasoning: { effort: "medium" },
    session: input.session,
    usage: input.usage,
    label: "angle-selector",
    onProgress: input.onProgress,
    emit: input.emit,
    messageId: input.messageId,
    toolLabels: (n, i) => toolLabel(n, i),
  });

  return result;
}

function buildInput(input: AngleSelectorInput): string {
  const parts: string[] = [renderDiscoverSummary(input.discover)];

  // Intake context (employer, positioning intent) often settles which
  // angle is dominant — "founding engineer at X" almost always points
  // at OPERATOR_DENSITY or CREDENTIAL_ANCHOR, but without the note the
  // selector only sees public GitHub and may pick a weaker angle.
  if (input.session.context_notes) {
    parts.push(
      ``,
      `## Context the user gave at intake`,
      input.session.context_notes,
      ``,
    );
  }

  if (input.reviseInstruction && input.priorAngle) {
    parts.push(
      `## Revision (the hook picked under a prior angle was flagged)`,
      `Prior angle: ${input.priorAngle.angle}`,
      `Prior reason: ${input.priorAngle.reason}`,
      ``,
      `Reviewer said:`,
      input.reviseInstruction,
      ``,
      `Consider whether a DIFFERENT angle would address the critique better. Re-pick deliberately.`,
      ``,
    );
  }

  parts.push(
    renderWorkerClaims(
      input.workerOutputs,
      "## Worker claims (the evidence you evaluate)",
    ),
    ``,
    `Pick the dominant angle for this developer. Call submit_angle.`,
  );
  return parts.join("\n");
}
