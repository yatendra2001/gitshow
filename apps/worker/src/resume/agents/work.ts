/**
 * work-agent — produces the Work Experience accordion.
 *
 * Source priority:
 *   1. User intake answers stored in `session.context_notes` — highest trust.
 *      The webapp is expected to format intake answers as a simple
 *      structured block the LLM can parse (see prompt).
 *   2. LinkedIn markdown fetched via Jina Reader (`linkedin.ts`).
 *   3. GitHub profile bio + company field + team-repo signals from the
 *      artifact table (used to prompt for confirmation, not cited as fact).
 *
 * The agent NEVER invents companies. If all three sources are empty it
 * returns []; the portfolio's work section just doesn't render.
 *
 * Logo sourcing: we use Clearbit's free logo API (no key needed) based
 * on company domain when we have one. Missing domain → initials fallback
 * rendered by the frontend.
 */

import * as z from "zod/v4";
import { runAgentWithSubmit } from "../../agents/base.js";
import type { ScanSession, Artifact } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { GitHubData } from "../../types.js";
import { fetchLinkedIn, extractCompaniesFromNotes } from "../linkedin.js";
import { modelForRole } from "@gitshow/shared/models";
import {
  formatEvidenceBag,
  type EvidenceBag,
} from "../research/dev-evidence.js";

export const WorkEntryLLMSchema = z.object({
  company: z.string().max(120),
  title: z.string().max(120),
  start: z.string().max(40).describe("'May 2021' or '2020'. Free-form."),
  end: z.string().max(40).describe("'Oct 2022', 'Present', or ''."),
  location: z.string().max(120).optional(),
  description: z.string().max(2000),
  href: z.string().url().optional(),
  /**
   * Optional company domain, used by the assembler to request a Clearbit
   * logo. The agent should leave this empty rather than guess.
   */
  domain: z.string().max(120).optional(),
  badges: z.array(z.string().max(40)).default([]),
});
export type WorkEntryLLM = z.infer<typeof WorkEntryLLMSchema>;

export const WorkAgentOutputSchema = z.object({
  work: z.array(WorkEntryLLMSchema).max(30),
  /** Agent notes on confidence / remaining questions — non-rendering. */
  notes: z.string().max(500).optional(),
});
export type WorkAgentOutput = z.infer<typeof WorkAgentOutputSchema>;

export interface WorkEntry {
  id: string;
  company: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  logoUrl?: string;
  description: string;
  href?: string;
  badges: string[];
}

export interface WorkAgentInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  artifacts: Record<string, Artifact>;
  /** Optional evidence bag from the DevEvidence research phase. */
  evidence?: EvidenceBag;
  onProgress?: (text: string) => void;
}

const SYSTEM_PROMPT = `You reconstruct a developer's work history for their portfolio.

You'll receive these inputs, ordered by trust:
  1. Intake answers (if present) — user-provided; treat as authoritative.
  2. LinkedIn markdown (if present) — user confirmed this URL; treat as factual, but prefer intake when they conflict.
  3. Web evidence (if present) — interviews, press, talks, podcasts we found. Use confidence=high evidence as strong signal for employment (a press piece saying "X, an engineer at Stripe, built ..." is solid). Confidence medium or low require corroboration from another source before you commit a company.
  4. GitHub signals — bio, company field, team-repo contributors. Treat these as HINTS, never confirmed employment.

Produce a chronological work[] array, most-recent first. Each entry:
  - company: official company name ("Stripe", not "stripe.com")
  - title: exact role title ("Software Engineer", "Founding Engineer")
  - start / end: "May 2021" / "Present" / "2020". Accept any format the source used.
  - location: "Remote", city, or omit.
  - description: 1-3 sentences of specific, non-generic portfolio prose. What did they own? What shipped? Avoid filler ("passionate team player", "collaborated cross-functionally"). **If the source data doesn't give you concrete details, OMIT the description (leave it as an empty string). Do NOT write meta-narration about your sourcing process** — phrases like "Role confirmed; project-level details not available in current sources", "per LinkedIn", "per our records", "details not yet available" are all banned. The description must read like it was written by the developer, not by a quality-control report.
  - href: the company's primary URL if you can determine it from the source with certainty. Otherwise omit.
  - domain: the company's root domain (e.g. "stripe.com") for logo lookup. Omit if unclear.
  - badges: empty [] by default. Use ["Founding"] / ["Intern"] only when it's explicit in the source.

CRITICAL RULES:
  - Never invent a company. If no source supports it, it doesn't exist.
  - Never guess dates. If the source says "2021" only, use "2021" — don't add a month.
  - Never pull employment from GitHub commit emails alone. Team-repo signals are HINTS for you to confirm in the LinkedIn / intake text, not standalone evidence.
  - When sources disagree, prefer intake > LinkedIn > GitHub hints. Note the conflict in "notes".
  - NEVER leak internal-process language into description. Words like "confirmed", "not available", "in current sources", "per LinkedIn" belong in the notes field, not in user-facing prose.

If ALL sources are empty or insubstantial, call submit_work with an empty work[] and notes="no usable sources". Do not fabricate.

Call submit_work exactly once.`;

