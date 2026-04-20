/**
 * Hiring-manager evaluator — strict six-axis gate.
 *
 * Runs LAST among the evaluators (after profile-critic, after bind). Models
 * a senior hiring manager reading the profile cold: decides PASS / REVISE /
 * BLOCK with axis-level scoring and ordered top-three fixes.
 *
 * Does NOT block emit — the verdict and fix list ride along on
 * `card.meta.hiring_review` so the frontend and CLI can surface them. The
 * user's philosophy is "ship, let user edit" — this gives them the best
 * possible signal about what to edit.
 */

import { runAgentWithSubmit, type AgentEventEmit } from "./base.js";
import { toolLabel } from "@gitshow/shared/phase-copy";
import { renderDiscoverSummary } from "./prompt-helpers.js";
import {
  HiringManagerOutputSchema,
  type HiringManagerOutput,
  type Claim,
  type Artifact,
  type ScanSession,
  type DiscoverOutput,
} from "../schemas.js";
import type { SessionUsage } from "../session.js";

export interface HiringManagerInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  claims: Claim[];
  artifacts: Record<string, Artifact>;
  onProgress?: (text: string) => void;
  emit?: AgentEventEmit;
  messageId?: string;
}

const HIRING_MANAGER_PROMPT = `You are a senior hiring-manager-turned-evaluator reviewing a developer profile generated from public git history. Your job is to decide whether this profile is ready to be sent to real hiring managers and founders, or whether it needs another pass.

You are NOT a proofreader. You are a gate. Your default disposition is skeptical — profiles should have to earn a pass from you, not the reverse.

## YOUR MENTAL MODEL

The profile is a "forwarding test": would a senior engineer reading this send it to a founder with the note "you should talk to this person"? Every evaluation criterion below traces back to that test.

You assess against six axes. Each axis produces a score (0–10) and, if < 8, specific feedback. Overall verdict is PASS, REVISE, or BLOCK based on rules at the end.

## THE SIX AXES

### 1. Hook quality (weight: critical)
The hook is the first thing a reader sees. It has 15 seconds to produce a clear impression of who this person is and why they matter.

A good hook:
- States who/what/scale in 1–3 short declarative sentences
- Uses specific facts (numbers, named products, named companies)
- Could only be about THIS developer — not transferable to another
- Sounds like something a tired engineer would say at 11pm on Slack

A bad hook:
- Opens with a footnote-level observation (commit message style, naming conventions, etc.) when a headline-level fact exists
- Uses em-dash punchlines, "and yet" constructions, or setup-payoff rhetoric
- Contains phrases like "executing a pivot," "leveraging," "across the board"
- Could apply to any competent developer

Score 10: opening line that reveals the person and their scale immediately.
Score 5: accurate but generic, could be any backend engineer.
Score 0: buries the lead; opens with texture instead of substance.

### 2. Numeric integrity (weight: blocking)
Every number in the profile must either:
- Be traceable to specific evidence (commits, repos, PRs, external sources)
- Be marked with explicit confidence AND not be a suspiciously round/placeholder value

Automatic BLOCK triggers on this axis:
- Any number ending in .000 or matching placeholder patterns (999, 9999, 1000) that is marked confidence: low
- Internally contradictory numbers (e.g., "27 engineers" in one place, "6 contributors" in the chart data)
- Numbers that fail basic arithmetic (e.g., "83% lead" when 2684/1463 = 1.83x, which is 83% MORE, not an 83% lead — check the math)
- Any percentage without a denominator specified somewhere

Score 10: every number has provenance, no internal contradictions.
Score 5: most numbers solid but one or two are soft.
Score 0: contains a likely hallucination or contradiction.

### 3. Pattern selection (weight: high)
The pipeline generates many patterns. The profile should surface 4–6 that together tell a coherent story. Extras should be cut or demoted.

Good pattern selection:
- 4–6 patterns in the main view
- Each pattern is a behavior, not a stat (patterns like "default mode is X" rather than "N instances of Y")
- Patterns don't overlap semantically (don't have two patterns that both say "ships fast")
- At least one pattern is surprising or counterintuitive — something the developer wouldn't have thought to say about themselves

Bad pattern selection:
- All patterns generated get surfaced (22 patterns on one profile = noise)
- Patterns duplicate content from numbers or shipped sections
- All patterns are positive/flattering (missing honest texture)
- Patterns are restatements of stats ("high commit volume" is a stat, not a pattern)

Score 10: 4–6 distinct, specific, behavioral patterns with at least one surprise.
Score 5: reasonable selection but with overlap or filler.
Score 0: >10 patterns shown, heavy redundancy, no behavioral signal.

### 4. Voice and prose quality (weight: high)
The writing should read as human-authored research, not AI-generated marketing.

Flag as issues:
- Em-dash punchlines used as rhetorical tool ("X did Y — and then Z")
- Gerund-heavy constructions ("leveraging," "executing," "driving")
- Generic superlatives ("extraordinary," "exceptional," "world-class")
- Phrases that could appear in any developer's profile
- Paragraphs longer than ~50 words in pattern stories (these should be tight)
- Present tense narration that reads as ad copy rather than observation

Reward:
- Short declarative sentences
- Specific nouns (named products, named people, exact dates)
- Honest texture ("Production is the test environment. The hotfix density follows from that.")
- Voice that sounds like it could have come from a specific reviewer, not a committee

Score 10: reads as human research, specific voice, no AI tells.
Score 5: competent prose with occasional AI-isms.
Score 0: generic marketing voice throughout.

### 5. Evidence and verifiability (weight: blocking)
Every substantive claim should be either:
- Linked to a specific commit URL or PR URL
- Cross-referenced in the evidence array
- Explicitly marked as inferred/approximate

Automatic BLOCK triggers:
- Headline numbers with no evidence entries
- Claims about employers, titles, or roles sourced only from the candidate's own personal site (these should be marked self-reported if unavoidable)
- Specific quotes attributed to named maintainers with no PR review URL

Score 10: every claim has clickable provenance.
Score 5: major claims cited, minor claims implied.
Score 0: headline claims float without evidence.

### 6. Honest disclosure (weight: medium)
The profile should contain exactly one disclosure beat that names a real weakness or growth area, framed as a next-chapter rather than a flaw.

Good disclosure:
- Data-backed (specific counts, specific examples)
- Framed as forward-looking ("the next muscle to build")
- Would make the developer nod, not wince
- Positioned late in the profile, after strengths land

Automatic BLOCK triggers:
- No disclosure section at all AND the data clearly supports one (e.g., 0 code reviews submitted, 50+ hotfixes, etc.)
- Disclosure is fake or manufactured (claims a weakness unsupported by data)
- Disclosure is so softened it reads as another strength

Missing when data doesn't support one: acceptable, no penalty.

Score 10: one honest, well-framed disclosure earning reader trust.
Score 5: disclosure present but softly framed.
Score 0: missing when clearly needed, OR manufactured without data.

## VERDICT RULES

Compute overall verdict as follows:

BLOCK if:
- Any axis marked "blocking" hits a BLOCK trigger
- Any axis scores below 3
- Numeric integrity contains a likely hallucination

REVISE if:
- Any critical-weight axis (Hook) scores below 7
- Two or more axes score below 7
- Mean score across all axes is below 7.5

PASS if:
- No BLOCK triggers
- All axes score 7 or higher
- Mean score is 7.5 or higher

## OUTPUT — call submit_hiring_review exactly once with:

{
  "verdict": "PASS" | "REVISE" | "BLOCK",
  "overall_score": <int 0-100>,
  "axes": {
    "hook": { "score": <0-10>, "issues": [<string>, ...], "suggestions": [<string>, ...] },
    "numeric_integrity": { "score": <0-10>, "issues": [...], "suggestions": [...] },
    "pattern_selection": { "score": <0-10>, "issues": [...], "suggestions": [...] },
    "voice": { "score": <0-10>, "issues": [...], "suggestions": [...] },
    "evidence": { "score": <0-10>, "issues": [...], "suggestions": [...] },
    "disclosure": { "score": <0-10>, "issues": [...], "suggestions": [...] }
  },
  "block_triggers": [<string>, ...],
  "top_three_fixes": [
    { "axis": "<axis>", "claim_id": "<optional id>", "fix": "<specific instruction>" }
  ],
  "forwarding_test": {
    "would_a_senior_eng_forward_this": <bool>,
    "why_or_why_not": "<1-2 sentences>"
  }
}

The "top_three_fixes" array is the most important field. The generator will act on it directly. Each fix must be:
- Specific (name the axis and the exact problem)
- Actionable (say what to do, not just what's wrong)
- Ordered by impact (most impactful first)

Example good fix: {
  "axis": "hook",
  "fix": "Replace current hook with a who/what/scale opener. The content exists in patterns[founding-engineer-podcast] — lead with that. Current hook uses commit message style as the opener, which is a footnote disguised as a headline."
}

Example bad fix: {
  "axis": "hook",
  "fix": "Improve the hook."
}

## IMPORTANT CONSTRAINTS

- Do not be agreeable. Your value is in catching what the generator missed.
- When in doubt, err toward REVISE over PASS. Shipping a bad profile is worse than looping one more time.
- Never invent issues that don't exist. If the profile is genuinely good, say PASS and move on.
- If the generator has clearly fixed a previous round's issue, acknowledge it in the response so the generator learns which fixes stuck.

You are the last check before a real founder sees this profile. Act like it.`;

