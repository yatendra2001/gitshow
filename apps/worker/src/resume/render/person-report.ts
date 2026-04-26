/**
 * KG-level grounded person report — runs after KG merge, before hero-prose.
 *
 * Single Gemini grounded call with all known social URLs + canonical
 * name + employer history. Gemini reads what the world says about
 * this person and produces a multi-paragraph markdown report.
 *
 * The report flows into hero-prose as additional context so the
 * About paragraph can reference real-world signal that's NOT in our
 * KG: press, podcasts, conference talks, tweets that went big, etc.
 *
 * Anti-hallucination contract is enforced by the grounded client —
 * Gemini returns NO_INFO_FOUND when there's nothing to say. We never
 * fabricate.
 */

import { callGroundedGemini } from "@gitshow/shared/cloud/gemini-grounded";
import type { KnowledgeGraph } from "@gitshow/shared/kg";
import type { ScanSession } from "../../schemas.js";
import type { ScanTrace } from "../observability/trace.js";

export interface PersonReport {
  /**
   * Multi-paragraph markdown describing what's externally known about
   * this person. Empty string when Gemini found nothing.
   */
  reportMarkdown: string;
  /** True when Gemini returned NO_INFO_FOUND. */
  noInfoFound: boolean;
  /** URLs Gemini cited (from grounding metadata). */
  sources: Array<{ url: string; title?: string }>;
  durationMs: number;
  attempts: number;
}

const SYSTEM_PROMPT = `You are writing a comprehensive "what does the world know about this
developer" report. The output flows into a portfolio's hero About
paragraph as context — the more accurate, surprising, and specific
the report, the better the eventual About copy.

You will receive: the developer's name, GitHub handle, and a list of
known URLs (LinkedIn, personal site, X, YouTube, blog, etc.) plus
their employer history pulled from a structured profile graph.

Your job:
1. Read the URLs via your URL context tool.
2. Use Google Search to find press coverage, conference talks,
   podcast appearances, viral tweets, OSS contributions cited
   externally, books / papers / patents, and similar third-party
   signal.
3. Distinguish this person from same-name homonyms — anchor every
   fact to one of the provided URLs or to context that uniquely
   matches the supplied bio.

Output — markdown with these sections (omit a section if you have
nothing concrete for it):

## TL;DR
2-3 sentences. The strongest claim first — what makes this developer
distinctive based on what the world says about them.

## External signal
Bullet list of specific external mentions. For each:
- [Title or claim](URL) — source / venue / date if available.
Only include items you cite via URL. NEVER fabricate URLs.

## Notable context
Short prose paragraph (3-5 sentences) blending what you found into a
narrative. Reference specific projects, employers, or contributions
where they connect external signal to concrete work.

## Same-name caveat
One sentence noting any name-collision risks you noticed
(e.g. "There is also a researcher in pharmacology named X — those
papers are NOT this person").

Hard rules:
- If the URLs and search produce nothing beyond the GitHub profile
  page itself, return EXACTLY: NO_INFO_FOUND
- Never invent press coverage, podcasts, talks, or citations.
- Never claim someone else's work.
- Quote the source URL for every external claim.
- Keep the entire report under 1500 words.`;

export interface PersonReportInput {
  kg: KnowledgeGraph;
  session: ScanSession;
  trace?: ScanTrace;
  log?: (s: string) => void;
}

