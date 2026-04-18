/**
 * Assemble — merge all worker / hook / numbers / disclosure / shipped
 * outputs into the final Profile.
 *
 * This step is deterministic code (no LLM). It:
 *   1) Gathers every Claim emitted by every agent
 *   2) Tags each with beat + prompt_version + status = "ai_draft"
 *   3) Stamps stable IDs
 *   4) Merges the base artifact table with any artifacts the tools
 *      discovered (from artifactSink in worker runs)
 *   5) Returns the Profile shape ready for the critic pass.
 */

import { nanoid } from "nanoid";
import {
  type Profile,
  type Claim,
  type Artifact,
  type ScanSession,
  type DiscoverOutput,
  type WorkerOutput,
  type HookCandidate,
  type PipelineMeta,
} from "./schemas.js";

export interface AssembleInput {
  session: ScanSession;
  discover: DiscoverOutput;
  /** All parallel-worker outputs (cross-repo, temporal, content, signal). */
  workerOutputs: WorkerOutput[];
  /** The picked hook (winner candidate from the critic loop). */
  hook: HookCandidate | null;
  /** Numbers agent output (3 claims). */
  numbers: WorkerOutput;
  /** Disclosure agent output (0 or 1 claim). */
  disclosure: WorkerOutput;
  /** Shipped agent output (up to 7 claims). */
  shipped: WorkerOutput;
  /** The base artifact table from normalize() + sink artifacts merged in. */
  artifacts: Record<string, Artifact>;
  /** Pipeline meta (filled in by orchestrator). */
  meta: PipelineMeta;
  /** Pipeline code version tag. */
  pipelineVersion: string;
}

const PROMPT_VERSION = "v2-2026-04";

export function assembleProfile(input: AssembleInput): Profile {
  const claims: Claim[] = [];

  // Hook — one claim at the top
  if (input.hook) {
    claims.push({
      id: `hook:${nanoid(8)}`,
      beat: "hook",
      text: input.hook.text,
      evidence_ids: input.hook.evidence_ids,
      confidence: "high",
      status: "ai_draft",
      prompt_version: PROMPT_VERSION,
    });
  }

  // Numbers — 3 claims with beat=number
  for (const c of input.numbers.claims) {
    claims.push(stampClaim(c, "number", PROMPT_VERSION));
  }

  // Worker patterns — all with beat=pattern
  for (const w of input.workerOutputs) {
    for (const c of w.claims) {
      claims.push(stampClaim(c, "pattern", PROMPT_VERSION, `pattern:${w.worker}:${nanoid(6)}`));
    }
  }

  // Disclosure — 0 or 1 claim
  for (const c of input.disclosure.claims) {
    claims.push(stampClaim(c, "disclosure", PROMPT_VERSION));
  }

  // Shipped — up to 7 claims
  for (const c of input.shipped.claims) {
    claims.push(stampClaim(c, "shipped-line", PROMPT_VERSION));
  }

  return {
    handle: input.session.handle,
    generated_at: new Date().toISOString(),
    pipeline_version: input.pipelineVersion,
    distinctive_paragraph: input.discover.distinctive_paragraph,
    claims,
    artifacts: input.artifacts,
    revision_history: [],
    meta: input.meta,
  };
}

function stampClaim(
  raw: Omit<Claim, "status" | "prompt_version">,
  beat: Claim["beat"],
  promptVersion: string,
  fallbackId?: string,
): Claim {
  return {
    id: raw.id && raw.id.length > 0 ? raw.id : fallbackId ?? `${beat}:${nanoid(8)}`,
    beat,
    text: raw.text,
    evidence_ids: raw.evidence_ids,
    confidence: raw.confidence,
    status: "ai_draft",
    prompt_version: promptVersion,
    label: raw.label,
    sublabel: raw.sublabel,
    extra: raw.extra,
  };
}