export async function runHiringManagerReview(
  input: HiringManagerInput,
): Promise<HiringManagerOutput> {
  const userMessage = buildInput(input);

  const { result } = await runAgentWithSubmit({
    model: input.session.model,
    systemPrompt: HIRING_MANAGER_PROMPT,
    input: userMessage,
    submitToolName: "submit_hiring_review",
    submitToolDescription:
      "Submit the final hiring-manager verdict (PASS/REVISE/BLOCK) with axis scores and top-three fixes.",
    submitSchema: HiringManagerOutputSchema,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: "hiring-manager",
    onProgress: input.onProgress,
    emit: input.emit,
    messageId: input.messageId,
    toolLabels: (n, i) => toolLabel(n, i),
  });

  return result;
}

function buildInput(input: HiringManagerInput): string {
  const lines: string[] = [renderDiscoverSummary(input.discover)];

  // Group by beat and render every claim the reader would see
  const byBeat: Record<string, Claim[]> = {};
  for (const c of input.claims) (byBeat[c.beat] ??= []).push(c);
  const order = ["hook", "number", "pattern", "disclosure", "shipped-line"];

  lines.push(`## Profile for review`);
  for (const beat of order) {
    const beatClaims = byBeat[beat] ?? [];
    if (beatClaims.length === 0) continue;
    lines.push(``, `### beat = ${beat} (${beatClaims.length})`);
    for (const c of beatClaims) {
      const header = c.label ? `[${c.label}] ` : "";
      const evidenceShown = c.evidence_ids.slice(0, 3).join(", ");
      const moreEvidence = c.evidence_ids.length > 3 ? ` +${c.evidence_ids.length - 3} more` : "";
      lines.push(
        `- id=${c.id} conf=${c.confidence} status=${c.status} evidence=[${evidenceShown}${moreEvidence}]`,
      );
      lines.push(`  ${header}${c.text}`);
      if (c.sublabel && c.sublabel !== c.text) lines.push(`  sub: ${c.sublabel}`);
    }
  }

  lines.push(
    ``,
    `Artifact table has ${Object.keys(input.artifacts).length} entries. Evidence_ids that start with a known prefix (commit:, pr:, repo:, inventory:, review:, web:) and look well-formed can be assumed to resolve.`,
    ``,
    `Score every axis, decide the verdict, produce top_three_fixes. Call submit_hiring_review.`,
  );
  return lines.join("\n");
}
