/**
 * Classify a free-form user revise request into which beat(s) to re-run.
 *
 * Keyword heuristic (no LLM). Returns either a list of dispatches OR
 * a ClassifiedError that the caller renders as an honest assistant
 * reply — critically, we NEVER silently default to `hook` when the
 * message is about something else. Silent misclassification is worse
 * than asking the user to clarify.
 *
 * Currently supported worker beats: hook, number, disclosure.
 *   pattern + shipped aren't revisable yet — classifier recognizes
 *   them and returns `{ error: "beat_not_revisable" }` so the UI can
 *   say "Pattern rewrites are coming — for now try @hook or the
 *   pattern's in-place editor."
 */

import type { ProfileCard } from "@gitshow/shared/schemas";

export type SupportedBeat = "hook" | "number" | "disclosure";
export type KnownBeat = SupportedBeat | "pattern" | "shipped" | "disclosure";

export interface ClassifiedDispatch {
  claimId: string;
  beat: SupportedBeat;
  guidance: string;
  reason: string;
}

export interface ClassifiedError {
  kind:
    | "beat_not_revisable"
    | "no_match"
    | "ambiguous";
  message: string;
  /** Which beat the user seemed to be pointing at, if we could tell. */
  detected_beat?: KnownBeat;
  /** Suggestions the UI can surface as clickable chips. */
  suggestions: string[];
}

/** Tokens we treat as @mentions of a beat. */
const MENTION_RE =
  /@(hook|hero|opening|numbers?|kpis?|stats?|disclosure|flaw|weakness|everything|all|entire)/gi;

/**
 * Per-beat keyword vocabularies. We widened pattern + shipped so they
 * MATCH — and the classifier tells the user honestly that those beats
 * aren't regenerable yet — instead of silently rerouting to hook.
 */
