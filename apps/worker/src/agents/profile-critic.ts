/**
 * Profile Critic — final evaluator-optimizer pass.
 *
 * Runs over the assembled profile (all claims in all beats) and answers:
 * would a senior engineer forward this? Flags individual claims that fail
 * the four-check rubric (specific / verifiable / surprising / earned).
 * The orchestrator routes flagged claims back to their source worker.
 */

import { runAgentWithSubmit, type AgentEventEmit } from "./base.js";
import { toolLabel } from "@gitshow/shared/phase-copy";
import { renderDiscoverSummary } from "./prompt-helpers.js";
import {
  ProfileCriticOutputSchema,
  type ProfileCriticOutput,
  type Claim,
  type Artifact,
  type ScanSession,
  type DiscoverOutput,
} from "../schemas.js";
import type { SessionUsage } from "../session.js";

export interface ProfileCriticInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  claims: Claim[];
  artifacts: Record<string, Artifact>;
  onProgress?: (text: string) => void;
  emit?: AgentEventEmit;
  messageId?: string;
}

const CRITIC_PROMPT = `You are the final critic on a developer dossier. Your test: would a senior engineer forward this profile to a founder with "you should talk to this person"?

You see every claim on the page (hook, numbers, patterns, disclosure, shipped). For each, judge against four criteria:
  specific    — real numbers / names / dates
  verifiable  — evidence_ids resolve to real artifacts and actually support the claim
  surprising  — the developer couldn't have written it themselves
  earned      — data clearly supports it; not a stretch

Flag any claim that fails as either:
  - not_specific / not_verifiable / not_surprising / not_earned — narrow critique
  - generic — feels like it could be written for anyone
  - factually_wrong — evidence doesn't support it

Also provide:
  - overall_score 0-100
  - forwardable: would you yourself forward this? (strict — default to false if overall_score < 70)
  - top_strengths (what's working)
  - top_gaps (what's missing that the profile should have covered but didn't)

Call submit_profile_critique exactly once.`;

export async function runProfileCritic(
  input: ProfileCriticInput,
): Promise<ProfileCriticOutput> {
  const userMessage = buildInput(input);

  const { result } = await runAgentWithSubmit({
    model: input.session.model,
    systemPrompt: CRITIC_PROMPT,
    input: userMessage,
    submitToolName: "submit_profile_critique",
    submitToolDescription: "Submit profile critique with flagged claims, strengths, gaps.",
    submitSchema: ProfileCriticOutputSchema,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: "profile-critic",
    onProgress: input.onProgress,
    emit: input.emit,
    messageId: input.messageId,
    toolLabels: (n, i) => toolLabel(n, i),
  });

  return result;
}

function buildInput(input: ProfileCriticInput): string {
  const lines: string[] = [renderDiscoverSummary(input.discover)];

  const byBeat: Record<string, Claim[]> = {};
  for (const c of input.claims) {
    (byBeat[c.beat] ??= []).push(c);
  }
  const order = ["hook", "number", "pattern", "disclosure", "shipped-line", "technical-depth", "radar-axis"];

  lines.push(`## Profile claims for review`);
  for (const beat of order) {
    const beatClaims = byBeat[beat] ?? [];
    if (beatClaims.length === 0) continue;
    lines.push(`### beat = ${beat} (${beatClaims.length})`);
    for (const c of beatClaims) {
      const header = c.label ? `[${c.label}] ` : "";
      lines.push(`- id=${c.id} conf=${c.confidence} evidence=[${c.evidence_ids.join(", ")}]`);
      lines.push(`  ${header}${c.text}`);
      if (c.sublabel && c.sublabel !== c.text) lines.push(`  sublabel: ${c.sublabel}`);
    }
    lines.push(``);
  }

  lines.push(`Artifact table has ${Object.keys(input.artifacts).length} entries — you can trust evidence_ids that look well-formed.`);
  lines.push(``);
  lines.push(`Score, flag, and call submit_profile_critique.`);
  return lines.join("\n");
}
