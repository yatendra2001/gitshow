/**
 * Hiring-manager revise loop.
 *
 * This is the *integrated* evaluator pattern: run the hiring manager,
 * dispatch its top-three fixes to the agents that generated the affected
 * sections, re-assemble, re-evaluate. Repeat until PASS or max rounds hit.
 *
 * Fix axis → regenerator map (v1):
 *   hook               → re-run hook writer + critic with revise instruction
 *   numeric_integrity  → re-run numbers agent with prior picks + critique
 *   voice              → re-run copy-editor with critique
 *   disclosure         → re-run disclosure agent with prior + critique
 *   pattern_selection  → (out of scope v1) — logged for future; workers are
 *                        too expensive to re-run for every pass
 *   evidence           → claims with unresolvable evidence get confidence
 *                        downgraded to "low" and status "worker_failed"
 *                        (the bind-evidence report already exposes which
 *                        claims are affected)
 *
 * The loop exits as soon as the hiring manager returns verdict=PASS, or
 * after MAX_REVISE_ROUNDS rounds (currently 2). Every round saves its
 * state to `13c-revise-round-<N>.json` for resume/debug.
 */

import { nanoid } from "nanoid";

import type { AgentEventEmit } from "./agents/base.js";
import { runHiringManagerReview } from "./agents/hiring-manager.js";
import { runHookWriter } from "./agents/hook/writer.js";
import { runHookCritic } from "./agents/hook/critic.js";
import { runAngleSelector } from "./agents/hook/angle-selector.js";
import { runNumbersAgent } from "./agents/numbers.js";
import { runDisclosureAgent } from "./agents/disclosure.js";
import { runCopyEditor } from "./agents/copy-editor.js";
import { applyGuardrails } from "./guardrails.js";
import type {
  Profile,
  Claim,
  Artifact,
  ScanSession,
  DiscoverOutput,
  WorkerOutput,
  HiringManagerOutput,
  HookAngleSelection,
} from "./schemas.js";
import type { SessionUsage } from "./session.js";

/**
 * Exactly one revision cycle: eval → dispatch fixes → eval → ship.
 * Two rounds was producing worse results in practice (round 2 regressed
 * more often than it improved). One round catches the high-impact fixes
 * without overfitting.
 */
const MAX_REVISE_ROUNDS = 1;

export interface ReviseLoopInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  workerOutputs: WorkerOutput[];
  profile: Profile;
  /**
   * The angle the canonical hook was produced under. On a hook fix the
   * loop re-selects the angle (with the reviewer's critique as context)
   * so we can change framing entirely, not just reword within the same one.
   */
  hookAngle?: HookAngleSelection | null;
  /** Per-round checkpoint writer; called with `(round, payload)`. */
  saveRound?: (round: number, payload: RoundState) => Promise<void>;
  onProgress?: (text: string) => void;
  emit?: AgentEventEmit;
  messageId?: string;
}

export interface RoundState {
  round: number;
  review: HiringManagerOutput;
  fixes_applied: string[]; // axis names that were actually regenerated this round
  profile_after: Profile;
}

export interface ReviseLoopOutput {
  profile: Profile;
  finalReview: HiringManagerOutput;
  rounds: number; // how many revise rounds ran (0 if first review was PASS)
}

/**
 * Run the hiring-review → apply-fixes → re-evaluate cycle.
 *
 * Returns the BEST profile seen across all rounds, not the last. Each
 * round is scored; if a later round regresses (score drops), we keep the
 * earlier-better state. Verdict rank is PASS > REVISE > BLOCK, then
 * overall_score within the same verdict tier.
 */
