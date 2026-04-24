/**
 * Shared helper for the three "guessed URL" blog profile fetchers —
 * Hacker News, dev.to, Medium. They share the same shape:
 *
 *   1. Build a URL from session.handle.
 *   2. Fetch via TinyFish then fall back to Jina Reader.
 *   3. If the content is 404 / login-walled / < 300 chars, bail silently.
 *   4. Run a Kimi extraction: bio, location, authored posts.
 *   5. Emit PERSON + AUTHORED(kind=blog) facts at confidence=low.
 */

import * as z from "zod/v4";
import { runAgentWithSubmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import { TinyFishClient } from "@gitshow/shared/cloud/tinyfish";
import { makeSource } from "@gitshow/shared/kg";
import type { TypedFact, Source } from "@gitshow/shared/kg";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";
import { emitFactsToTrace } from "./linkedin-public.js";

const JINA_TIMEOUT_MS = 30_000;
const USER_AGENT = "GitShow/0.2 (+https://github.com/yatendrakumar/gitshow)";
const MIN_CHARS = 300;

const ProfileExtractionSchema = z.object({
  bio: z.string().max(800).optional(),
  location: z.string().max(200).optional(),
  posts: z
    .array(
      z.object({
        title: z.string().max(300),
        url: z.string().max(500),
        publishedAt: z.string().max(40).optional(),
      }),
    )
    .max(50),
});
type ProfileExtraction = z.infer<typeof ProfileExtractionSchema>;

const SYSTEM_PROMPT = `You extract a person's bio + their blog posts from a profile page.

Return:
- bio: 1-3 sentence "about" line from the page header (verbatim if present)
- location: explicit location if stated
- posts: list of articles authored by this user, with full URLs and publish dates if present

Rules:
- Extract only what's stated. Never invent posts.
- Skip sidebar/recommended/advertisement content.
- If the page is a 404 or empty-looking profile, return empty arrays.

Call submit_profile exactly once.`;

export interface ProfileScrapeArgs {
  /** Fetcher label for trace events ("hn-profile", "devto-profile", etc.). */
  label: string;
  /** Tag for the Source.fetcher union ("hn", "devto", "medium"). */
  fetcherTag: Source["fetcher"];
  url: string;
  session: ScanSession;
  usage: SessionUsage;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
  /** Regex that matches the site's "no such user" / 404 shell. */
  notFoundMarker?: RegExp;
}

export async function runProfileScrape(
  args: ProfileScrapeArgs,
): Promise<TypedFact[]> {
  const { label, fetcherTag, url, session, usage, trace, notFoundMarker } = args;
  const log = args.onProgress ?? (() => {});
  const t0 = Date.now();

  trace?.fetcherStart({ label, input: { url } });

  try {
    const text = await fetchText(url, { trace });
    if (!text || text.length < MIN_CHARS || (notFoundMarker && notFoundMarker.test(text))) {
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
      input: `## Source URL\n${url}\n\n## Page text\n\n${text.slice(0, 25_000)}\n\n---\nExtract bio, location, posts. Call submit_profile.`,
      submitToolName: "submit_profile",
      submitToolDescription: "Submit the extracted profile. Call exactly once.",
      submitSchema: ProfileExtractionSchema,
      reasoning: { effort: "low" },
      session,
      usage,
      label: `fetcher:${label}`,
      onProgress: log,
      trace,
    });

    const facts = buildFacts({ extraction: result, url, fetcherTag });
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
  opts: { trace?: ScanTrace },
): Promise<string | null> {
  const tf = TinyFishClient.fromEnv();
  if (tf) {
    const t0 = Date.now();
    const resp = await tf.fetchUrls([url], { format: "markdown" });
    opts.trace?.tinyfishFetch({
      urls: [url],
      ok: resp.ok,
      durationMs: Date.now() - t0,
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
      if (first && first.text.length > MIN_CHARS) return first.text;
    }
  }
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
    return text;
  } catch {
    return null;
  }
}

function buildFacts(args: {
  extraction: ProfileExtraction;
  url: string;
  fetcherTag: Source["fetcher"];
}): TypedFact[] {
  const { extraction, url, fetcherTag } = args;
  const facts: TypedFact[] = [];
  const src = (snippet?: string) =>
    makeSource({
      fetcher: fetcherTag,
      method: "scrape",
      confidence: "low",
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
  for (const post of extraction.posts) {
    facts.push({
      kind: "AUTHORED",
      publication: {
        title: post.title,
        url: post.url,
        kind: "blog",
        publishedAt: post.publishedAt,
      },
      source: src(post.title.slice(0, 300)),
    });
  }
  return facts;
}
