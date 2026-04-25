/**
 * YouTube channel fetcher — pulls a creator's channel description and
 * recent video titles from their public channel page.
 *
 * No first-party API required. We hit the channel URL via TinyFish
 * (which renders the React-driven page through a headless browser
 * and returns markdown) and ask Sonnet to extract:
 *   - bio: the "About" / channel description
 *   - location: explicit country/city if present
 *   - recentTitles: up to 6 latest video titles
 *
 * Emits PERSON facts (bio, optional location). The recent video
 * titles are kept as a `note` on the trace for now — we don't have
 * a "ContentItem" entity in the KG yet.
 *
 * Self-link verification mirrors twitter-bio: if the page mentions
 * `github.com/{handle}` or `@{handle}`, confidence is "high"; else
 * "low" (suggested band, filtered at render).
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

const MIN_CHARS = 200;

export interface FetcherInput {
  session: ScanSession;
  usage: SessionUsage;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
}

const ExtractionSchema = z.object({
  bio: z.string().max(800).optional(),
  location: z.string().max(120).optional(),
  recentTitles: z.array(z.string().max(160)).max(6).optional(),
});
type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM_PROMPT = `You read a YouTube channel page and extract a tiny structured profile.

Return:
- bio: 1-3 sentences from the channel's "About" / description if present.
- location: explicit country/city if stated.
- recentTitles: up to 6 most recent video titles you can read on the page (in order).

If the page is a redirect, login wall, or empty, return all fields empty.
Call submit_youtube_channel exactly once.`;

export async function runYoutubeChannelFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const label = "youtube-channel";
  const t0 = Date.now();
  const url = input.session.socials.youtube;
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

    const aboutUrl = url.replace(/\/+$/, "") + "/about";
    const candidates = [aboutUrl, url];
    let winner: { text: string; url: string } | null = null;
    for (const u of candidates) {
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
      input: `## Channel URL\n${url}\n\n## Page text\n\n${winner.text.slice(0, 18_000)}\n\n---\nExtract bio + recent titles. Call submit_youtube_channel.`,
      submitToolName: "submit_youtube_channel",
      submitToolDescription:
        "Submit channel bio + recent video titles. Call exactly once.",
      submitSchema: ExtractionSchema,
      reasoning: { effort: "low" },
      session: input.session,
      usage: input.usage,
      label: "fetcher:youtube-channel",
      onProgress: log,
      trace,
    });

    const verified = mentionsGithubHandle(winner.text, input.session.handle);
    const facts = buildFacts({
      extraction: result,
      url,
      confidence: verified ? "high" : "low",
    });
    if (result.recentTitles?.length) {
      trace?.note(
        "youtube-channel:recent-titles",
        result.recentTitles.join(" · "),
        { handle: input.session.handle },
      );
    }
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

function mentionsGithubHandle(text: string, handle: string): boolean {
  if (!text || !handle) return false;
  const lc = text.toLowerCase();
  const lcHandle = handle.toLowerCase();
  return (
    lc.includes(`github.com/${lcHandle}`) || lc.includes(`@${lcHandle}`)
  );
}

function buildFacts(args: {
  extraction: Extraction;
  url: string;
  confidence: "high" | "medium" | "low";
}): TypedFact[] {
  const { extraction, url, confidence } = args;
  const facts: TypedFact[] = [];
  const src = (snippet?: string) =>
    makeSource({
      fetcher: "youtube",
      method: "scrape",
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
  return facts;
}