export async function runHiringReviseLoop(
  input: ReviseLoopInput,
): Promise<ReviseLoopOutput> {
  const log = input.onProgress ?? (() => {});
  // Revise-loop events get their own visible channel — these are the
  // "something substantive just happened" moments a user needs to see
  // on the CLI. Plain stderr bypasses the stream-event filter.
  const loud = (text: string): void => {
    log(text); // keep in the debug stream
    process.stderr.write(text); // and always surface to terminal
  };

  // Track the best-scoring profile seen so far.
  let currentProfile = input.profile;
  let bestProfile: Profile = input.profile;
  let bestReview: HiringManagerOutput | null = null;
  let revisedRounds = 0;
  // The angle can change across revise rounds if the reviewer rejects it.
  let currentAngle: HookAngleSelection | null | undefined = input.hookAngle;

  const verdictRank = (v: HiringManagerOutput["verdict"]): number =>
    v === "PASS" ? 2 : v === "REVISE" ? 1 : 0;

  const keepBest = (
    newProfile: Profile,
    newReview: HiringManagerOutput,
  ): void => {
    if (!bestReview) {
      bestProfile = newProfile;
      bestReview = newReview;
      return;
    }
    const betterVerdict = verdictRank(newReview.verdict) > verdictRank(bestReview.verdict);
    const sameVerdictBetterScore =
      verdictRank(newReview.verdict) === verdictRank(bestReview.verdict) &&
      newReview.overall_score > bestReview.overall_score;
    if (betterVerdict || sameVerdictBetterScore) {
      bestProfile = newProfile;
      bestReview = newReview;
    }
  };

  for (let round = 0; round <= MAX_REVISE_ROUNDS; round++) {
    const review = await runHiringManagerReview({
      session: input.session,
      usage: input.usage,
      discover: input.discover,
      claims: currentProfile.claims,
      artifacts: currentProfile.artifacts,
      onProgress: input.onProgress,
      emit: input.emit,
      messageId: input.messageId,
    });

    loud(
      `[revise] round ${round} verdict: ${review.verdict} (${review.overall_score}/100, ` +
        `forwardable=${review.forwarding_test.would_a_senior_eng_forward_this})\n`,
    );

    // Track this round's profile+review if it's an improvement
    keepBest(currentProfile, review);

    // Exit conditions: PASS anytime, or we've spent our budget on revisions
    if (review.verdict === "PASS" || round === MAX_REVISE_ROUNDS) {
      if (round > 0 && review.verdict !== "PASS") {
        // TS closure-narrowing quirk: read into a typed local first.
        const bestSoFar = bestReview as HiringManagerOutput | null;
        const bestScore = bestSoFar?.overall_score ?? review.overall_score;
        const bestVerdict = bestSoFar?.verdict ?? review.verdict;
        loud(
          `[revise] shipping best-seen verdict=${bestVerdict} score=${bestScore}/100 ` +
            `after 1 revision (final-round was ${review.verdict}/${review.overall_score}).\n` +
            `[revise] This profile did NOT reach PASS — review the hiring-manager top fixes below.\n`,
        );
      }
      break;
    }

    // Dispatch fixes to the agents that produced the affected sections
    const fixesApplied: string[] = [];
    const axisFixes = groupFixesByAxis(review.top_three_fixes);

    if (axisFixes.hook) {
      loud(`[revise] re-running hook: ${axisFixes.hook.fix.slice(0, 120)}\n`);
      // Re-select angle with the reviewer's critique; the new angle feeds
      // the writer so we can actually change framing, not just reword.
      const newAngle = await runAngleSelector({
        session: input.session,
        usage: input.usage,
        discover: input.discover,
        workerOutputs: input.workerOutputs,
        reviseInstruction: axisFixes.hook.fix,
        priorAngle: currentAngle ?? undefined,
        onProgress: input.onProgress,
      });
      if (currentAngle && newAngle.angle !== currentAngle.angle) {
        loud(`[revise] angle changed ${currentAngle.angle} → ${newAngle.angle}: ${newAngle.reason}\n`);
      }
      currentAngle = newAngle;
      currentProfile = await reviseHook(
        axisFixes.hook,
        currentProfile,
        input,
        newAngle,
      );
      fixesApplied.push("hook");
    }

    if (axisFixes.numeric_integrity) {
      loud(`[revise] re-running numbers: ${axisFixes.numeric_integrity.fix.slice(0, 120)}\n`);
      currentProfile = await reviseNumbers(
        axisFixes.numeric_integrity,
        currentProfile,
        input,
      );
      fixesApplied.push("numeric_integrity");
    }

    if (axisFixes.disclosure) {
      loud(`[revise] re-running disclosure: ${axisFixes.disclosure.fix.slice(0, 120)}\n`);
      currentProfile = await reviseDisclosure(
        axisFixes.disclosure,
        currentProfile,
        input,
      );
      fixesApplied.push("disclosure");
    }

    if (axisFixes.voice) {
      loud(`[revise] re-running copy-editor: ${axisFixes.voice.fix.slice(0, 120)}\n`);
      currentProfile = await reviseVoice(
        axisFixes.voice,
        currentProfile,
        input,
      );
      fixesApplied.push("voice");
    }

    if (axisFixes.evidence) {
      loud(`[revise] evidence fix: downgrading unresolvable claims\n`);
      currentProfile = downgradeUnresolvedEvidence(axisFixes.evidence, currentProfile);
      fixesApplied.push("evidence");
    }

    if (axisFixes.pattern_selection) {
      log(
        `[revise] pattern_selection fix NOT auto-applied in v1 — re-running workers is out of scope. Fix logged: ${axisFixes.pattern_selection.fix.slice(0, 120)}\n`,
      );
    }

    // Re-apply the deterministic guardrails. Copy-editor might have already
    // run in this round (voice fix); if not, we don't want an editorial
    // second pass mid-loop — the final editorial pass happens in the
    // pipeline after the loop exits. Guardrails are idempotent so we run
    // them every round to keep placeholder-shaped numbers safe.
    const { profile: guarded } = applyGuardrails(currentProfile);
    currentProfile = guarded;

    revisedRounds = round + 1;

    if (input.saveRound) {
      await input.saveRound(revisedRounds, {
        round: revisedRounds,
        review,
        fixes_applied: fixesApplied,
        profile_after: currentProfile,
      });
    }
  }

  if (!bestReview) {
    throw new Error("revise loop exited without a review — unreachable");
  }
  return {
    profile: bestProfile,
    finalReview: bestReview,
    rounds: revisedRounds,
  };
}

