/**
 * person-agent — writes the Resume's identity block.
 *
 * Produces:
 *   - name (from GitHub profile, overridable)
 *   - initials (derived)
 *   - description (one-line bio under the hero)
 *   - summary (markdown About paragraph with cross-section markdown links
 *     back into the portfolio sections, e.g. `[interned at big tech](/#work)`)
 *   - location / url / avatarUrl passthrough
 *
 * The summary is the single highest-quality prose piece on the portfolio,
 * so this agent uses Opus and gets rich context: the primary_shape from
 * discover, the top projects (titles + one-liners), the top work entries
 * (companies), and the education entries. It's NOT given free rein —
 * strict "no hallucinated facts" and "use dashed cross-section links"
 * rules keep the output verifiable and navigable.
 */

import * as z from "zod/v4";
import { runAgentWithSubmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import {
  formatEvidenceBag,
  type EvidenceBag,
} from "../research/dev-evidence.js";
import type { ScanSession, Artifact } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { GitHubData } from "../../types.js";
import type { DiscoverOutput } from "../../schemas.js";

export const PersonAgentOutputSchema = z.object({
  name: z.string().max(120).describe("Display name — prefer GitHub profile name, fall back to handle"),
  description: z
    .string()
    .max(220)
    .describe(
      "One-line bio shown under the hero heading. 12-30 words. Specific, behavioral. " +
      "Example: 'Software Engineer turned Entrepreneur. I love building things and helping people. Very active on Twitter.'",
    ),
  summary: z
    .string()
    .max(2000)
    .describe(
      "About-section markdown paragraph. 3-6 sentences. MUST embed at least 2 in-portfolio " +
      "cross-section markdown links where natural, using these hrefs: " +
      "(/#education) (/#work) (/#projects) (/#hackathons) (/#skills). Example: " +
      "'At the end of 2022, I quit my job as a software engineer. In the past, " +
      "[I pursued a double degree](/#education) and [interned at big tech companies](/#work). " +
      "I also [competed in hackathons](/#hackathons) for fun.' Stay factual to the input — " +
      "do NOT invent years, companies, products, or metrics not present in the data.",
    ),
  initials: z
    .string()
    .min(1)
    .max(4)
    .describe("Avatar fallback initials, derived from name. 2 chars preferred, 1 or 3 allowed."),
});
export type PersonAgentOutput = z.infer<typeof PersonAgentOutputSchema>;

export interface PersonAgentInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  discover: DiscoverOutput;
  artifacts: Record<string, Artifact>;
  /** Titles of top featured projects (one-liners) — used for summary grounding. */
  featuredProjects: { title: string; summary: string }[];
  /** Work companies (recent-first) — used for summary grounding. */
  workCompanies: string[];
  /** Education schools (recent-first) — used for summary grounding. */
  educationSchools: string[];
  /** Evidence bag from DevEvidence research phase. */
  evidence?: EvidenceBag;
  onProgress?: (text: string) => void;
}

const SYSTEM_PROMPT = `You write the identity block for an engineering portfolio. Your job is to produce three pieces:

1. "name" — use the developer's GitHub profile name if present, otherwise their handle.

2. "description" (hero subtitle) — one line, 12-30 words. Specific and behavioral. It should tell a reader "who is this person" at a glance. Avoid generic filler like "full-stack developer passionate about technology". Reach for what makes THIS person distinctive (from the primary_shape + investigation_angles).

3. "summary" (About paragraph) — 3-6 sentences of markdown. This is the highest-quality prose on the page. It must:
   - Embed at least 2 cross-section markdown links. Use these exact hrefs: (/#education), (/#work), (/#projects), (/#hackathons), (/#skills). The linked phrase should be natural English, never the bare path.
   - Stay factual to the input data. Do not invent years, companies, product names, users, or metrics that aren't in the input.
   - Read like a person talking, not a LinkedIn bio. Contraction-friendly ("I'm", "I've"). No corporate-speak.
   - No closing call-to-action. No "feel free to reach out."

4. "initials" — 2-character uppercase initials from the name. "Dillion Verma" -> "DV". "yatendra2001" -> "Y2" or "YK" if first+last from name are known.

Weighting signal (IMPORTANT):
  A merged PR into a widely-used open-source repo (10k+ stars: facebook/react, rust-lang/rust, vercel/next.js, kubernetes/kubernetes, etc.) is a STRONGER signal than most solo side projects. If the input's "Notable drive-by contributions" section lists any such repos, it's almost always the single most interesting line for a recruiter or peer reader.
  - Describe drive-by contributions with the actual repo name ("shipped patches to rust-lang/rust") — not generic framing like "contributes to open source".
  - Count merged PRs, not opened. Weight by stars and ecosystem reach, not volume.
  - DO NOT invent the projects the user contributed to. Only cite what's in the input.

Rules:
- Do NOT cite anything not in the input.
- Do NOT use em-dash punchlines.
- Do NOT repeat the description inside the summary.
- When context_notes or user-provided socials hint at self-reported claims, treat them as LEADS, not confirmed facts. Don't state them as facts in the summary.

Call submit_person exactly once when you're done.`;