export async function runWorkAgent(input: WorkAgentInput): Promise<WorkEntry[]> {
  const userMessage = await buildInput(input);
  const log = input.onProgress ?? (() => {});

  // If absolutely no source, short-circuit without an LLM call.
  if (!userMessage.hasAnySource) {
    log(`\n[work] skipping LLM — no LinkedIn, no intake notes, no team-repo hints.\n`);
    return [];
  }

  const { result } = await runAgentWithSubmit({
    model: modelForRole("section"),
    systemPrompt: SYSTEM_PROMPT,
    input: userMessage.text,
    submitToolName: "submit_work",
    submitToolDescription:
      "Submit the reconstructed work history. Call exactly once.",
    submitSchema: WorkAgentOutputSchema,
    reasoning: { effort: "medium" },
    session: input.session,
    usage: input.usage,
    label: "resume:work",
    onProgress: input.onProgress,
  });

  return result.work.map((w, i): WorkEntry => ({
    id: `work:${i}:${slug(w.company)}`,
    company: w.company,
    title: w.title,
    start: w.start,
    end: w.end,
    location: w.location,
    logoUrl: w.domain ? clearbitLogoUrl(w.domain) : undefined,
    description: w.description,
    href: w.href,
    badges: w.badges,
  }));
}

async function buildInput(input: WorkAgentInput): Promise<{ text: string; hasAnySource: boolean }> {
  const { session, github, artifacts, onProgress } = input;
  const lines: string[] = [];
  let hasSource = false;

  // (1) Intake answers — currently carried inside context_notes. Later
  //     the webapp will prefix these with a stable marker; for now we
  //     just hand the whole note over.
  if (session.context_notes && session.context_notes.trim().length > 0) {
    hasSource = true;
    lines.push(`## Intake answers (user-provided, highest trust)`);
    lines.push(session.context_notes.trim());
    lines.push("");
  }

  // (2) Web evidence from the DevEvidence research phase (optional).
  if (input.evidence && input.evidence.cards.length > 0) {
    hasSource = true;
    lines.push(formatEvidenceBag(input.evidence, 15));
    lines.push("");
  }

  // (3) LinkedIn markdown — TinyFish first, Jina fallback (see linkedin.ts).
  const linkedin = await fetchLinkedIn(session, { onProgress });
  if (linkedin) {
    hasSource = true;
    (onProgress ?? (() => {}))(
      `\n[work] LinkedIn tier=${linkedin.tier} chars=${linkedin.text.length}\n`,
    );
    lines.push(`## LinkedIn content (tier=${linkedin.tier})`);
    // Clamp to 8k chars — LinkedIn pages are noisy; the agent only
    // needs the Experience + Education blocks.
    lines.push(linkedin.text.slice(0, 8000));
    lines.push("");
  }

  // (3) GitHub hints — bio / team repos / companies mentioned in context notes.
  const profileHints: string[] = [];
  if (github.profile.bio) profileHints.push(`Bio: ${github.profile.bio}`);
  if (github.profile.location) profileHints.push(`Location: ${github.profile.location}`);
  const teamRepos = Object.values(artifacts)
    .filter((a) =>
      a.id.startsWith("inventory:") &&
      (a.metadata as Record<string, unknown>).looks_like_team_repo,
    )
    .slice(0, 6);
  if (teamRepos.length > 0) {
    profileHints.push(`Team repos (multi-contributor, hint for employment — confirm in LinkedIn/intake):`);
    for (const t of teamRepos) {
      const m = t.metadata as Record<string, unknown>;
      profileHints.push(`  - ${m.repo} · ${m.user_commits} commits, ${m.first_commit} → ${m.last_commit}`);
    }
    hasSource = true;
  }
  const companyMentions = extractCompaniesFromNotes(session.context_notes);
  if (companyMentions.length > 0) {
    profileHints.push(`@mentions in notes: ${companyMentions.join(", ")}`);
  }
  if (profileHints.length > 0) {
    lines.push(`## GitHub hints (not confirmed employment)`);
    for (const h of profileHints) lines.push(h);
    lines.push("");
  }

  if (!hasSource) {
    return { text: "", hasAnySource: false };
  }

  lines.push(`---`);
  lines.push(`Produce work[] — most recent first. Never invent. Call submit_work.`);
  return { text: lines.join("\n"), hasAnySource: true };
}

function clearbitLogoUrl(domain: string): string {
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return `https://logo.clearbit.com/${clean}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