// ──────────────────────────────────────────────────────────────
// Axis dispatchers
// ──────────────────────────────────────────────────────────────

type Fix = HiringManagerOutput["top_three_fixes"][number];

function groupFixesByAxis(
  fixes: Fix[],
): Partial<Record<string, Fix>> {
  // If the reviewer gave two fixes for the same axis we collapse them —
  // the agent reads the combined guidance. Later fixes win (they're ranked
  // by impact, so the first one is the strongest; concatenate though to
  // preserve both signals).
  const acc: Record<string, Fix> = {};
  for (const f of fixes) {
    if (acc[f.axis]) {
      acc[f.axis] = { ...acc[f.axis], fix: `${acc[f.axis].fix}\n\nAdditionally: ${f.fix}` };
    } else {
      acc[f.axis] = f;
    }
  }
  return acc;
}

async function reviseHook(
  fix: Fix,
  profile: Profile,
  input: ReviseLoopInput,
  angle: HookAngleSelection,
): Promise<Profile> {
  const candidates = await runHookWriter({
    session: input.session,
    usage: input.usage,
    discover: input.discover,
    workerOutputs: input.workerOutputs,
    artifacts: profile.artifacts,
    angle,
    reviseInstruction: fix.fix,
    onProgress: input.onProgress,
  });
  const critique = await runHookCritic({
    session: input.session,
    usage: input.usage,
    candidates,
    discover: input.discover,
    onProgress: input.onProgress,
  });

  const winner =
    critique.winner_index !== null
      ? candidates.candidates[critique.winner_index]
      : // critic rejected all — take highest-scoring anyway so we keep moving
        candidates.candidates[
          [...critique.scores].sort(
            (a, b) =>
              b.specific + b.verifiable + b.surprising + b.earned -
              (a.specific + a.verifiable + a.surprising + a.earned),
          )[0].index
        ];

  const newHookClaim: Claim = {
    id: `hook:${nanoid(8)}`,
    beat: "hook",
    text: winner.text,
    evidence_ids: winner.evidence_ids,
    confidence: "high",
    status: "ai_draft",
    prompt_version: "revise-loop-v1",
  };
  const withoutOldHook = profile.claims.filter((c) => c.beat !== "hook");
  return { ...profile, claims: [newHookClaim, ...withoutOldHook] };
}