export async function runPersonAgent(
  input: PersonAgentInput,
): Promise<PersonAgentOutput> {
  const userMessage = buildInput(input);

  const { result } = await runAgentWithSubmit({
    // Use the same model the session picked — the caller decides
    // whether to push this to Opus for higher-quality prose.
    model: modelForRole("orchestrator"),
    systemPrompt: SYSTEM_PROMPT,
    input: userMessage,
    submitToolName: "submit_person",
    submitToolDescription:
      "Submit the person identity block (name, description, summary, initials). Call exactly once.",
    submitSchema: PersonAgentOutputSchema,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: "resume:person",
    onProgress: input.onProgress,
  });

  return result;
}

function buildInput(input: PersonAgentInput): string {
  const { github, session, discover, featuredProjects, workCompanies, educationSchools } = input;
  const lines: string[] = [];

  lines.push(`## Developer: @${session.handle}`);
  if (github.profile.name) lines.push(`Name: ${github.profile.name}`);
  if (github.profile.bio) lines.push(`GitHub bio: ${github.profile.bio}`);
  if (github.profile.location) lines.push(`Location: ${github.profile.location}`);
  lines.push("");

  lines.push(`## Discover verdict`);
  lines.push(`primary_shape: ${discover.primary_shape}`);
  lines.push(`distinctive: ${discover.distinctive_paragraph}`);
  lines.push("");

  if (featuredProjects.length > 0) {
    lines.push(`## Featured projects (reference for /#projects link)`);
    for (const p of featuredProjects.slice(0, 6)) {
      lines.push(`- ${p.title}: ${p.summary.slice(0, 140)}`);
    }
    lines.push("");
  }

  // Drive-by contributions — merged PRs into repos the user doesn't own.
  // Sorted by stars so the summary can lead with the strongest signal
  // (e.g. facebook/react, rust-lang/rust, vercel/next.js).
  const externalContributions = github.ownedRepos
    .filter((r) => r.relationship === "contributor" && !r.isPrivate)
    .map((r) => {
      const sig = r.contributionSignals ?? {};
      const prCount = Math.max(sig.prsMerged ?? 0, sig.prsOpened ?? 0);
      const commits = sig.commits ?? 0;
      return {
        fullName: r.fullName,
        stars: r.stargazerCount,
        prs: prCount,
        commits,
        score: r.stargazerCount * 10 + prCount * 5 + commits,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (externalContributions.length > 0) {
    lines.push(`## Notable drive-by contributions (sorted by reach)`);
    lines.push(
      `These are repos the developer does NOT own. A merged PR into any of the high-star entries is often the single strongest line in the About paragraph.`,
    );
    for (const c of externalContributions) {
      const parts: string[] = [`- ${c.fullName}`];
      if (c.stars > 0) parts.push(`${c.stars.toLocaleString()}★`);
      if (c.prs > 0) parts.push(`${c.prs} PR${c.prs === 1 ? "" : "s"}`);
      if (c.commits > 0) parts.push(`${c.commits} commits`);
      lines.push(parts.join(" — "));
    }
    lines.push("");
  }

  if (workCompanies.length > 0) {
    lines.push(`## Work companies (reference for /#work link) — recent first`);
    for (const c of workCompanies.slice(0, 6)) lines.push(`- ${c}`);
    lines.push("");
  }

  if (educationSchools.length > 0) {
    lines.push(`## Education (reference for /#education link) — recent first`);
    for (const s of educationSchools.slice(0, 4)) lines.push(`- ${s}`);
    lines.push("");
  }

  if (input.evidence && input.evidence.cards.length > 0) {
    lines.push(formatEvidenceBag(input.evidence, 12));
    lines.push("");
  }

  const s = session.socials;
  const socials: string[] = [];
  if (s.twitter) socials.push(`Twitter @${s.twitter}`);
  if (s.linkedin) socials.push(`LinkedIn ${s.linkedin}`);
  if (s.website) socials.push(`Website ${s.website}`);
  if (socials.length > 0) {
    lines.push(`## Socials`);
    for (const x of socials) lines.push(`- ${x}`);
    lines.push("");
  }

  if (session.context_notes) {
    lines.push(`## Context notes (treat as LEADS, not facts)`);
    lines.push(session.context_notes);
    lines.push("");
  }

  lines.push(`---`);
  lines.push(
    `Produce: name, one-line hero description, markdown summary with 2+ cross-section links, and 2-char initials. Then call submit_person.`,
  );

  return lines.join("\n");
}
