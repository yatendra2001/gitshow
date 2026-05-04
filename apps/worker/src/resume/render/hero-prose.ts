/**
 * Hero prose — single Opus call that turns the KG into the
 * description (one-liner) + summary (About paragraph). Per §9.2 of the
 * plan, this is bounded input + grounded output: every claim in the
 * prose must map to a fact we hand the model.
 *
 * Output is purely textual; the rest of the Resume is a deterministic
 * projection of the KG (see render-from-kg.ts).
 */

import * as z from "zod/v4";
import { runAgentWithSubmit, type AgentEventEmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import type {
  KnowledgeGraph,
  Edge,
  Project as KgProject,
} from "@gitshow/shared/kg";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";

export const HeroProseSchema = z.object({
  description: z
    .string()
    .min(8)
    .max(160)
    .describe(
      "One short line shown under the hero heading. 6-18 words. " +
        "Lead with the strongest signal (current role, breakout project, OSS contribution). " +
        "Plain English. No 'passionate', 'results-driven', or LinkedIn-speak.",
    ),
  summary: z
    .string()
    .min(20)
    .max(360)
    .describe(
      "About paragraph, 1-3 SHORT sentences of markdown. Default to terse. " +
        "Match the voice the person uses in their own bio. Inline links to other " +
        "sections (/#projects, /#work, etc.) are OK if natural, never required. " +
        "Stay factual: do NOT invent companies, dates, products, or metrics not in the input facts.",
    ),
});
export type HeroProse = z.infer<typeof HeroProseSchema>;

export interface HeroProseInput {
  session: ScanSession;
  usage: SessionUsage;
  kg: KnowledgeGraph;
  /**
   * Optional grounded "what does the world know about this person"
   * report from the person-report stage. When supplied, hero-prose
   * uses it as additional context — every claim still has to map to
   * either a KG fact or this report.
   */
  personReportMarkdown?: string;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
  /** Optional structured emit (reasoning + tool events). */
  emit?: AgentEventEmit;
}

const SYSTEM_PROMPT = `You write the identity block on a developer's portfolio. Two pieces.

The portfolio voice is TERSE, PLAIN, and PERSONAL. Each profile should sound like a different person — not a template. Match the voice the person uses in their own bio / external signal report. If they're playful, be playful. If they're dry, be dry. Default to short.

Hard bans across both fields: "passionate", "results-driven", "love building", "journey", "I had the opportunity", "feel free to reach out", em-dash punchlines, closing CTAs.

1. "description" — ONE short line. 6-18 words. Lead with the strongest signal: current role + what they're building, OR a breakout project, OR a notable OSS contribution. Examples (variety on purpose):

   "Founding engineer at Flightcast, building a video-first podcast platform."
   "Distributed-systems engineer at Stripe. Rust and Go."
   "Open-source maintainer (10k+ stars on tldraw); ex-Vercel."
   "PhD candidate at MIT; lower bounds for streaming algorithms."
   "Student at Waterloo. Ships side projects in TypeScript."

2. "summary" — About section. 1-3 SHORT sentences of markdown. Each sentence stands alone. Default to terse. Examples (variety on purpose):

   Founder voice:
     "I build and ship AI-powered products. Started coding at 15 (Turbo C++), never stopped."

   IC voice:
     "I write Rust at Stripe. Mostly distributed systems and weird performance bugs."

   Researcher voice:
     "PhD candidate working on lower bounds for streaming algorithms. Previously at Google Brain."

   OSS / student voice:
     "I build small things. Shipped my first app at 15, been compounding since."

   Pivoter:
     "Designer turned engineer. Now building AI tools full-time after eight years at Figma."

Rules for "summary":
  - 1-3 sentences. Hard cap. NEVER a paragraph.
  - Concrete hook (a project, a stack, a year, a place, a number). No abstract claims.
  - First or third person — match how the person's own bio reads.
  - Inline links to other sections (/#projects, /#work, /#hackathons, /#skills, /#publications, /#education) are FINE if they fall naturally into the prose, but never force them.
  - Don't repeat the description inside the summary.
  - Stay strictly factual. No invented years, companies, products, users, or metrics.

Weighting (what to lead with):
  - A high-band WORKED_AT at a recognised company is strong signal — name the company.
  - A merged contribution to a 10k+ star OSS repo (react, rust, next.js, kubernetes, etc.) is often the single most interesting line — name the repo.
  - A featured Project tagged "shipped" outranks an "experiment".
  - WON edges (hackathons / awards) are great hooks.

Call submit_hero_prose exactly once.`;

const MAX_FACTS = 12;
const MAX_PROJECTS = 4;

export async function generateHeroProse(input: HeroProseInput): Promise<HeroProse> {
  const userInput = buildInput(input.kg, input.personReportMarkdown);
  const t0 = Date.now();

  try {
    const { result } = await runAgentWithSubmit({
      model: modelForRole("orchestrator"),
      systemPrompt: SYSTEM_PROMPT,
      input: userInput,
      submitToolName: "submit_hero_prose",
      submitToolDescription:
        "Submit the hero description + About summary. Call exactly once.",
      submitSchema: HeroProseSchema,
      reasoning: { effort: "high" },
      session: input.session,
      usage: input.usage,
      label: "render:hero-prose",
      onProgress: input.onProgress,
      trace: input.trace,
      emit: input.emit,
    });

    input.trace?.renderHeroProseCall({
      label: "render.hero-prose",
      model: modelForRole("orchestrator"),
      durationMs: Date.now() - t0,
      linksEmbedded: countCrossLinks(result.summary),
      ok: true,
    });
    return result;
  } catch (err) {
    input.trace?.renderHeroProseCall({
      label: "render.hero-prose",
      model: modelForRole("orchestrator"),
      durationMs: Date.now() - t0,
      linksEmbedded: 0,
      ok: false,
    });
    return fallbackProse(input.kg, err as Error);
  }
}

function buildInput(kg: KnowledgeGraph, personReport?: string): string {
  const person = kg.entities.persons[0];
  const lines: string[] = [];

  if (personReport && personReport.trim().length > 0) {
    lines.push(`## External signal report (Gemini grounded)`);
    lines.push(
      `Use this as context for the description and About paragraph.`,
    );
    lines.push(
      `It is grounded in real URLs — you may reference its claims, but`,
    );
    lines.push(
      `do NOT add anything that's not in this report or the structured`,
    );
    lines.push(`facts below.`);
    lines.push("");
    lines.push(personReport.slice(0, 4000));
    lines.push("");
  }

  lines.push(`## Person`);
  lines.push(`handle: ${person?.handle ?? "(unknown)"}`);
  if (person?.name) lines.push(`name: ${person.name}`);
  if (person?.location) lines.push(`location: ${person.location}`);
  if (person?.bio) lines.push(`bio: ${person.bio.slice(0, 280)}`);
  lines.push("");

  // Top facts — verified+likely edges in priority order.
  const topFacts = pickTopFacts(kg);
  if (topFacts.length > 0) {
    lines.push(`## Top facts (verified or likely; max ${MAX_FACTS})`);
    for (const fact of topFacts) lines.push(`- ${fact}`);
    lines.push("");
  }

  const projects = pickFeaturedProjects(kg);
  if (projects.length > 0) {
    lines.push(`## Top featured projects (max ${MAX_PROJECTS})`);
    for (const p of projects) {
      const polish = p.polish ? ` (${p.polish})` : "";
      lines.push(`- ${p.title}${polish}: ${p.purpose.slice(0, 200)}`);
    }
    lines.push("");
  }

  const won = kg.edges.filter((e) => e.type === "WON" && bandOk(e.band));
  if (won.length > 0) {
    lines.push(`## Wins (Achievements)`);
    for (const e of won.slice(0, 5)) {
      const a = kg.entities.achievements.find((x) => x.id === e.to);
      if (!a) continue;
      lines.push(`- ${a.title}${a.date ? ` (${a.date})` : ""}`);
    }
    lines.push("");
  }

  const externalContribs = collectExternalContributions(kg);
  if (externalContribs.length > 0) {
    lines.push(`## Notable open-source contributions (sorted by reach)`);
    lines.push(
      `Repos the developer does NOT own. A merged PR into a high-star entry is often the single strongest line in the About paragraph.`,
    );
    for (const c of externalContribs.slice(0, 6)) {
      lines.push(`- ${c.fullName} (${c.stars}★)${c.prs ? `, ${c.prs} PRs` : ""}`);
    }
    lines.push("");
  }

  lines.push(`## Section anchors you may link to`);
  lines.push(`/#work, /#education, /#projects, /#hackathons, /#skills, /#publications`);

  return lines.join("\n");
}

function pickTopFacts(kg: KnowledgeGraph): string[] {
  const facts: string[] = [];

  const work = kg.edges
    .filter((e) => e.type === "WORKED_AT" && bandOk(e.band))
    .sort(byRecency);
  for (const e of work.slice(0, 5)) {
    const co = kg.entities.companies.find((c) => c.id === e.to);
    if (!co) continue;
    const start = e.attrs.start ?? "";
    const end = e.attrs.end ?? (e.attrs.present ? "Present" : "");
    facts.push(
      `WORKED_AT: ${e.attrs.role ?? ""} at ${co.canonicalName}${
        start || end ? ` (${start}${end ? " – " + end : ""})` : ""
      } [band=${e.band}]`,
    );
  }

  const edu = kg.edges
    .filter((e) => e.type === "STUDIED_AT" && bandOk(e.band))
    .sort(byRecency);
  for (const e of edu.slice(0, 3)) {
    const sc = kg.entities.schools.find((s) => s.id === e.to);
    if (!sc) continue;
    facts.push(
      `STUDIED_AT: ${e.attrs.degree ?? "Degree"} at ${sc.canonicalName}${
        e.attrs.start ? ` (${e.attrs.start} – ${e.attrs.end ?? "present"})` : ""
      } [band=${e.band}]`,
    );
  }

  return facts.slice(0, MAX_FACTS);
}

function pickFeaturedProjects(kg: KnowledgeGraph): KgProject[] {
  return kg.entities.projects
    .filter((p) => p.shouldFeature)
    .sort((a, b) => polishWeight(b.polish) - polishWeight(a.polish))
    .slice(0, MAX_PROJECTS);
}

function collectExternalContributions(
  kg: KnowledgeGraph,
): Array<{ fullName: string; stars: number; prs: number }> {
  const out: Array<{ fullName: string; stars: number; prs: number }> = [];
  for (const e of kg.edges) {
    if (e.type !== "CONTRIBUTED_TO") continue;
    const repo = kg.entities.repositories.find((r) => r.id === e.to);
    if (!repo) continue;
    if (repo.stars < 50) continue;
    const prs = Number(e.attrs.prs ?? 0);
    out.push({ fullName: repo.fullName, stars: repo.stars, prs });
  }
  out.sort((a, b) => b.stars * 10 + b.prs - (a.stars * 10 + a.prs));
  return out;
}

function bandOk(band: string): boolean {
  return band === "verified" || band === "likely";
}

function byRecency(a: Edge, b: Edge): number {
  const aPresent = Boolean(a.attrs.present);
  const bPresent = Boolean(b.attrs.present);
  if (aPresent && !bPresent) return -1;
  if (bPresent && !aPresent) return 1;
  const aYear = parseYear(String(a.attrs.end ?? a.attrs.start ?? ""));
  const bYear = parseYear(String(b.attrs.end ?? b.attrs.start ?? ""));
  return bYear - aYear;
}

function parseYear(s: string): number {
  const m = s.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : 0;
}

function polishWeight(p: string): number {
  switch (p) {
    case "shipped":
      return 5;
    case "working":
      return 3;
    case "wip":
      return 1;
    default:
      return 0;
  }
}

function countCrossLinks(s: string): number {
  const re = /\[[^\]]+\]\(\/#(work|education|projects|hackathons|skills|publications)\)/g;
  return (s.match(re) ?? []).length;
}

function fallbackProse(kg: KnowledgeGraph, err: Error): HeroProse {
  const person = kg.entities.persons[0];
  const handle = person?.handle ?? "developer";
  const projects = kg.entities.projects.filter((p) => p.shouldFeature);
  const featuredCount = projects.length;
  const description =
    person?.bio?.slice(0, 200) ??
    `Builder on GitHub as @${handle}. ${featuredCount} featured project${featuredCount === 1 ? "" : "s"}.`;
  const summary = [
    `I'm @${handle}.`,
    featuredCount > 0
      ? `I've shipped a few [projects](/#projects) — see the project grid for details.`
      : `My [build log](/#projects) catalogues things I've shipped on GitHub.`,
    `(Hero prose generation failed: ${err.message.slice(0, 120)} — using a deterministic fallback.)`,
  ].join(" ");
  return { description: clip(description, 220), summary: clip(summary, 1800) };
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

