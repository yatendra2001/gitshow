/**
 * DevEvidence research phase — orchestrator-workers pattern.
 *
 * Runs AFTER `discover` and BEFORE the section agents. Its job is to
 * surface facts about the developer from the open web — interviews,
 * conference talks, podcast mentions, press coverage, HN threads,
 * Twitter announcements, personal blog posts — so downstream agents
 * (work, education, projects, person) write grounded prose instead of
 * hallucinating around thin GitHub signal.
 *
 * Flow (orchestrator-workers, per Anthropic's effective-agents playbook):
 *   1. ORCHESTRATOR (Opus): reads the discover output + profile + top
 *      featured projects and proposes N search queries with rationale.
 *   2. WORKERS (Kimi + TinyFish, parallel):
 *        - TinyFish search → top K URLs per query
 *        - TinyFish fetch → real-browser render of each URL
 *        - Kimi summarize → one EvidenceCard per URL
 *   3. AGGREGATE: dedupe by final URL, rank by confidence, cap.
 *
 * Graceful degradation: if TinyFish isn't configured (TINYFISH_API_KEY
 * missing), the whole phase short-circuits and returns an empty bag.
 * Downstream agents are robust to empty evidence.
 */

import * as z from "zod/v4";
import pLimit from "p-limit";
import { runAgentWithSubmit } from "../../agents/base.js";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { GitHubData } from "../../types.js";
import type { DiscoverOutput } from "../../schemas.js";
import { modelForRole } from "@gitshow/shared/models";
import {
  TinyFishClient,
  type TinyFishSearchResult,
} from "@gitshow/shared/cloud/tinyfish";

// ─── Schema (what the orchestrator produces) ──────────────────────────

// Cap at 5 queries so a single scan stays under TinyFish's free-tier
// 5-searches/minute ceiling. Tighter than the article's spirit (quality
// > quantity) but matches what we can afford to run without rate-limit
// errors.
const QueryPlanSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().min(3).max(200),
        why: z.string().min(5).max(300).describe(
          "One sentence: what this query is probing for (e.g. 'prior employment at Stripe', 'hackathon wins mentioned in press', 'podcast appearances').",
        ),
      }),
    )
    .min(2)
    .max(5),
});
type QueryPlan = z.infer<typeof QueryPlanSchema>;

// ─── Schema (what a worker produces for one URL) ──────────────────────

const EvidenceKindEnum = z.enum([
  "interview",
  "talk",
  "podcast",
  "press",
  "blog",
  "hn",
  "twitter",
  "bio",
  "other",
]);

const EvidenceCardSchema = z.object({
  sourceUrl: z.string().url(),
  siteName: z.string().max(120).optional(),
  title: z.string().max(240),
  kind: EvidenceKindEnum,
  summary: z
    .string()
    .min(20)
    .max(800)
    .describe(
      "2-3 dense sentences. Focus on FACTS specific to this developer: companies, dates, projects, numbers, claims. Strip site chrome and general commentary.",
    ),
  rawSnippet: z
    .string()
    .max(500)
    .optional()
    .describe("Verbatim quote if the page contains a quotable fact about the dev."),
  confidence: z.enum(["high", "medium", "low"]).describe(
    "high = explicitly names this GitHub handle or full name and says something specific; medium = same person is likely but not certain; low = ambiguous, might be a namesake.",
  ),
  notAboutThisPerson: z
    .boolean()
    .optional()
    .describe("Set true if the page is clearly a different person — we'll drop it."),
});

export type EvidenceCard = z.infer<typeof EvidenceCardSchema>;

export interface EvidenceBag {
  /** Number of queries the orchestrator proposed. */
  queriesPlanned: number;
  /** Number that actually ran (TinyFish succeeded). */
  queriesRun: number;
  /** Final evidence cards, ranked by confidence. */
  cards: EvidenceCard[];
  /** Non-fatal issues — for observability in scan_events. */
  warnings: string[];
}

export interface DevEvidenceInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  discover: DiscoverOutput | null;
  /** Full names of the top featured projects (e.g. "yatendra2001/gitshow"). */
  featuredFullNames: string[];
  /** Optional cap on fetched URLs (safety net). Default 12. */
  maxUrls?: number;
  onProgress?: (text: string) => void;
}

