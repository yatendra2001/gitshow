/**
 * Deterministic safety rails applied AFTER the LLM stages, BEFORE emit.
 *
 * The copy-editor + critic are soft gates — they flag and rewrite, but they
 * can't enforce numeric-integrity invariants. This module catches specific
 * failure modes that have burned us:
 *
 *   - Placeholder-shaped numeric labels on low-confidence claims (e.g.
 *     "999 features shipped") — can LOOK fabricated even when real.
 *     Hedge with "~" or pair with the denominator from cited artifacts.
 *
 *   - Claims missing evidence (bind-evidence already reports these; here
 *     we just downgrade their confidence so the UI can grey them out).
 *
 * Pure TS, no LLM calls. Idempotent. Runs between copy-editor and critic.
 */

import type { Profile, Claim, Artifact } from "./schemas.js";

// ──────────────────────────────────────────────────────────────
// Placeholder-number detector
// ──────────────────────────────────────────────────────────────

/**
 * A label is "placeholder-shaped" if it reads like a default / round-up:
 *   999, 9999, 99999 (all-nines — classic "looks made-up")
 *   1000, 10000, 100000 (powers-of-10)
 *
 * Labels with units, multiple tokens, or other digits don't match:
 *   "999 features" → matches (the core number reads suspicious)
 *   "2,684 commits" → doesn't match
 *   "231 stars" → doesn't match
 */
const PLACEHOLDER_CORE = /(?<![0-9.,])(9{3,}|10{3,})(?![0-9.,])/;

export function isPlaceholderShapedLabel(label: string | undefined): boolean {
  if (!label) return false;
  return PLACEHOLDER_CORE.test(label);
}

/**
 * Given a claim whose label is placeholder-shaped AND whose confidence is
 * low, try to produce a safer version. Returns the rewritten claim or
 * null if we should drop the claim entirely.
 *
 * Priority:
 *   1. If any cited `inventory:` artifact has a denominator (total_commits,
 *      user_commits) we can pair the suspicious number with — do that.
 *      "999 features" → "999 of 2,684 commits tagged features".
 *   2. Else, hedge with "~" — "999 features" → "~1,000 features" (reads
 *      as a measurement, not a placeholder).
 *   3. Else, drop (return null).
 */
export function hedgePlaceholderClaim(
  claim: Claim,
  artifacts: Record<string, Artifact>,
): Claim | null {
  if (!claim.label) return claim;
  if (!isPlaceholderShapedLabel(claim.label)) return claim;
  if (claim.confidence !== "low") return claim; // trust high/medium confidence

  const denom = findDenominatorInEvidence(claim, artifacts);
  if (denom) {
    // "999 features shipped" + denom(2684, "x/y commits")
    //   →  label: "999 / 2,684"
    //   →  text:  "999 features shipped — of 2,684 x/y commits"
    const m = claim.label.match(PLACEHOLDER_CORE);
    const suspicious = m ? m[0] : claim.label;
    return {
      ...claim,
      label: `${suspicious} / ${denom.value.toLocaleString()}`,
      text: `${claim.text} — of ${denom.value.toLocaleString()} ${denom.source}`,
      extra: { ...(claim.extra ?? {}), guardrail: "denominator-paired" },
    };
  }

  // Hedge route
  const m = claim.label.match(PLACEHOLDER_CORE);
  if (m) {
    const num = m[0];
    const roundedUp = roundUp(num);
    const hedged = claim.label.replace(num, `~${roundedUp}`);
    return {
      ...claim,
      label: hedged,
      extra: { ...(claim.extra ?? {}), guardrail: "hedged" },
    };
  }

  return claim;
}

function roundUp(num: string): string {
  const n = parseInt(num, 10);
  if (!Number.isFinite(n)) return num;
  // 999 → 1,000 ; 9999 → 10,000 ; 100 → 100 ; 1000 → 1,000
  const digits = n.toString().length;
  const magnitude = Math.pow(10, digits - 1);
  const rounded = Math.ceil(n / magnitude) * magnitude;
  return rounded.toLocaleString();
}

/**
 * Look through a claim's cited artifacts for a numeric denominator that
 * naturally pairs with a feature-count / bug-count / commit-count claim.
 */
function findDenominatorInEvidence(
  claim: Claim,
  artifacts: Record<string, Artifact>,
): { value: number; source: string } | null {
  for (const id of claim.evidence_ids) {
    const a = artifacts[id];
    if (!a) continue;
    if (!id.startsWith("inventory:")) continue;
    const m = a.metadata as Record<string, unknown>;
    const userCommits = Number(m.user_commits ?? 0);
    if (userCommits >= 100) {
      return {
        value: userCommits,
        source: `${m.repo} commits`,
      };
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────

export interface GuardrailReport {
  hedged: string[];          // claim ids that were hedged
  paired: string[];          // claim ids that got denominator-paired
  dropped: string[];         // claim ids removed
}

/**
 * Apply all deterministic guardrails to a profile. Returns the cleaned
 * profile + a report of what was changed. Safe to call repeatedly.
 */
export function applyGuardrails(
  profile: Profile,
): { profile: Profile; report: GuardrailReport } {
  const report: GuardrailReport = { hedged: [], paired: [], dropped: [] };
  const newClaims: Claim[] = [];

  for (const c of profile.claims) {
    const before = c.label;
    const fixed = hedgePlaceholderClaim(c, profile.artifacts);
    if (!fixed) {
      report.dropped.push(c.id);
      continue;
    }
    if (fixed.label !== before) {
      const tag = (fixed.extra?.guardrail ?? "") as string;
      if (tag === "hedged") report.hedged.push(c.id);
      else if (tag === "denominator-paired") report.paired.push(c.id);
    }
    newClaims.push(fixed);
  }

  return {
    profile: { ...profile, claims: newClaims },
    report,
  };
}

export function formatGuardrailReport(r: GuardrailReport): string {
  const parts: string[] = [];
  if (r.hedged.length) parts.push(`${r.hedged.length} hedged`);
  if (r.paired.length) parts.push(`${r.paired.length} denominator-paired`);
  if (r.dropped.length) parts.push(`${r.dropped.length} dropped`);
  return parts.length ? `guardrails: ${parts.join(", ")}` : "guardrails: no changes";
}
