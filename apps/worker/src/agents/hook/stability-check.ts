/**
 * Hook stability check — runs on every scan (accuracy > cost).
 *
 * Runs the hook writer a SECOND time against the same discover+worker input,
 * compares the winner's text against the real-run winner via simple word
 * Jaccard similarity. Low similarity = the prompt is picking different
 * framings on different runs = the prompt isn't stable.
 *
 * Costs one extra hook-writer + hook-critic pair per scan (~2-4 min).
 * Worth it — the hook is the highest-stakes sentence in the profile, and
 * knowing whether a second independent run would pick the same framing
 * tells us if the prompt is doing its job or just rolling dice.
 *
 * Result surfaces in card.meta.stability and in a CLI log line. Saved to
 * `14a0-hook-stability.json` for later inspection.
 */

import { runHookWriter } from "./writer.js";
import { runHookCritic } from "./critic.js";
import type {
  ScanSession,
  DiscoverOutput,
  WorkerOutput,
  Artifact,
  HookCandidate,
  HookAngleSelection,
} from "../../schemas.js";
import type { SessionUsage } from "../../session.js";

export interface StabilityInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  workerOutputs: WorkerOutput[];
  artifacts: Record<string, Artifact>;
  /** The hook winner that was picked during the real pipeline run. */
  canonicalWinner: HookCandidate;
  /**
   * The angle the canonical writer ran under. The stability probe reuses
   * the same angle so the similarity measure isolates writer variance from
   * angle variance.
   */
  angle: HookAngleSelection;
  onProgress?: (text: string) => void;
}

export interface StabilityReport {
  enabled: boolean;
  /** 0..1 word-overlap similarity. >0.6 = stable; 0.3–0.6 = mixed; <0.3 = unstable. */
  similarity: number;
  verdict: "stable" | "mixed" | "unstable" | "skipped";
  canonical: string;
  second: string | null;
  note: string;
}

/**
 * Run the stability check. Always runs — the `enabled` field on the
 * report is retained for backwards compatibility with code that still
 * checks it, but is always `true` in normal operation.
 */
export async function runHookStabilityCheck(
  input: StabilityInput,
): Promise<StabilityReport> {
  const candidates = await runHookWriter({
    session: input.session,
    usage: input.usage,
    discover: input.discover,
    workerOutputs: input.workerOutputs,
    artifacts: input.artifacts,
    angle: input.angle,
    onProgress: input.onProgress,
  });
  const critique = await runHookCritic({
    session: input.session,
    usage: input.usage,
    candidates,
    discover: input.discover,
    onProgress: input.onProgress,
  });
  const secondWinner =
    critique.winner_index !== null
      ? candidates.candidates[critique.winner_index]
      : // fall back to the highest-scoring candidate if critic rejected all
        pickBestByScoreSum(candidates.candidates, critique);

  const similarity = wordJaccard(input.canonicalWinner.text, secondWinner.text);
  const verdict: StabilityReport["verdict"] =
    similarity >= 0.6 ? "stable" : similarity >= 0.3 ? "mixed" : "unstable";

  return {
    enabled: true,
    similarity: round2(similarity),
    verdict,
    canonical: input.canonicalWinner.text,
    second: secondWinner.text,
    note:
      verdict === "stable"
        ? "hook prompt produced the same framing on two independent runs"
        : verdict === "mixed"
          ? "hook prompt produced related but noticeably different hooks — review writer rules"
          : "hook prompt produced divergent hooks on identical input — writer rules are too permissive",
  };
}

// ──────────────────────────────────────────────────────────────
// Similarity metric
// ──────────────────────────────────────────────────────────────

/**
 * Word-level Jaccard: |A ∩ B| / |A ∪ B| over lowercased alphanumeric tokens
 * of length ≥ 4 (to ignore stopwords like "the", "and", "a", etc. without
 * shipping a real stopword list).
 */
function wordJaccard(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pickBestByScoreSum(
  candidates: HookCandidate[],
  critique: { scores: Array<{ index: number; specific: number; verifiable: number; surprising: number; earned: number }> },
): HookCandidate {
  const scored = [...critique.scores].sort(
    (a, b) =>
      b.specific + b.verifiable + b.surprising + b.earned -
      (a.specific + a.verifiable + a.surprising + a.earned),
  );
  return candidates[scored[0].index];
}
