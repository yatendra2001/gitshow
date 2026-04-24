/**
 * education-agent — produces the Education section.
 *
 * Source priority (same as work-agent):
 *   1. Intake answers (context_notes) — highest trust.
 *   2. LinkedIn Education block.
 *   3. Bio hints (free-form).
 *
 * Never invented. If no source has content, returns [].
 */

import * as z from "zod/v4";
import { runAgentWithSubmit } from "../../agents/base.js";
import type { ScanSession, Artifact } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { GitHubData } from "../../types.js";
import { fetchLinkedIn } from "../linkedin.js";
import { modelForRole } from "@gitshow/shared/models";
import {
  formatEvidenceBag,
  type EvidenceBag,
} from "../research/dev-evidence.js";

export const EducationEntryLLMSchema = z.object({
  school: z.string().max(120),
  degree: z.string().max(200),
  start: z.string().max(40),
  end: z.string().max(40),
  href: z.string().url().optional(),
  /** Domain for logo lookup via Clearbit (e.g. "mit.edu"). */
  domain: z.string().max(120).optional(),
});
export type EducationEntryLLM = z.infer<typeof EducationEntryLLMSchema>;

export const EducationAgentOutputSchema = z.object({
  education: z.array(EducationEntryLLMSchema).max(15),
  notes: z.string().max(500).optional(),
});
export type EducationAgentOutput = z.infer<typeof EducationAgentOutputSchema>;

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  start: string;
  end: string;
  logoUrl?: string;
  href?: string;
}

export interface EducationAgentInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  artifacts: Record<string, Artifact>;
  evidence?: EvidenceBag;
  trace?: import("../observability/trace.js").ScanTrace;
  onProgress?: (text: string) => void;
}

const SYSTEM_PROMPT = `You reconstruct a developer's education history for their portfolio.

Inputs (same trust order as work):
  1. Intake answers.
  2. LinkedIn Education section.
  3. Web evidence cards (if present).
  4. Bio hints.

Produce education[] most-recent first. Each entry:
  - school: official name ("University of Waterloo", "MIT").
  - degree: "B.S. Computer Science" / "M.Eng" / "Bootcamp" — whatever the source says.
  - start / end: year strings, "2016" / "2020" / "Present".
  - href: school's canonical URL when knowable.
  - domain: root domain for logo lookup when knowable.

Never invent a school. If no source supports one, return empty education[] with notes="no usable sources".
NEVER write meta-narration in ANY field. "Degree confirmed", "per LinkedIn", "details not in current sources" etc. are banned — that language belongs in the notes field, not in user-facing text.

Call submit_education exactly once.`;

export async function runEducationAgent(
  input: EducationAgentInput,
): Promise<EducationEntry[]> {
  const built = await buildInput(input);
  const log = input.onProgress ?? (() => {});

  if (!built.hasAnySource) {
    log(`\n[education] skipping LLM — no LinkedIn or intake sources.\n`);
    return [];
  }

  const { result } = await runAgentWithSubmit({
    model: modelForRole("section"),
    systemPrompt: SYSTEM_PROMPT,
    input: built.text,
    submitToolName: "submit_education",
    submitToolDescription:
      "Submit the reconstructed education history. Call exactly once.",
    submitSchema: EducationAgentOutputSchema,
    reasoning: { effort: "medium" },
    session: input.session,
    usage: input.usage,
    label: "resume:education",
    onProgress: input.onProgress,
    trace: input.trace,
  });

  return result.education.map((e, i): EducationEntry => ({
    id: `edu:${i}:${slug(e.school)}`,
    school: e.school,
    degree: e.degree,
    start: e.start,
    end: e.end,
    href: e.href,
    logoUrl: e.domain ? `https://logo.clearbit.com/${e.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]}` : undefined,
  }));
}

async function buildInput(input: EducationAgentInput): Promise<{ text: string; hasAnySource: boolean }> {
  const { session, github, onProgress } = input;
  const lines: string[] = [];
  let hasSource = false;

  if (session.context_notes && session.context_notes.trim().length > 0) {
    hasSource = true;
    lines.push(`## Intake answers`);
    lines.push(session.context_notes.trim());
    lines.push("");
  }

  if (input.evidence && input.evidence.cards.length > 0) {
    hasSource = true;
    lines.push(formatEvidenceBag(input.evidence, 15));
    lines.push("");
  }

  const linkedin = await fetchLinkedIn(session, { onProgress, trace: input.trace });
  if (linkedin) {
    hasSource = true;
    (onProgress ?? (() => {}))(
      `\n[education] LinkedIn tier=${linkedin.tier} chars=${linkedin.text.length}\n`,
    );
    lines.push(`## LinkedIn content (tier=${linkedin.tier})`);
    lines.push(linkedin.text.slice(0, 8000));
    lines.push("");
  }

  if (github.profile.bio) {
    lines.push(`## GitHub bio (hint)`);
    lines.push(github.profile.bio);
    lines.push("");
  }

  if (!hasSource) return { text: "", hasAnySource: false };

  lines.push(`---`);
  lines.push(`Produce education[] — most recent first. Never invent. Call submit_education.`);
  return { text: lines.join("\n"), hasAnySource: true };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
