/**
 * Hook Critic — scores 5 candidates and picks a winner, or requests a revision.
 *
 * Pattern: evaluator-optimizer (Anthropic). The writer and critic are
 * different agents. The critic has no ego — it will reject all 5 and
 * send the writer back to the drawing board if nothing meets the bar.
 */

import { runAgentWithSubmit } from "../base.js";
import { renderDiscoverSummary } from "../prompt-helpers.js";
import {
  HookCriticOutputSchema,
  type HookCriticOutput,
  type HookWriterOutput,
  type DiscoverOutput,
  type ScanSession,
} from "../../schemas.js";
import type { SessionUsage } from "../../session.js";

export interface HookCriticInput {
  session: ScanSession;
  usage: SessionUsage;
  candidates: HookWriterOutput;
  discover: DiscoverOutput;
  onProgress?: (text: string) => void;
}

const HOOK_CRITIC_PROMPT = `You are a hook critic. You score 5 candidate hooks against 4 criteria, each 0-10:

  specific    — real numbers / names / dates (vs. "many", "often", "fast")
  verifiable  — every claim inside the hook is citable via the evidence_ids (you can see them)
  surprising  — the developer themselves couldn't have written it on LinkedIn
  earned      — the data clearly supports it; no reach

BANNED PATTERNS (automatic score drops):
  - em-dash punchlines ("I ship AI products — and they work.")
  - "and yet" rhetorical constructions
  - generic adjectives like "passionate", "innovative", "dedicated"
  - hooks that could apply to another developer
  - commit-count framings as the PRIMARY hook ("#1 committer", "27% of all commits"). Only acceptable as the SECOND sentence anchoring a stronger lead.

PREFER (score boosts):
  - Third-party validation hooks that show OTHER people chose this developer: "1 of N apps globally on <curated list>", "beat X developers in <hackathon>", "<maintainer> said '<quote>' on PR #X".
  - Specific named shipped work with scale: "shipped <language> into a <N>-star repo 104 days after first touch", "built <specific feature> solo in <time window>".

AUTO-REJECT GATE (highest priority — evaluated FIRST, before scoring):

If the developer has a named employer + measurable team-scale in the data — i.e. the discover summary's primary_shape mentions a company / product / role AND you can point to a team-repo stat (N-of-M committers, X-month tenure, etc.) — then the winning hook MUST establish *who/what/scale* in its FIRST sentence. Not pattern. Not commit-message texture. Not voice-as-content.

Reject every candidate whose first sentence is about commit-message style, after-the-fact doc writing, cadence aesthetics, or any "footnote-as-headline" choice when identity data is available. A founder scanning for 15 seconds must learn *who this person is and the scale they operate at* from the hook. Texture is allowed in the SECOND sentence, not the first.

If all 5 candidates fail this gate, set winner_index to null and send a revise_instruction like: "All 5 candidates led with texture. The data names [employer] — the first sentence of every new candidate must establish identity and scale. Texture is fine as the second sentence, not the lead."

Pick the single winning candidate. If none is good enough (best winner_score < 28 out of 40), set winner_index to null and write a short revise_instruction telling the writer what to change. Do NOT rewrite the hooks yourself.

Call submit_hook_critique exactly once.`;

export async function runHookCritic(input: HookCriticInput): Promise<HookCriticOutput> {
  const userMessage = buildCriticInput(input);

  const { result } = await runAgentWithSubmit({
    model: input.session.model,
    systemPrompt: HOOK_CRITIC_PROMPT,
    input: userMessage,
    submitToolName: "submit_hook_critique",
    submitToolDescription:
      "Submit scores for all 5 candidates and either a winner_index or a revise_instruction.",
    submitSchema: HookCriticOutputSchema,
    reasoning: { effort: "medium" },
    session: input.session,
    usage: input.usage,
    label: "hook-critic",
    onProgress: input.onProgress,
  });

  return result;
}

function buildCriticInput(input: HookCriticInput): string {
  const lines: string[] = [renderDiscoverSummary(input.discover), `## Candidates`];
  input.candidates.candidates.forEach((c, i) => {
    lines.push(`### ${i} (voice: ${c.voice})`);
    lines.push(c.text);
    lines.push(`evidence: [${c.evidence_ids.join(", ")}]`);
    lines.push(`reasoning from writer: ${c.reasoning}`);
    lines.push(``);
  });
  lines.push(`Score each on specific/verifiable/surprising/earned (0-10). Pick winner or request revision. Call submit_hook_critique.`);
  return lines.join("\n");
}
