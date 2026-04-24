/**
 * TinyFish HTTP client — search + fetch APIs.
 *
 * Two endpoints:
 *   - Fetch  (api.fetch.tinyfish.ai)  : real-browser render of given URLs
 *   - Search (api.search.tinyfish.ai) : ranked SERP results for a query
 *
 * Used by the resume pipeline in two places:
 *   - LinkedIn fetch (primary; Jina Reader is the fallback)
 *   - DevEvidence research phase (search + fetch top-N SERP results)
 *
 * Quiet on failure: returns structured { ok:false, error } instead of
 * throwing, so callers can fall back without try/catch noise.
 */

import type { Logger } from "../util";
import { consoleLogger } from "../util";

const DEFAULT_FETCH_ENDPOINT = "https://api.fetch.tinyfish.ai";
const DEFAULT_SEARCH_ENDPOINT = "https://api.search.tinyfish.ai";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_URLS_PER_FETCH = 10;

export interface TinyFishConfig {
  apiKey: string;
  fetchEndpoint?: string;
  searchEndpoint?: string;
  timeoutMs?: number;
  logger?: Logger;
}

export interface TinyFishFetchOptions {
  /** `markdown` is friendliest to LLM consumption. */
  format?: "markdown" | "html" | "json";
  /** ISO 3166-1 alpha-2 country code — routes via a proxy in that country. */
  countryCode?: string;
}

export interface TinyFishFetchResult {
  url: string;
  finalUrl?: string;
  title?: string;
  description?: string;
  language?: string;
  text: string;
}

export interface TinyFishFetchError {
  url: string;
  error: string;
}

export interface TinyFishFetchResponse {
  ok: boolean;
  results: TinyFishFetchResult[];
  errors: TinyFishFetchError[];
  /** Populated when ok=false — the whole request failed (auth, network). */
  requestError?: string;
}

export interface TinyFishSearchOptions {
  /** Two-letter country code, e.g. "US". */
  location?: string;
  /** Two-letter language code, e.g. "en". */
  language?: string;
}

export interface TinyFishSearchResult {
  position: number;
  siteName?: string;
  title: string;
  snippet: string;
  url: string;
}

export interface TinyFishSearchResponse {
  ok: boolean;
  results: TinyFishSearchResult[];
  totalResults?: number;
  requestError?: string;
}

export class TinyFishClient {
  private apiKey: string;
  private fetchEndpoint: string;
  private searchEndpoint: string;
  private timeoutMs: number;
  private log: Logger;

  constructor(cfg: TinyFishConfig) {
    this.apiKey = cfg.apiKey;
    this.fetchEndpoint = cfg.fetchEndpoint ?? DEFAULT_FETCH_ENDPOINT;
    this.searchEndpoint = cfg.searchEndpoint ?? DEFAULT_SEARCH_ENDPOINT;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.log =
      (cfg.logger ?? consoleLogger).child?.({ src: "tinyfish" }) ??
      cfg.logger ??
      consoleLogger;
  }

  /**
   * Build from env. Returns null if TINYFISH_API_KEY isn't set — callers
   * should treat that as "no TinyFish, use fallback" and not fail.
   */
  static fromEnv(opts?: { logger?: Logger }): TinyFishClient | null {
    const envObj =
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};
    const apiKey = envObj.TINYFISH_API_KEY;
    if (!apiKey) return null;
    return new TinyFishClient({ apiKey, logger: opts?.logger });
  }

  async fetchUrls(
    urls: string[],
    opts: TinyFishFetchOptions = {},
  ): Promise<TinyFishFetchResponse> {
    if (urls.length === 0) {
      return { ok: true, results: [], errors: [] };
    }
    if (urls.length > MAX_URLS_PER_FETCH) {
      // Preserve the API contract — caller should batch. We refuse rather
      // than silently truncate, so regressions surface in tests.
      return {
        ok: false,
        results: [],
        errors: [],
        requestError: `too many urls (${urls.length} > ${MAX_URLS_PER_FETCH})`,
      };
    }
    const body: Record<string, unknown> = { urls };
    if (opts.format) body.format = opts.format;
    if (opts.countryCode) body.proxy_config = { country_code: opts.countryCode };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(this.fetchEndpoint, {
        method: "POST",
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text();
        this.log.warn?.(
          { status: resp.status, body: text.slice(0, 300) },
          "tinyfish.fetch.bad-status",
        );
        return {
          ok: false,
          results: [],
          errors: [],
          requestError: `http ${resp.status}: ${text.slice(0, 200)}`,
        };
      }
      const data = (await resp.json()) as {
        results?: Array<{
          url: string;
          final_url?: string;
          title?: string;
          description?: string;
          language?: string;
          text?: string;
        }>;
        errors?: Array<{ url: string; error?: string; message?: string }>;
      };
      return {
        ok: true,
        results: (data.results ?? []).map((r) => ({
          url: r.url,
          finalUrl: r.final_url,
          title: r.title,
          description: r.description,
          language: r.language,
          text: r.text ?? "",
        })),
        errors: (data.errors ?? []).map((e) => ({
          url: e.url,
          error: e.error ?? e.message ?? "unknown",
        })),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn?.({ err: msg }, "tinyfish.fetch.failed");
      return { ok: false, results: [], errors: [], requestError: msg };
    } finally {
      clearTimeout(timer);
    }
  }

  async search(
    query: string,
    opts: TinyFishSearchOptions = {},
  ): Promise<TinyFishSearchResponse> {
    const url = new URL(this.searchEndpoint);
    url.searchParams.set("query", query);
    if (opts.location) url.searchParams.set("location", opts.location);
    if (opts.language) url.searchParams.set("language", opts.language);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(url.toString(), {
        method: "GET",
        headers: { "X-API-Key": this.apiKey },
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text();
        this.log.warn?.(
          { status: resp.status, body: text.slice(0, 300) },
          "tinyfish.search.bad-status",
        );
        return {
          ok: false,
          results: [],
          requestError: `http ${resp.status}: ${text.slice(0, 200)}`,
        };
      }
      const data = (await resp.json()) as {
        results?: Array<{
          position: number;
          site_name?: string;
          title: string;
          snippet: string;
          url: string;
        }>;
        total_results?: number;
      };
      return {
        ok: true,
        results: (data.results ?? []).map((r) => ({
          position: r.position,
          siteName: r.site_name,
          title: r.title,
          snippet: r.snippet,
          url: r.url,
        })),
        totalResults: data.total_results,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn?.({ err: msg }, "tinyfish.search.failed");
      return { ok: false, results: [], requestError: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}
