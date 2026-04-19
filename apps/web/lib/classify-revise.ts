/**
 * Classify a free-form user revise request into which beat(s) to re-run.
 *
 * No LLM call — a keyword + scope heuristic that covers the common
 * shapes of feedback without the latency. Returns an ordered list of
 * `{claimId, beat, guidance}` dispatches. The same guidance string is
 * passed to every dispatched beat — the per-agent system prompt knows
 * which part to care about based on beat.
 *
 * Rules of thumb (in order of precedence):
 *   1. Explicit @mention tokens win. "@hook tighten" → hook only.
 *   2. Scope words ("everything", "entire profile", "whole thing",
 *      "all of it") → revise hook + disclosure (the two free-prose
 *      beats we can currently re-run end-to-end).
 *   3. Per-beat keywords fire their own dispatch. Multiple can match.
 *   4. If nothing fires and the profile has a hook, default to hook —
 *      it's the highest-leverage beat.
 *
 * Currently supported beats on the worker side: hook, number,
 * disclosure. Pattern + shipped + radar revises are a v1.1 follow-up
 * (new pattern-reviser agent on the worker). For now, pattern-ish
 * feedback falls through to hook since hook writing also considers
 * pattern claims and a good hook rewrite often cascades.
 */

import type { ProfileCard } from "@gitshow/shared/schemas";

export type SupportedBeat = "hook" | "number" | "disclosure";

export interface ClassifiedDispatch {
  claimId: string;
  beat: SupportedBeat;
  /** What the user typed — always passed through unchanged. */
  guidance: string;
  /** Which phrase / heuristic picked this beat, for debug / UX narration. */
  reason: string;
}

/** Tokens we treat as @mentions of a beat. */
const MENTION_RE =
  /@(hook|hero|opening|numbers?|kpis?|stats?|disclosure|flaw|weakness|everything|all|entire)/gi;

/** Per-beat keyword vocabularies. Lowercased, matched against the
 * lowercased user text. */
const BEAT_KEYWORDS: Record<SupportedBeat, RegExp> = {
  hook: /\b(hook|hero|opening|first line|one.?liner|tagline|intro|headline)\b/i,
  number: /\b(numbers?|kpis?|stats?|metrics?|figures?|competitive selections|shipping numbers|counts?)\b/i,
  disclosure: /\b(disclosure|flaw|weakness|honest|trade[- ]?off|limitation|gap|next chapter|ship.?first)\b/i,
};

/** Scope-expanding phrases: "fix everything", "the whole profile", etc.
 * When one of these fires + a quality word (concise, shorter, bold,
 * formatting, too much text), treat as a blanket revise across all
 * free-prose beats. */
const SCOPE_ALL_RE =
  /\b(everything|entire profile|whole profile|whole thing|all (the|of the) (text|prose|profile)|every part|overall)\b/i;

const QUALITY_RE =
  /\b(too (long|much text)|concise|shorter|trim|tight(er|en)?|bulky?|bold|formatting|rewrite|redo|better|clean(er)?|crisp(er)?|punchy|boring|bad|weak|verbose)\b/i;

export function classifyRevise(
  guidance: string,
  card: ProfileCard,
): ClassifiedDispatch[] {
  const out: ClassifiedDispatch[] = [];
  const seen = new Set<SupportedBeat>();

  // 1) Explicit @mentions always win.
  const mentions = [...guidance.matchAll(MENTION_RE)].map((m) =>
    m[1]!.toLowerCase(),
  );
  for (const mention of mentions) {
    const beat = mentionToBeat(mention);
    if (!beat) continue;
    const dispatches = expand(beat, card, guidance, `@${mention}`);
    for (const d of dispatches) {
      if (seen.has(d.beat)) continue;
      seen.add(d.beat);
      out.push(d);
    }
  }
  if (out.length > 0) return out;

  // 2) Scope-expanding phrase + quality word → blanket revise.
  const isScopeAll = SCOPE_ALL_RE.test(guidance);
  const isQuality = QUALITY_RE.test(guidance);
  if (isScopeAll && isQuality) {
    for (const beat of ["hook", "disclosure"] as const) {
      const d = makeDispatch(beat, card, guidance, "across the whole profile");
      if (d && !seen.has(d.beat)) {
        seen.add(d.beat);
        out.push(d);
      }
    }
    if (out.length > 0) return out;
  }

  // 3) Per-beat keyword hits.
  for (const [beat, re] of Object.entries(BEAT_KEYWORDS) as Array<
    [SupportedBeat, RegExp]
  >) {
    if (re.test(guidance)) {
      const d = makeDispatch(beat, card, guidance, `mentions ${beat}`);
      if (d && !seen.has(d.beat)) {
        seen.add(d.beat);
        out.push(d);
      }
    }
  }
  if (out.length > 0) return out;

  // 4) Fallback — hook. It's the highest-leverage free-prose beat
  //    and often cascades to pattern quality too.
  if (card.hook) {
    out.push({
      claimId: card.hook.id,
      beat: "hook",
      guidance,
      reason: "no specific target — starting with the hook",
    });
  }
  return out;
}

function mentionToBeat(mention: string): SupportedBeat | null {
  const m = mention.toLowerCase();
  if (m === "hook" || m === "hero" || m === "opening") return "hook";
  if (m === "numbers" || m === "number" || m === "kpi" || m === "kpis" || m === "stats" || m === "stat") return "number";
  if (m === "disclosure" || m === "flaw" || m === "weakness") return "disclosure";
  return null;
}

/**
 * When a @mention is broad ("@everything" / "@all"), expand to multiple
 * supported beats. Narrow mentions pass through as a single dispatch.
 */
function expand(
  beat: SupportedBeat | "all",
  card: ProfileCard,
  guidance: string,
  reason: string,
): ClassifiedDispatch[] {
  if (beat === "all") {
    return (["hook", "disclosure"] as const)
      .map((b) => makeDispatch(b, card, guidance, reason))
      .filter((d): d is ClassifiedDispatch => d !== null);
  }
  const d = makeDispatch(beat, card, guidance, reason);
  return d ? [d] : [];
}

function makeDispatch(
  beat: SupportedBeat,
  card: ProfileCard,
  guidance: string,
  reason: string,
): ClassifiedDispatch | null {
  let claimId: string | undefined;
  if (beat === "hook") claimId = card.hook?.id;
  else if (beat === "number") claimId = card.numbers[0]?.id;
  else if (beat === "disclosure") claimId = card.disclosure?.id;
  if (!claimId) return null;
  return { claimId, beat, guidance, reason };
}

/**
 * Human-readable summary of what we're about to dispatch. Used by the
 * chat pane to narrate "Revising X and Y — 2-6 min each."
 */
export function describeDispatch(ds: ClassifiedDispatch[]): string {
  if (ds.length === 0) return "Nothing to revise yet.";
  const beatPhrase = (b: SupportedBeat) =>
    b === "hook"
      ? "the hero hook"
      : b === "number"
        ? "your numbers"
        : "the disclosure";
  const parts = ds.map((d) => beatPhrase(d.beat));
  if (parts.length === 1) return `Rewriting ${parts[0]} — usually 2–6 min.`;
  const last = parts.pop();
  return `Rewriting ${parts.join(", ")} and ${last} in parallel — usually 2–6 min.`;
}