async function reviseNumbers(
  fix: Fix,
  profile: Profile,
  input: ReviseLoopInput,
): Promise<Profile> {
  // Reconstruct the prior numbers as a WorkerOutput for context
  const priorNumbers = profile.claims
    .filter((c) => c.beat === "number")
    .map((c) => ({
      id: c.id,
      beat: c.beat,
      text: c.text,
      evidence_ids: c.evidence_ids,
      confidence: c.confidence,
      label: c.label,
      sublabel: c.sublabel,
      extra: c.extra,
    }));
  const priorAsWorkerOutput: WorkerOutput = {
    worker: "numbers",
    claims: priorNumbers,
    new_artifacts: [],
  };

  const out = await runNumbersAgent({
    session: input.session,
    usage: input.usage,
    discover: input.discover,
    workerOutputs: input.workerOutputs,
    artifacts: profile.artifacts,
    reviseInstruction: fix.fix,
    priorNumbers: priorAsWorkerOutput,
    onProgress: input.onProgress,
  });

  // Replace all number claims in the profile with the fresh picks
  const newNumberClaims: Claim[] = out.claims.map((c) => ({
    id: c.id && c.id.length > 0 ? c.id : `number:${nanoid(6)}`,
    beat: "number",
    text: c.text,
    evidence_ids: c.evidence_ids,
    confidence: c.confidence,
    status: "ai_draft",
    prompt_version: "revise-loop-v1",
    label: c.label,
    sublabel: c.sublabel,
    extra: c.extra,
  }));
  const nonNumbers = profile.claims.filter((c) => c.beat !== "number");
  return { ...profile, claims: [...nonNumbers, ...newNumberClaims] };
}

async function reviseDisclosure(
  fix: Fix,
  profile: Profile,
  input: ReviseLoopInput,
): Promise<Profile> {
  const priorDisclosureClaims = profile.claims
    .filter((c) => c.beat === "disclosure")
    .map((c) => ({
      id: c.id,
      beat: c.beat,
      text: c.text,
      evidence_ids: c.evidence_ids,
      confidence: c.confidence,
      label: c.label,
      sublabel: c.sublabel,
      extra: c.extra,
    }));
  const priorAsWorkerOutput: WorkerOutput = {
    worker: "disclosure",
    claims: priorDisclosureClaims,
    new_artifacts: [],
  };

  const out = await runDisclosureAgent({
    session: input.session,
    usage: input.usage,
    discover: input.discover,
    workerOutputs: input.workerOutputs,
    artifacts: profile.artifacts,
    reviseInstruction: fix.fix,
    priorDisclosure: priorAsWorkerOutput,
    onProgress: input.onProgress,
  });

  const newDisclosureClaims: Claim[] = out.claims.map((c) => ({
    id: c.id && c.id.length > 0 ? c.id : `disclosure:${nanoid(6)}`,
    beat: "disclosure",
    text: c.text,
    evidence_ids: c.evidence_ids,
    confidence: c.confidence,
    status: "ai_draft",
    prompt_version: "revise-loop-v1",
    label: c.label,
    sublabel: c.sublabel,
    extra: c.extra,
  }));
  const nonDisclosure = profile.claims.filter((c) => c.beat !== "disclosure");
  return { ...profile, claims: [...nonDisclosure, ...newDisclosureClaims] };
}

async function reviseVoice(
  fix: Fix,
  profile: Profile,
  input: ReviseLoopInput,
): Promise<Profile> {
  return runCopyEditor({
    session: input.session,
    usage: input.usage,
    profile,
    reviseInstruction: fix.fix,
    onProgress: input.onProgress,
  });
}

function downgradeUnresolvedEvidence(fix: Fix, profile: Profile): Profile {
  // If the fix names a claim_id, downgrade that specific claim.
  // Otherwise, downgrade every claim with at least one orphan evidence id.
  const artifactIds = new Set(Object.keys(profile.artifacts));
  const targetId = fix.claim_id;

  const newClaims: Claim[] = profile.claims.map((c) => {
    if (targetId && c.id !== targetId) return c;
    const orphans = c.evidence_ids.filter((id) => !artifactIds.has(id));
    if (!targetId && orphans.length === 0) return c;
    return {
      ...c,
      confidence: "low",
      extra: {
        ...(c.extra ?? {}),
        evidence_downgrade: {
          reason: "hiring-manager flagged unresolvable evidence",
          orphan_ids: orphans,
          fix: fix.fix,
        },
      },
    };
  });
  return { ...profile, claims: newClaims };
}
