/**
 * personal-site fetcher — scrapes the user's personal website / portfolio.
 *
 * TinyFish first (real-browser render for SPA sites), then Jina Reader as
 * fallback. A Kimi extraction produces bio, location, current role (often
 * prominently listed "Founding Engineer at X"), and project list.
 *
 * Facts emitted:
 *   - PERSON (bio, location)
 *   - WORKED_AT (with present: true when the site describes a current role)
 *   - BUILT (projects listed on the site)
 */

import * as z from "zod/v4";
import { runAgentWithSubmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import { TinyFishClient } from "@gitshow/shared/cloud/tinyfish";
import { makeSource } from "@gitshow/shared/kg";
import type { TypedFact } from "@gitshow/shared/kg";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";
import { emitFactsToTrace } from "./linkedin-public.js";

export interface FetcherInput {
  session: ScanSession;
  usage: SessionUsage;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
}

const JINA_TIMEOUT_MS = 30_000;
const USER_AGENT = "GitShow/0.2 (+https://github.com/yatendrakumar/gitshow)";

const PersonalSiteExtractionSchema = z.object({
  bio: z.string().max(1200).optional(),
  location: z.string().max(200).optional(),
  positions: z
    .array(
      z.object({
        company: z.string().max(200),
        title: z.string().max(200),
        start: z.string().max(40).optional(),
        end: z.string().max(40).optional(),
        present: z.boolean().optional(),
        description: z.string().max(1500).optional(),
      }),
    )
    .max(15),
  projects: z
    .array(
      z.object({
        title: z.string().max(200),
        purpose: z.string().max(500),
        url: z.string().max(500).optional(),
      }),
    )
    .max(30),
});
type PersonalSiteExtraction = z.infer<typeof PersonalSiteExtractionSchema>;

const SYSTEM_PROMPT = `You extract a person's structured profile from their personal website.

Return:
- bio: 1-3 sentence "about me" statement. Prefer verbatim prose. Leave undefined if the site is a bare link tree.
- location: city/region string if present.
- positions: current + past jobs mentioned. Set present=true for current roles. Description verbatim, short.
- projects: side projects / products listed on the site. "purpose" is the one-line honest description.

Rules:
- Extract ONLY what's stated. Never invent companies or projects.
- Strip nav/footer chrome. Skip "subscribe", "contact" and pure social-link sections.
- If it's clearly someone else's site, return empty arrays.

Call submit_personal_site exactly once.`;

export async function runPersonalSiteFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const label = "personal-site";
  const t0 = Date.now();
  const url = input.session.socials.website;
  const log = input.onProgress ?? (() => {});
  const trace = input.trace;

  trace?.fetcherStart({ label, input: { url, hasUrl: !!url } });

  if (!url) {
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  try {
    const text = await fetchText(url, { trace, log });
    if (!text || text.length < 300) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    const { result } = await runAgentWithSubmit({
      // Personal-site extraction is text-heavy and structured —
      // standard `bulk` (Kimi K2.6) territory. We saw an isolated
      // empty-positions flake in one earlier scan, but that's better
      // addressed by the new Sonnet-driven project ranker that runs
      // over EVERY judged repo than by upgrading every single fetcher
      // to a frontier model.
      model: modelForRole("bulk"),
      systemPrompt: SYSTEM_PROMPT,
      input: `## Source URL\n${url}\n\n## Rendered text\n\n${text.slice(0, 40_000)}\n\n---\nExtract bio, location, positions, projects. Call submit_personal_site.`,
      submitToolName: "submit_personal_site",
      submitToolDescription:
        "Submit extracted profile data. Call exactly once.",
      submitSchema: PersonalSiteExtractionSchema,
      reasoning: { effort: "low" },
      session: input.session,
      usage: input.usage,
      label: "fetcher:personal-site",
      onProgress: log,
      trace,
    });

    // Self-link verification: does the page link back to the user's
    // GitHub? If yes, the extracted facts get high confidence
    // ("verified" band). If no, downgrade to "low" so they end up
    // as "suggested" and get filtered out at render. Personal sites
    // are user-asserted; we trust them only when the page itself
    // proves ownership of the GitHub identity we've already verified
    // via OAuth.
    const verified = textMentionsGithubHandle(text, input.session.handle);
    if (!verified) {
      log(
        `[${label}] page does not link to github.com/${input.session.handle} — downgrading facts to low confidence.\n`,
      );
    }
    const facts = buildFacts({
      extraction: result,
      url,
      confidence: verified ? "high" : "low",
    });
    emitFactsToTrace(trace, label, facts);

    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: facts.length,
      status: facts.length > 0 ? "ok" : "empty",
    });
    return facts;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[${label}] error: ${msg}\n`);
    trace?.fetcherError({
      label,
      error: msg,
      stack: err instanceof Error ? err.stack : undefined,
      retryable: false,
    });
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "error",
    });
    return [];
  }
}

async function fetchText(
  url: string,
  opts: { trace?: ScanTrace; log: (s: string) => void },
): Promise<string | null> {
  const tf = TinyFishClient.fromEnv();
  if (tf) {
    const t0 = Date.now();
    const resp = await tf.fetchUrls([url], { format: "markdown" });
    const ms = Date.now() - t0;
    opts.trace?.tinyfishFetch({
      urls: [url],
      ok: resp.ok,
      durationMs: ms,
      perUrl: resp.results.map((r) => ({
        url: r.url,
        finalUrl: r.finalUrl,
        title: r.title,
        textChars: r.text.length,
        language: r.language,
      })),
      requestError: resp.requestError,
    });
    if (resp.ok) {
      const first = resp.results[0];
      if (first && first.text && first.text.length > 300) return first.text;
    }
  }
  // Fall back to Jina Reader
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      redirect: "follow",
      headers: {
        Accept: "text/plain",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 300 ? text : null;
  } catch {
    return null;
  }
}

/** Does the rendered page text link back to `github.com/{handle}`? */
function textMentionsGithubHandle(text: string, handle: string): boolean {
  if (!text || !handle) return false;
  const lc = text.toLowerCase();
  const lcHandle = handle.toLowerCase();
  return (
    lc.includes(`github.com/${lcHandle}`) ||
    lc.includes(`@${lcHandle}`) ||
    // Some sites render their GH link as `github.com / handle` after
    // markdown trimming — accept the spaced variant too.
    lc.includes(`github.com / ${lcHandle}`)
  );
}

function buildFacts(args: {
  extraction: PersonalSiteExtraction;
  url: string;
  confidence: "high" | "medium" | "low";
}): TypedFact[] {
  const { extraction, url, confidence } = args;
  const facts: TypedFact[] = [];
  const src = (snippet?: string) =>
    makeSource({
      fetcher: "personal-site",
      method: "llm-extraction",
      confidence,
      url,
      snippet,
    });

  if (extraction.bio || extraction.location) {
    facts.push({
      kind: "PERSON",
      person: {
        bio: extraction.bio,
        location: extraction.location,
        url,
      },
      source: src(extraction.bio?.slice(0, 300)),
    });
  }
  if (extraction.location) {
    facts.push({
      kind: "LIVES_IN",
      location: extraction.location,
      source: src(extraction.location),
    });
  }
  for (const p of extraction.positions) {
    facts.push({
      kind: "WORKED_AT",
      company: { canonicalName: p.company },
      attrs: {
        role: p.title,
        start: p.start,
        end: p.end,
        present: p.present,
        description: p.description,
      },
      source: src(p.description?.slice(0, 300) ?? `${p.title} at ${p.company}`),
    });
  }
  for (const proj of extraction.projects) {
    facts.push({
      kind: "BUILT",
      project: {
        title: proj.title,
        purpose: proj.purpose,
        kind: "product",
        polish: "shipped",
        homepageUrl: proj.url,
      },
      attrs: {},
      source: src(proj.purpose.slice(0, 300)),
    });
  }
  return facts;
}
