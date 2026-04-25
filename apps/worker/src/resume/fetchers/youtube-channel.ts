/**
 * YouTube channel fetcher — pulls a creator's channel description,
 * subscriber count, recent video titles, and channel-default avatar
 * via the YouTube Data API v3.
 *
 * Why we left TinyFish: anonymous YouTube channel pages return ~160
 * chars of usable content (the rest is JS-bootstrap noise that even
 * a headless browser can't unblock). The Data API is free up to
 * 10,000 quota units / day; channel + recent uploads costs ~5 units
 * per scan. This is the right call.
 *
 * Activation: set `YOUTUBE_API_KEY` (Google Cloud project, "YouTube
 * Data API v3" enabled). Without it, returns [] silently — caller
 * (pipeline) treats that the same as "user has no YouTube".
 *
 * Self-link verification: the channel description must mention
 * `github.com/{handle}` or `@{handle}` to flip the bio facts to
 * high confidence; otherwise low (suggested band, filtered at render).
 */

import { makeSource } from "@gitshow/shared/kg";
import type { TypedFact } from "@gitshow/shared/kg";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";

export interface FetcherInput {
  session: ScanSession;
  usage: SessionUsage;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
}

const TIMEOUT_MS = 30_000;
const RECENT_VIDEO_COUNT = 8;

interface ChannelResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      country?: string;
      thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
    };
    statistics?: {
      subscriberCount?: string;
      videoCount?: string;
      viewCount?: string;
    };
    contentDetails?: {
      relatedPlaylists?: { uploads?: string };
    };
  }>;
}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      publishedAt?: string;
      resourceId?: { videoId?: string };
    };
  }>;
}

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

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    log(`[${label}] no YOUTUBE_API_KEY in env — skipping channel enrichment\n`);
    trace?.note(
      "youtube:skipped",
      "no YOUTUBE_API_KEY — set the secret to enable YouTube channel enrichment",
    );
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  try {
    const channelId = await resolveChannelId(url, apiKey, log);
    if (!channelId) {
      log(`[${label}] could not resolve channel id from ${url}\n`);
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    const channel = await fetchChannel(channelId, apiKey);
    if (!channel) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    const item = channel.items?.[0];
    if (!item || !item.snippet) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    const description = item.snippet.description ?? "";
    const recentTitles: string[] = [];
    const uploadsPlaylist = item.contentDetails?.relatedPlaylists?.uploads;
    if (uploadsPlaylist) {
      const uploads = await fetchPlaylistItems(uploadsPlaylist, apiKey).catch(
        () => null,
      );
      if (uploads?.items) {
        for (const it of uploads.items.slice(0, RECENT_VIDEO_COUNT)) {
          if (it.snippet?.title) recentTitles.push(it.snippet.title);
        }
      }
    }

    const verified = mentionsGithubHandle(description, input.session.handle);
    const confidence: "high" | "medium" | "low" = verified ? "high" : "low";
    const facts = buildFacts({
      bio: description.slice(0, 800),
      country: item.snippet.country,
      avatarUrl:
        item.snippet.thumbnails?.medium?.url ??
        item.snippet.thumbnails?.default?.url,
      url,
      confidence,
    });
    if (recentTitles.length > 0) {
      trace?.note(
        "youtube-channel:recent-titles",
        recentTitles.join(" · "),
        {
          handle: input.session.handle,
          channelId,
          subscribers: item.statistics?.subscriberCount,
        },
      );
    }
    log(
      `[${label}] ok — channel=${channelId} subscribers=${item.statistics?.subscriberCount ?? "?"} videos=${item.statistics?.videoCount ?? "?"} recent=${recentTitles.length}\n`,
    );
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

/**
 * Coerce whatever URL the user pasted into a channel ID. YouTube
 * supports four forms:
 *   - /channel/UCxxxxxxxxxxxxxxxxxxxxxx — already canonical
 *   - /@handle                          — needs handle→ID lookup
 *   - /c/customName                     — needs custom→ID lookup
 *   - /user/legacyName                  — needs legacy→ID lookup
 */
async function resolveChannelId(
  pastedUrl: string,
  apiKey: string,
  log: (s: string) => void,
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(pastedUrl);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, "");

  // /channel/UCxxxx — return verbatim.
  const channelMatch = /^\/channel\/(UC[A-Za-z0-9_-]{20,})/.exec(path);
  if (channelMatch?.[1]) return channelMatch[1];

  // /@handle — use forHandle lookup (Data API v3 supports it directly).
  const atMatch = /^\/@([A-Za-z0-9._-]+)/.exec(path);
  if (atMatch?.[1]) {
    return lookupByHandle(atMatch[1], apiKey, log);
  }

  // /c/customName — search by custom URL.
  const customMatch = /^\/c\/([A-Za-z0-9._-]+)/.exec(path);
  if (customMatch?.[1]) {
    return searchChannelByQuery(customMatch[1], apiKey, log);
  }

  // /user/legacyName — Data API supports forUsername.
  const userMatch = /^\/user\/([A-Za-z0-9._-]+)/.exec(path);
  if (userMatch?.[1]) {
    return lookupByUsername(userMatch[1], apiKey, log);
  }

  return null;
}

async function lookupByHandle(
  handle: string,
  apiKey: string,
  log: (s: string) => void,
): Promise<string | null> {
  const u = new URL("https://www.googleapis.com/youtube/v3/channels");
  u.searchParams.set("part", "id");
  u.searchParams.set("forHandle", `@${handle}`);
  u.searchParams.set("key", apiKey);
  const res = await ytFetch(u, log);
  if (!res) return null;
  const json = (await res.json()) as ChannelResponse;
  return json.items?.[0]?.id ?? null;
}

async function lookupByUsername(
  username: string,
  apiKey: string,
  log: (s: string) => void,
): Promise<string | null> {
  const u = new URL("https://www.googleapis.com/youtube/v3/channels");
  u.searchParams.set("part", "id");
  u.searchParams.set("forUsername", username);
  u.searchParams.set("key", apiKey);
  const res = await ytFetch(u, log);
  if (!res) return null;
  const json = (await res.json()) as ChannelResponse;
  return json.items?.[0]?.id ?? null;
}

async function searchChannelByQuery(
  query: string,
  apiKey: string,
  log: (s: string) => void,
): Promise<string | null> {
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("type", "channel");
  u.searchParams.set("q", query);
  u.searchParams.set("maxResults", "1");
  u.searchParams.set("key", apiKey);
  const res = await ytFetch(u, log);
  if (!res) return null;
  const json = (await res.json()) as {
    items?: Array<{ id?: { channelId?: string } }>;
  };
  return json.items?.[0]?.id?.channelId ?? null;
}

async function fetchChannel(
  channelId: string,
  apiKey: string,
): Promise<ChannelResponse | null> {
  const u = new URL("https://www.googleapis.com/youtube/v3/channels");
  u.searchParams.set("part", "snippet,statistics,contentDetails");
  u.searchParams.set("id", channelId);
  u.searchParams.set("key", apiKey);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as ChannelResponse;
  } finally {
    clearTimeout(t);
  }
}

