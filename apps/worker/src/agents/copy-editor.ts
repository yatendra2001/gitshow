/**
 * Copy editor — a dedicated voice pass over every claim.
 *
 * The other agents are optimized for FINDING things (evidence, patterns,
 * numbers). They tend to write in "AI voice": gerund-heavy, formal,
 * plausibly-correct-but-wooden. This agent rewrites the text of every
 * claim in the assembled Profile using strict editorial rules:
 *
 *   - Short declarative sentences. Fragments OK.
 *   - Active verbs. No gerund-chains ("executed a pivot", "leveraging").
 *   - No AI-tells: "demonstrates capability", "seamlessly", "deliberately".
 *   - Same facts, same numbers, same citations — only the prose changes.
 *   - The test: could a tired engineer say this at 11pm on Slack?
 *
 * Runs AFTER assemble, BEFORE critic. Preserves evidence_ids + all IDs.
 */

import { runAgentWithSubmit, type AgentEventEmit } from "./base.js";
import { toolLabel } from "@gitshow/shared/phase-copy";
import * as z from "zod/v4";
import type {
  Profile,
  Claim,
  ScanSession,
} from "../schemas.js";
import type { SessionUsage } from "../session.js";

const EditedClaimSchema = z.object({
  id: z.string(),
  text: z.string().max(1000),
  label: z.string().max(80).optional(),
  sublabel: z.string().max(300).optional(),
});
type EditedClaim = z.infer<typeof EditedClaimSchema>;

const CopyEditorOutputSchema = z.object({
  edits: z
    .array(EditedClaimSchema)
    .describe("One entry per input claim you touched. Omit entries you left alone."),
  distinctive_paragraph: z
    .string()
    .max(2500)
    .optional()
    .describe(
      "Rewritten version of the distinctive paragraph. Same facts, human voice. " +
      "Omit to leave unchanged.",
    ),
});
type CopyEditorOutput = z.infer<typeof CopyEditorOutputSchema>;

export interface CopyEditorInput {
  session: ScanSession;
  usage: SessionUsage;
  profile: Profile;
  onProgress?: (text: string) => void;
  /**
   * Optional extra guidance appended to the input (used by the hiring-
   * manager revise loop when the voice axis is flagged). Tells the editor
   * exactly what a prior reviewer said was wrong.
   */
  reviseInstruction?: string;
  emit?: AgentEventEmit;
  messageId?: string;
}

const COPY_EDITOR_PROMPT = `You are the voice editor on a developer-profile pipeline. Upstream agents produce claims that are accurate but read like AI wrote them. Your one job is to rewrite the prose so the page sounds like a human.

STRICT RULES

1. Preserve every fact. Every number, date, project name, maintainer name, percentage, evidence tie — must survive unchanged.
2. Same claim id. Never invent a new id. Never drop or merge claims.
3. Shorten and flatten:
   - Prefer 1–3 short declarative sentences. Fragments are allowed.
   - Active verbs. Present tense where natural.
   - Cut adverbs ("deliberately", "thoughtfully", "seamlessly") unless they earn their place.

BANNED PHRASES / CONSTRUCTIONS (delete or replace every one you see)

   - "executed a pivot", "executed a migration", "executed X"
   - "demonstrates capability", "demonstrates depth", "demonstrates X"
   - "leverages", "leveraging", "leveraged"
   - "across the board", "across multiple domains"
   - "showcases", "showcased"
   - "a deliberate X", "a thoughtful X"
   - "embodies", "exemplifies"
   - any sentence whose verb is a -ing gerund piled on another -ing gerund
   - "under his belt", "notches", "chalks up"
   - "AI-cheery" tells: "what's more", "it's worth noting that", "impressively"

PREFER

   - Present-tense declarative ("Ships Rust into 70k-star OSS." not "Has shipped...")
   - Specific over general ("15,950 lines, one commit" not "a substantial migration")
   - Punchy cadence ("15,950 lines. One commit. 5:12am.") where it fits
   - Let numbers do the heavy lifting — don't describe what they already say

THE TEST

Before submitting each rewrite ask: could a tired engineer say this at 11pm on Slack without it sounding like ad copy? If no, rewrite.

INPUT / OUTPUT

You will receive:
  1. Every claim in the profile with id + beat + label? + sublabel? + text.
  2. The \`distinctive_paragraph\` — a short bio-style summary at the top of the profile.

For each claim you rewrite, submit an entry in \`edits\` with the same id and the new text/label/sublabel. Claims you leave alone can be omitted.

For the distinctive_paragraph, apply the SAME rules (ban the phrases, flatten, shorten). Submit it under \`distinctive_paragraph\` — omit only if it's already clean.

Call submit_edits exactly once with all your edits.`;

export async function runCopyEditor(input: CopyEditorInput): Promise<Profile> {
  const userMessage = buildInput(input.profile, input.reviseInstruction);

  const { result } = await runAgentWithSubmit<CopyEditorOutput>({
    model: input.session.model,
    systemPrompt: COPY_EDITOR_PROMPT,
    input: userMessage,
    submitToolName: "submit_edits",
    submitToolDescription:
      "Submit rewrites for the claims you touched. Preserve all facts + ids.",
    submitSchema: CopyEditorOutputSchema,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: "copy-editor",
    onProgress: input.onProgress,
    emit: input.emit,
    messageId: input.messageId,
    toolLabels: (n, i) => toolLabel(n, i),
  });

  return applyEdits(input.profile, result.edits, result.distinctive_paragraph);
}

function buildInput(profile: Profile, reviseInstruction?: string): string {
  const lines: string[] = [];
  lines.push(`## Developer: @${profile.handle}`);
  lines.push(``);
  if (reviseInstruction) {
    lines.push(`## Revision guidance (from a prior review)`);
    lines.push(reviseInstruction);
    lines.push(
      `Apply this in addition to the standard voice rules. Address this specific feedback first.`,
    );
    lines.push(``);
  }
  lines.push(`## distinctive_paragraph`);
  lines.push(profile.distinctive_paragraph);
  lines.push(``);
  lines.push(`## Claims to edit (${profile.claims.length} total)`);
  lines.push(``);

  for (const c of profile.claims) {
    lines.push(`### ${c.id}  [beat=${c.beat}]`);
    if (c.label) lines.push(`  label: ${c.label}`);
    if (c.sublabel) lines.push(`  sublabel: ${c.sublabel}`);
    lines.push(`  text: ${c.text}`);
    lines.push(``);
  }

  lines.push(
    `Rewrite every claim that sounds like AI. Also rewrite distinctive_paragraph if it contains any banned phrase. Submit one edit per touched claim. Keep all facts.`,
  );
  return lines.join("\n");
}

function applyEdits(
  profile: Profile,
  edits: EditedClaim[],
  distinctiveOverride?: string,
): Profile {
  const byId = new Map<string, EditedClaim>();
  for (const e of edits) byId.set(e.id, e);

  const newClaims: Claim[] = profile.claims.map((c) => {
    const e = byId.get(c.id);
    if (!e) return c;
    return {
      ...c,
      text: e.text || c.text,
      label: e.label ?? c.label,
      sublabel: e.sublabel ?? c.sublabel,
    };
  });

  return {
    ...profile,
    claims: newClaims,
    distinctive_paragraph: distinctiveOverride ?? profile.distinctive_paragraph,
  };
}
