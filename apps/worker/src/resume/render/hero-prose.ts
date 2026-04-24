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
import { runAgentWithSubmit } from "../../agents/base.js";
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
    .max(220)
    .describe(
      "One-line bio shown under the hero heading. 12-30 words. Specific, behavioral. " +
        "Avoid generic filler — describe what makes THIS developer distinctive.",
    ),
  summary: z
    .string()
    .min(40)
    .max(2000)
    .describe(
      "About-section markdown paragraph, 3-6 sentences. MUST embed at least 2 in-portfolio " +
        "cross-section links using these hrefs: (/#education) (/#work) (/#projects) (/#hackathons) (/#skills) (/#publications). " +
        "Stay factual: do NOT invent companies, dates, products, or metrics not present in the input facts.",
    ),
});
export type HeroProse = z.infer<typeof HeroProseSchema>;

export interface HeroProseInput {
  session: ScanSession;
  usage: SessionUsage;
  kg: KnowledgeGraph;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
}

const SYSTEM_PROMPT = `You write the identity block for an engineering portfolio. You produce exactly two pieces:

1. "description" — one line, 12-30 words. Specific and behavioral. Tell a reader at a glance who this person is. Avoid filler like "passionate full-stack developer". Lead with the strongest signal in the input.

2. "summary" — an About paragraph, 3-6 sentences of markdown. Rules:
   - MUST embed at least 2 cross-section markdown links using exactly these hrefs: (/#education), (/#work), (/#projects), (/#hackathons), (/#skills), (/#publications). The linked phrase should be natural English ("I [studied at MIT](/#education)"), never the bare path.
   - Stay factual to the input. Do NOT invent years, companies, product names, users, or metrics that aren't in the input facts.
   - Read like a person talking, not a LinkedIn bio. Contractions OK. No corporate-speak.
   - No closing call-to-action. No "feel free to reach out."
   - Don't repeat the description inside the summary.
   - No em-dash punchlines.

Weighting:
  - A high-band WORKED_AT at a recognised company is strong signal.
  - A merged contribution to a widely-used OSS repo (10k+ stars: facebook/react, rust-lang/rust, vercel/next.js, kubernetes/kubernetes, etc.) is often the single most interesting line — name the repo.
  - A featured Project tagged "shipped" outranks an "experiment" of the same shape.
  - WON edges (hackathons / awards) are great hooks if present.

Call submit_hero_prose exactly once.`;

const MAX_FACTS = 12;
const MAX_PROJECTS = 4;

export async function generateHeroProse(input: HeroProseInput): Promise<HeroProse> {
  const userInput = buildInput(input.kg);
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

function buildInput(kg: KnowledgeGraph): string {
  const person = kg.entities.persons[0];
  const lines: string[] = [];

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