const BEAT_KEYWORDS: Record<KnownBeat, RegExp> = {
  hook: /\b(hook|hero|opening|first line|one.?liner|tagline|intro(?:duction)?)\b/i,
  number: /\b(numbers?|kpis?|stats?|metrics?|figures?|competitive selections|shipping numbers|counts?)\b/i,
  disclosure: /\b(disclosure|flaw|weakness|honest|trade[- ]?off|limitation|gap|next chapter|ship.?first)\b/i,
  pattern:
    /\b(pattern|patterns|commit log|commits? log|things to know|insights?|headings?|headlines?|stories|bullet|bullets)\b/i,
  shipped:
    /\b(shipped|projects?|receipts?|what (i|you)(?:'ve)? shipped|portfolio|ship[ -]?list)\b/i,
};

/** Scope-expanding phrases: "fix everything", "the whole profile", etc. */
const SCOPE_ALL_RE =
  /\b(everything|entire profile|whole profile|whole thing|all (the|of the) (text|prose|profile)|every part|overall)\b/i;

const QUALITY_RE =
  /\b(too (long|much text|many)|concise|shorter|trim|tight(er|en)?|bulky?|bold|formatting|rewrite|redo|better|clean(er)?|crisp(er)?|punchy|boring|bad|weak|verbose|fewer|less)\b/i;

/**
 * Generic feedback signals: "feels wrong", "fix this", "doesn't mention X",
 * "add my employer", "missing Y". These don't point at a specific beat —
 * the user's giving correction-style feedback about the overall profile.
 * Route to the hook (the hero line) with the full guidance attached; the
 * hook-writer is the agent best positioned to weave a correction into
 * the most visible surface. Better than punting with "I can't tell what
 * you meant" — punting makes the user feel the system is broken.
 */
const FEEDBACK_RE =
  /\b(wrong|incorrect|missing|mention|include|add|doesn'?t (?:say|mention|include)|feels (?:off|wrong|weird)|fix|off|work(?:s|ed|ing)? at|employer|company|job|role)\b/i;

export type ClassificationResult =
  | { ok: true; dispatches: ClassifiedDispatch[] }
  | { ok: false; error: ClassifiedError };

export function classifyRevise(
  guidance: string,
  card: ProfileCard,
): ClassificationResult {
  const out: ClassifiedDispatch[] = [];
  const seen = new Set<SupportedBeat>();
  const detectedAll: KnownBeat[] = [];

  // 1) Explicit @mentions always win.
  const mentions = [...guidance.matchAll(MENTION_RE)].map((m) =>
    m[1]!.toLowerCase(),
  );
  for (const mention of mentions) {
    const beat = mentionToBeat(mention);
    if (!beat) continue;
    detectedAll.push(beat);
    if (isSupported(beat)) {
      const d = makeDispatch(beat, card, guidance, `@${mention}`);
      if (d && !seen.has(d.beat)) {
        seen.add(d.beat);
        out.push(d);
      }
    }
  }
  if (out.length > 0) return { ok: true, dispatches: out };
  if (detectedAll.length > 0 && !detectedAll.some(isSupported)) {
    return notRevisable(detectedAll[0]!);
  }

  // 2) Scope-all + quality → revise all supported free-prose beats.
  if (SCOPE_ALL_RE.test(guidance) && QUALITY_RE.test(guidance)) {
    for (const beat of ["hook", "disclosure"] as const) {
      const d = makeDispatch(beat, card, guidance, "across the whole profile");
      if (d && !seen.has(d.beat)) {
        seen.add(d.beat);
        out.push(d);
      }
    }
    if (out.length > 0) return { ok: true, dispatches: out };
  }

  // 3) Per-beat keyword hits across ALL known beats, including unsupported
  //    ones. If the user's words point at pattern/shipped, tell them
  //    straight instead of redirecting to hook.
  for (const [beat, re] of Object.entries(BEAT_KEYWORDS) as Array<
    [KnownBeat, RegExp]
  >) {
    if (re.test(guidance)) detectedAll.push(beat);
  }

  const supportedHits = detectedAll.filter(isSupported);
  const unsupportedHits = detectedAll.filter((b) => !isSupported(b));

  for (const beat of supportedHits) {
    if (seen.has(beat)) continue;
    const d = makeDispatch(beat, card, guidance, `mentions ${beat}`);
    if (d) {
      seen.add(d.beat);
      out.push(d);
    }
  }
  if (out.length > 0) return { ok: true, dispatches: out };

  if (unsupportedHits.length > 0) {
    return notRevisable(unsupportedHits[0]!);
  }

  // 4) Generic feedback with no specific beat. The message reads like
  //    correction ("missing X", "feels wrong", "doesn't mention Y") —
  //    route to hook with the full guidance attached. Hook regen is the
  //    most visible fix and the writer is best at weaving corrections
  //    into the opener. Only trigger when there's actually a feedback
  //    signal; truly unrelated messages still fall through to "no match".
  if (FEEDBACK_RE.test(guidance)) {
    const d = makeDispatch("hook", card, guidance, "feedback → hook");
    if (d) return { ok: true, dispatches: [d] };
  }

  // 5) Nothing matched — ask the user to name a beat instead of
  //    silently defaulting.
  return {
    ok: false,
    error: {
      kind: "no_match",
      message:
        "I can't tell which part you'd like to change. Could you name it? Try @hook, @numbers, or @disclosure — or click a section of the profile.",
      suggestions: [
        "@hook tighten the opener",
        "@numbers pick different KPIs",
        "@disclosure rewrite the honest paragraph",
      ],
    },
  };
}

function notRevisable(detected: KnownBeat): ClassificationResult {
  if (detected === "pattern") {
    return {
      ok: false,
      error: {
        kind: "beat_not_revisable",
        detected_beat: "pattern",
        message:
          "Pattern rewrites aren't automated yet. For now, click a specific pattern on the profile and edit it inline — or ask me to change the hook/numbers/disclosure instead.",
        suggestions: [
          "@hook make the opener punchier",
          "@numbers emphasize different signals",
        ],
      },
    };
  }
  if (detected === "shipped") {
    return {
      ok: false,
      error: {
        kind: "beat_not_revisable",
        detected_beat: "shipped",
        message:
          "Shipped-list rewrites aren't automated yet. You can reorder or remove projects by clicking them on the profile — or ask me to rewrite the hook/numbers/disclosure.",
        suggestions: [
          "@hook rewrite the opener",
          "@numbers pick different numbers",
        ],
      },
    };
  }
  return {
    ok: false,
    error: {
      kind: "no_match",
      message:
        "I can't tell which part you'd like to change. Try @hook, @numbers, or @disclosure.",
      suggestions: [],
    },
  };
}

function isSupported(beat: KnownBeat): beat is SupportedBeat {
  return beat === "hook" || beat === "number" || beat === "disclosure";
}

function mentionToBeat(mention: string): KnownBeat | null {
  const m = mention.toLowerCase();
  if (m === "hook" || m === "hero" || m === "opening") return "hook";
  if (
    m === "numbers" ||
    m === "number" ||
    m === "kpi" ||
    m === "kpis" ||
    m === "stats" ||
    m === "stat"
  )
    return "number";
  if (m === "disclosure" || m === "flaw" || m === "weakness") return "disclosure";
  return null;
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

/** Human-readable summary of dispatches. */
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
