/**
 * twitter-bio fetcher — scrapes the user's Twitter/X profile for bio +
 * current affiliation.
 *
 * Twitter bios often encode the freshest "currently at X" signal — users
 * update them before updating LinkedIn. Even logged-out viewers usually
 * get the bio rendered into the HTML, so a real-browser render via
 * TinyFish works well enough without auth.
 *
 * Nitter is tried as a second hop when Twitter itself returns thin
 * content (rate-limited / A/B experiment).
 *
 * Facts emitted:
 *   - PERSON (bio + location)
 *   - WORKED_AT with present:true when bio says "currently at X" / "building X"
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

const MIN_CHARS = 300;

const TwitterExtractionSchema = z.object({
  bio: z.string().max(800).optional(),
  location: z.string().max(200).optional(),
  currentCompany: z.string().max(200).optional(),
  currentRole: z.string().max(200).optional(),
});
type TwitterExtraction = z.infer<typeof TwitterExtractionSchema>;

const SYSTEM_PROMPT = `You extract bio + current affiliation from a Twitter/X profile page.

Return:
- bio: the user's bio line (verbatim if possible)
- location: explicit location string
- currentCompany: company name mentioned in bio as "currently at X" / "Building X" / "@X" / "X →". Leave undefined if no current affiliation.
- currentRole: job title from the bio ("Engineer", "Founder", "PM") if present

Rules:
- Only extract from the profile page, not tweets.
- currentCompany must be a real company/product, not an adjective ("building cool stuff" → undefined).
- If the page is a suspended / deleted / empty profile, return empty object.

Call submit_twitter_bio exactly once.`;

export async function runTwitterBioFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const label = "twitter-bio";
  const t0 = Date.now();
  const raw = input.session.socials.twitter;
  const log = input.onProgress ?? (() => {});
  const trace = input.trace;

  const handle = normaliseHandle(raw);
  trace?.fetcherStart({
    label,
    input: { raw, handle, hasHandle: !!handle },
  });

  if (!handle) {
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  try {
    const tf = TinyFishClient.fromEnv();
    if (!tf) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    // Try a small fan of URL patterns via TinyFish. X redirects /handle
    // to its login wall on most user-agents; the nitter mirrors that
    // still serve the public bio change weekly. We try the official
    // `x.com` first because TinyFish's residential-proxy path can
    // occasionally land the unauthenticated bio, then walk through
    // surviving nitter instances. First non-empty page wins.
    const urls = [
      `https://x.com/${handle}`,
      `https://twitter.com/${handle}`,
      `https://nitter.net/${handle}`,
      `https://nitter.poast.org/${handle}`,
      `https://nitter.privacydev.net/${handle}`,
    ];
    let winner: { text: string; url: string } | null = null;
    for (const u of urls) {
      const tfT0 = Date.now();
      const resp = await tf.fetchUrls([u], { format: "markdown" });
      trace?.tinyfishFetch({
        urls: [u],
        ok: resp.ok,
        durationMs: Date.now() - tfT0,
        perUrl: resp.results.map((r) => ({
          url: r.url,
          finalUrl: r.finalUrl,
          title: r.title,
          textChars: r.text.length,
          language: r.language,
        })),
        requestError: resp.requestError,
      });
      const first = resp.results[0];
      if (first && first.text.length > MIN_CHARS) {
        winner = { text: first.text, url: u };
        break;
      }
    }
    if (!winner) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    const { result } = await runAgentWithSubmit({
      model: modelForRole("bulk"),
      systemPrompt: SYSTEM_PROMPT,
      input: `## Handle\n@${handle}\n\n## Page text\n\n${winner.text.slice(0, 20_000)}\n\n---\nExtract bio + current affiliation. Call submit_twitter_bio.`,
      submitToolName: "submit_twitter_bio",
      submitToolDescription:
        "Submit bio + current affiliation. Call exactly once.",
      submitSchema: TwitterExtractionSchema,
      reasoning: { effort: "low" },
      session: input.session,
      usage: input.usage,
      label: "fetcher:twitter-bio",
      onProgress: log,
      trace,
    });

    // Self-link verification: does the Twitter bio cross-link to the
    // user's GitHub? If the page text mentions `github.com/{handle}`,
    // the bio is a verified self-claim. If not, downgrade — anyone
    // can ask us to scrape any Twitter handle.
    const githubLink = mentionsGithubHandle(winner.text, input.session.handle);
    const facts = buildFacts({
      extraction: result,
      url: winner.url,
      confidence: githubLink ? "high" : "low",
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

function normaliseHandle(raw: string | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // strip URL prefixes
  s = s.replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com|nitter\.net)\//i, "");
  s = s.replace(/^@/, "");
  s = s.split(/[/?#]/)[0] ?? "";
  if (!/^[A-Za-z0-9_]{1,30}$/.test(s)) return null;
  return s;
}

function mentionsGithubHandle(text: string, handle: string): boolean {
  if (!text || !handle) return false;
  const lc = text.toLowerCase();
  const lcHandle = handle.toLowerCase();
  return (
    lc.includes(`github.com/${lcHandle}`) ||
    lc.includes(`@${lcHandle}`)
  );
}

function buildFacts(args: {
  extraction: TwitterExtraction;
  url: string;
  confidence: "high" | "medium" | "low";
}): TypedFact[] {
  const { extraction, url, confidence } = args;
  const facts: TypedFact[] = [];
  const src = (snippet?: string) =>
    makeSource({
      fetcher: "twitter",
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
  if (extraction.currentCompany) {
    facts.push({
      kind: "WORKED_AT",
      company: { canonicalName: extraction.currentCompany },
      attrs: {
        role: extraction.currentRole ?? "",
        present: true,
      },
      source: src(extraction.bio?.slice(0, 300)),
    });
  }
  return facts;
}