export async function generatePersonReport(
  input: PersonReportInput,
): Promise<PersonReport> {
  const { kg, session, trace, log = () => {} } = input;
  const person = kg.entities.persons[0];
  const name = person?.name ?? session.handle;
  const handle = session.handle;

  const urls = collectGroundingUrls(kg, session);
  const employers = collectEmployers(kg);
  const schools = collectSchools(kg);
  const projectHints = collectFeaturedProjectTitles(kg);

  const userPrompt = [
    `Developer: ${name}`,
    `GitHub handle: @${handle}`,
    person?.location ? `Location: ${person.location}` : "",
    person?.bio ? `Self-bio: ${person.bio.slice(0, 400)}` : "",
    "",
    employers.length > 0
      ? `Known employers (most recent first): ${employers.join("; ")}`
      : "",
    schools.length > 0 ? `Known schools: ${schools.join("; ")}` : "",
    projectHints.length > 0
      ? `Featured projects: ${projectHints.join("; ")}`
      : "",
    "",
    "Investigate this developer per the system prompt. Read the URLs",
    "first, then search for external signal. Produce the markdown report.",
  ]
    .filter(Boolean)
    .join("\n");

  const t0 = Date.now();
  try {
    const result = await callGroundedGemini({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      urls,
      effort: "high",
      label: "person-report",
    });

    if (result.noInfoFound) {
      trace?.note(
        "person-report:no-info",
        "Gemini grounded person report returned NO_INFO_FOUND — proceeding without external signal",
        { attempts: result.attempts, durationMs: result.durationMs },
      );
      log(`[person-report] NO_INFO_FOUND (${result.attempts} attempts, ${result.durationMs}ms)\n`);
      return {
        reportMarkdown: "",
        noInfoFound: true,
        sources: [],
        durationMs: result.durationMs,
        attempts: result.attempts,
      };
    }

    trace?.note(
      "person-report:summary",
      `${result.text.length} chars, ${result.sources.length} citations, ${result.attempts} attempts`,
      {
        chars: result.text.length,
        citations: result.sources.length,
        attempts: result.attempts,
        durationMs: result.durationMs,
      },
    );
    log(
      `[person-report] ${result.text.length} chars, ${result.sources.length} citations\n`,
    );
    return {
      reportMarkdown: result.text,
      noInfoFound: false,
      sources: result.sources,
      durationMs: result.durationMs,
      attempts: result.attempts,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    trace?.note(
      "person-report:error",
      `Gemini grounded person report failed after retries: ${msg.slice(0, 240)}`,
      { error: msg, durationMs: Date.now() - t0 },
    );
    log(`[person-report] FAILED: ${msg.slice(0, 200)}\n`);
    return {
      reportMarkdown: "",
      noInfoFound: false,
      sources: [],
      durationMs: Date.now() - t0,
      attempts: 0,
    };
  }
}

function collectGroundingUrls(kg: KnowledgeGraph, session: ScanSession): string[] {
  const urls = new Set<string>();
  urls.add(`https://github.com/${session.handle}`);
  if (session.socials.linkedin) urls.add(session.socials.linkedin);
  if (session.socials.website) urls.add(session.socials.website);
  if (session.socials.youtube) urls.add(session.socials.youtube);
  if (session.socials.twitter) urls.add(session.socials.twitter);
  if (session.socials.stackoverflow) urls.add(session.socials.stackoverflow);
  if (session.socials.orcid) urls.add(session.socials.orcid);
  const person = kg.entities.persons[0];
  if (person?.url) urls.add(person.url);
  return Array.from(urls);
}

function collectEmployers(kg: KnowledgeGraph): string[] {
  const out: string[] = [];
  const work = kg.edges
    .filter((e) => e.type === "WORKED_AT")
    .sort((a, b) => {
      const ay = yearOf(String(a.attrs.end ?? a.attrs.start ?? ""));
      const by = yearOf(String(b.attrs.end ?? b.attrs.start ?? ""));
      return by - ay;
    });
  for (const e of work.slice(0, 6)) {
    const co = kg.entities.companies.find((c) => c.id === e.to);
    if (!co) continue;
    const role = (e.attrs.role ?? "") as string;
    out.push(role ? `${role} at ${co.canonicalName}` : co.canonicalName);
  }
  return out;
}

function collectSchools(kg: KnowledgeGraph): string[] {
  const out: string[] = [];
  for (const e of kg.edges) {
    if (e.type !== "STUDIED_AT") continue;
    const sc = kg.entities.schools.find((s) => s.id === e.to);
    if (!sc) continue;
    const degree = (e.attrs.degree ?? "") as string;
    out.push(degree ? `${degree} at ${sc.canonicalName}` : sc.canonicalName);
  }
  return out.slice(0, 4);
}

function collectFeaturedProjectTitles(kg: KnowledgeGraph): string[] {
  return kg.entities.projects
    .filter((p) => p.shouldFeature)
    .slice(0, 6)
    .map((p) => p.title);
}

function yearOf(s: string): number {
  const m = s.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : 0;
}