async function fetchPlaylistItems(
  playlistId: string,
  apiKey: string,
): Promise<PlaylistItemsResponse | null> {
  const u = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("playlistId", playlistId);
  u.searchParams.set("maxResults", String(RECENT_VIDEO_COUNT));
  u.searchParams.set("key", apiKey);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as PlaylistItemsResponse;
  } finally {
    clearTimeout(t);
  }
}

async function ytFetch(
  url: URL,
  log: (s: string) => void,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log(
        `[youtube-channel] ${url.pathname} http ${res.status}: ${body.slice(0, 200)}\n`,
      );
      return null;
    }
    return res;
  } finally {
    clearTimeout(t);
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
  bio: string;
  country?: string;
  avatarUrl?: string;
  url: string;
  confidence: "high" | "medium" | "low";
}): TypedFact[] {
  const { bio, country, avatarUrl, url, confidence } = args;
  const facts: TypedFact[] = [];
  const src = (snippet?: string) =>
    makeSource({
      fetcher: "youtube",
      method: "api",
      confidence,
      url,
      snippet,
    });

  const personPatch: { bio?: string; location?: string; avatarUrl?: string } = {};
  if (bio) personPatch.bio = bio;
  if (country) personPatch.location = country;
  if (avatarUrl) personPatch.avatarUrl = avatarUrl;
  if (Object.keys(personPatch).length > 0) {
    facts.push({
      kind: "PERSON",
      person: personPatch,
      source: src(bio.slice(0, 300)),
    });
  }
  if (country) {
    facts.push({
      kind: "LIVES_IN",
      location: country,
      source: src(country),
    });
  }
  return facts;
}