const DEFAULT_MAX_URLS = 10;
const PER_QUERY_TOP_K = 2;
const FETCH_CONCURRENCY = 3;
// TinyFish free tier = 5 searches/min. Space calls at least 13s apart
// so a single scan never trips the rate limit even if a second scan
// fires right after. Override via TINYFISH_SEARCH_INTERVAL_MS when
// running on a higher tier.
const DEFAULT_SEARCH_INTERVAL_MS = 13_000;
// Free tier = 25 fetches/min; we batch up to 10 per call, so two
// back-to-back batches (20 URLs) still fit. No per-batch delay needed
// as long as DEFAULT_MAX_URLS stays <= 10.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Build a DevEvidence bag. Returns an empty bag if TinyFish is not
 * configured or the orchestrator fails — pipeline must not block on it.
 */
export async function runDevEvidenceResearch(
  input: DevEvidenceInput,
): Promise<EvidenceBag> {
  const log = input.onProgress ?? (() => {});
  const tf = TinyFishClient.fromEnv();
  if (!tf) {
    log(`[dev-evidence] TINYFISH_API_KEY not set — skipping research phase.\n`);
    return { queriesPlanned: 0, queriesRun: 0, cards: [], warnings: ["tinyfish.disabled"] };
  }

  const maxUrls = input.maxUrls ?? DEFAULT_MAX_URLS;

  // ─── Phase 1: ORCHESTRATOR plans queries ────────────────────────
  let plan: QueryPlan;
  try {
    plan = await planQueries(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[dev-evidence] orchestrator failed: ${msg}\n`);
    return { queriesPlanned: 0, queriesRun: 0, cards: [], warnings: [`orchestrator.failed: ${msg}`] };
  }
  log(`[dev-evidence] orchestrator proposed ${plan.queries.length} queries\n`);

  // ─── Phase 2: WORKERS search + fetch + summarize ─────────────────
  const warnings: string[] = [];
  const candidates: Array<{ url: string; hint: TinyFishSearchResult; query: string }> = [];
  let queriesRun = 0;

  const searchIntervalMs = Number(
    process.env.TINYFISH_SEARCH_INTERVAL_MS ?? DEFAULT_SEARCH_INTERVAL_MS,
  );
  let lastSearchAt = 0;
  for (const q of plan.queries) {
    // Space searches out to respect TinyFish's free-tier rate limit.
    const wait = searchIntervalMs - (Date.now() - lastSearchAt);
    if (wait > 0 && lastSearchAt > 0) await sleep(wait);
    lastSearchAt = Date.now();

    const r = await tf.search(q.query, { location: "us", language: "en" });
    if (!r.ok) {
      warnings.push(`search.failed: ${q.query.slice(0, 40)} (${r.requestError ?? "unknown"})`);
      continue;
    }
    queriesRun++;
    const top = r.results.slice(0, PER_QUERY_TOP_K);
    for (const hit of top) {
      candidates.push({ url: hit.url, hint: hit, query: q.query });
    }
  }

  // Dedupe by URL — many queries surface the same page.
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
  const targets = unique.slice(0, maxUrls);
  log(
    `[dev-evidence] ${queriesRun}/${plan.queries.length} queries ok, ${candidates.length} hits, ${targets.length} unique URLs to fetch\n`,
  );

  if (targets.length === 0) {
    return {
      queriesPlanned: plan.queries.length,
      queriesRun,
      cards: [],
      warnings,
    };
  }

  // Fetch in batches of 10 (TinyFish max per request).
  const batches: Array<typeof targets> = [];
  for (let i = 0; i < targets.length; i += 10) batches.push(targets.slice(i, i + 10));

  const fetched: Array<{
    url: string;
    finalUrl?: string;
    title?: string;
    siteName?: string;
    text: string;
    hint: TinyFishSearchResult;
  }> = [];
  for (const batch of batches) {
    const resp = await tf.fetchUrls(
      batch.map((b) => b.url),
      { format: "markdown" },
    );
    if (!resp.ok) {
      warnings.push(`fetch.batch.failed: ${resp.requestError ?? "unknown"}`);
      continue;
    }
    for (const r of resp.results) {
      const match = batch.find((b) => b.url === r.url);
      if (!match) continue;
      if (!r.text || r.text.length < 200) {
        warnings.push(`fetch.empty: ${r.url}`);
        continue;
      }
      fetched.push({
        url: r.url,
        finalUrl: r.finalUrl,
        title: r.title,
        siteName: match.hint.siteName,
        text: r.text,
        hint: match.hint,
      });
    }
    for (const e of resp.errors) {
      warnings.push(`fetch.error: ${e.url.slice(0, 60)} (${e.error})`);
    }
  }
  log(`[dev-evidence] fetched ${fetched.length} / ${targets.length} pages\n`);

  // Summarize each fetched page in parallel — bulk-tier model.
  const limit = pLimit(FETCH_CONCURRENCY);
  const summarized = await Promise.all(
    fetched.map((f) =>
      limit(() => summarizePage(input, f).catch((err) => {
        warnings.push(`summarize.failed: ${f.url.slice(0, 60)} (${err instanceof Error ? err.message : String(err)})`);
        return null;
      })),
    ),
  );

  const cards = summarized
    .filter((c): c is EvidenceCard => c !== null && !c.notAboutThisPerson)
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));

  log(`[dev-evidence] produced ${cards.length} evidence cards\n`);

  return {
    queriesPlanned: plan.queries.length,
    queriesRun,
    cards,
    warnings,
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────

const ORCHESTRATOR_PROMPT = `You plan web searches to find FACTS about a software developer for a portfolio generator.

Your job is to output a set of queries that, when executed, will surface the most valuable evidence: employment history, notable project mentions, press coverage, talks, podcasts, interviews, hackathon wins, HN/Twitter threads about their work. The goal is to find things the developer might not even remember — surface receipts we can quote in their portfolio.

You'll receive:
  - the developer's GitHub handle, full name, bio
  - a "distinctive" paragraph and "primary_shape" hint from an earlier analysis stage
  - the names of their featured projects
  - any company / school / handle mentions extracted from intake answers

Guidelines:
  - Each query should probe a specific thread. Not "John Smith GitHub" — "Jane Doe Stripe payment protocol 2023" or "ai_buddy Flutter Awesome featured".
  - Mix approaches: site-scoped (e.g. site:news.ycombinator.com <project>), name+company, project+launch, "interview with <name>", podcast patterns.
  - Avoid duplicates and near-duplicates.
  - Output 4-5 queries. We pay per search; be deliberate. Quality over quantity.

Each query MUST include a short "why" — what thread you're pulling on.

Call submit_query_plan exactly once.`;

async function planQueries(input: DevEvidenceInput): Promise<QueryPlan> {
  const lines: string[] = [];
  const profile = input.github.profile;
  lines.push(`GitHub handle: ${input.session.handle}`);
  if (profile.name) lines.push(`Full name: ${profile.name}`);
  if (profile.bio) lines.push(`Bio: ${profile.bio}`);
  if (profile.location) lines.push(`Location: ${profile.location}`);
  if (input.session.socials.linkedin) lines.push(`LinkedIn: ${input.session.socials.linkedin}`);
  if (input.session.socials.twitter) lines.push(`Twitter: ${input.session.socials.twitter}`);
  if (input.session.socials.website) lines.push(`Website: ${input.session.socials.website}`);
  lines.push("");

  if (input.discover) {
    lines.push("## Distinctive summary");
    lines.push(input.discover.distinctive_paragraph);
    lines.push("");
    if (input.discover.primary_shape) {
      lines.push(`Primary shape: ${input.discover.primary_shape}`);
      lines.push("");
    }
    if (input.discover.investigation_angles && input.discover.investigation_angles.length > 0) {
      lines.push("## Investigation angles (from discover stage)");
      for (const angle of input.discover.investigation_angles.slice(0, 10)) {
        lines.push(`- ${angle}`);
      }
      lines.push("");
    }
  }

  if (input.featuredFullNames.length > 0) {
    lines.push("## Featured projects (full names)");
    for (const fn of input.featuredFullNames.slice(0, 10)) lines.push(`- ${fn}`);
    lines.push("");
  }

  if (input.session.context_notes && input.session.context_notes.trim().length > 0) {
    lines.push("## User intake answers");
    lines.push(input.session.context_notes.slice(0, 2000));
    lines.push("");
  }

  lines.push("---");
  lines.push("Produce submit_query_plan now.");

  const { result } = await runAgentWithSubmit({
    model: modelForRole("orchestrator"),
    systemPrompt: ORCHESTRATOR_PROMPT,
    input: lines.join("\n"),
    submitToolName: "submit_query_plan",
    submitToolDescription: "Submit the planned web search queries.",
    submitSchema: QueryPlanSchema,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: "dev-evidence:plan",
    onProgress: input.onProgress,
  });
  return result;
}

// ─── Worker (summarize one fetched page) ─────────────────────────────

const SUMMARIZE_PROMPT = `You read a web page and extract any FACTS it contains about a specific software developer.

You'll receive:
  - the developer's handle, full name, and short bio (for ambiguity checks)
  - a page URL, title, and the page's clean markdown text
  - the search query that surfaced this page

Your task: produce ONE EvidenceCard. Rules:
  - summary: 2-3 dense sentences of what THIS page says about THIS developer. Names, dates, companies, project metrics, quotes. Strip site chrome.
  - kind: pick the best bucket (interview, talk, podcast, press, blog, hn, twitter, bio, other).
  - confidence:
      high = page explicitly names this GitHub handle / full name AND says something specific about them
      medium = probably this person but not explicit
      low = might be a namesake / unclear
  - notAboutThisPerson=true if the page is clearly a different human. We'll drop it.
  - rawSnippet: verbatim quote if there's a quotable specific fact (<= 280 chars).

If the page has no useful facts, submit a card with confidence=low and summary="No specific facts about this developer."

Call submit_evidence exactly once.`;

async function summarizePage(
  input: DevEvidenceInput,
  page: {
    url: string;
    finalUrl?: string;
    title?: string;
    siteName?: string;
    text: string;
    hint: TinyFishSearchResult;
  },
): Promise<EvidenceCard> {
  const profile = input.github.profile;
  const lines = [
    `Developer handle: @${input.session.handle}`,
    profile.name ? `Full name: ${profile.name}` : "",
    profile.bio ? `Bio: ${profile.bio}` : "",
    "",
    `URL: ${page.finalUrl ?? page.url}`,
    `Site: ${page.siteName ?? "(unknown)"}`,
    `Title: ${page.title ?? "(untitled)"}`,
    `Surfaced by query: "${page.hint.title}"`,
    "",
    "── Page content (markdown) ──",
    page.text.slice(0, 18_000),
  ]
    .filter(Boolean)
    .join("\n");

  const { result } = await runAgentWithSubmit({
    model: modelForRole("bulk"),
    systemPrompt: SUMMARIZE_PROMPT,
    input: lines,
    submitToolName: "submit_evidence",
    submitToolDescription: "Submit the EvidenceCard for this URL.",
    submitSchema: EvidenceCardSchema,
    reasoning: { effort: "medium" },
    session: input.session,
    usage: input.usage,
    label: "dev-evidence:summarize",
    onProgress: input.onProgress,
  });

  // Force the URL to the final URL we actually fetched (models sometimes
  // paraphrase the URL).
  return {
    ...result,
    sourceUrl: page.finalUrl ?? page.url,
    siteName: result.siteName ?? page.siteName,
  };
}

function confidenceRank(c: EvidenceCard["confidence"]): number {
  return c === "high" ? 2 : c === "medium" ? 1 : 0;
}

/**
 * Render an evidence bag as a compact markdown block downstream agents
 * can drop into their LLM input. Keeps formatting stable so prompt
 * caching works.
 */
export function formatEvidenceBag(bag: EvidenceBag, maxCards = 15): string {
  if (bag.cards.length === 0) {
    return "## Web evidence\n(No external evidence collected for this run.)\n";
  }
  const lines: string[] = [];
  lines.push("## Web evidence");
  lines.push(
    `(Collected from ${bag.queriesRun} web searches; ${bag.cards.length} cards, ranked by confidence.)`,
  );
  lines.push("");
  for (const c of bag.cards.slice(0, maxCards)) {
    lines.push(`### [${c.kind}] ${c.title}`);
    lines.push(`source: ${c.sourceUrl}`);
    lines.push(`confidence: ${c.confidence}`);
    lines.push(c.summary);
    if (c.rawSnippet) lines.push(`> ${c.rawSnippet}`);
    lines.push("");
  }
  return lines.join("\n");
}
