/**
 * LinkedIn helper — fetches a user-provided LinkedIn URL and returns
 * markdown text the work/education agents feed into their LLM input.
 *
 * Fallback chain:
 *   1. TinyFish Fetch (real-browser render). SKIPPED for linkedin.com/in/
 *      URLs — those return a 145-char "Sign Up | LinkedIn" shell every
 *      time; don't burn a TinyFish credit proving that.
 *   2. Jina Reader (free, no key). Sometimes slips through on public
 *      profiles LinkedIn exposes to search-engine user agents.
 *
 * Both endpoints can return login-wall HTML; we reject via isUsable()
 * (short + wall keywords, OR `Sign Up | LinkedIn` title regardless of
 * length). Returning null means "no usable LinkedIn content" — agents
 * fall back to intake + evidence bag + GitHub hints.
 */

import type { ScanSession } from "../schemas.js";
import { TinyFishClient } from "@gitshow/shared/cloud/tinyfish";
import type { ScanTrace } from "./observability/trace.js";

export interface LinkedInMaterial {
  /** Where the content came from — URL for web fetches, `"pdf"` for uploads. */
  source: string;
  /** Which fallback tier succeeded — useful for scan_events + debugging. */
  tier: "tinyfish" | "jina" | "pdf";
  /** Markdown / plain text content for agent consumption. */
  text: string;
}

const JINA_TIMEOUT_MS = 30_000;
const MIN_TEXT_CHARS = 800;
const LOGIN_WALL_PATTERN =
  /sign\s*in|sign\s*up|log\s*in|login|authwall|members only|join (?:now|linkedin)|by clicking continue/i;
/** `Sign Up | LinkedIn` title — 100% reliable login-wall signal. */
export const LOGIN_WALL_TITLES = /^(sign up|sign in|log in|join linkedin)/i;

/**
 * Attempt to fetch the user's LinkedIn profile via the best available
 * scraper. Returns null when no URL was provided, all fetches fail, or
 * the only content we got is clearly a login wall.
 */
export async function fetchLinkedIn(
  session: ScanSession,
  opts: { onProgress?: (text: string) => void; trace?: ScanTrace } = {},
): Promise<LinkedInMaterial | null> {
  const url = session.socials.linkedin;
  if (!url) return null;
  const log = opts.onProgress ?? (() => {});
  const trace = opts.trace;

  const isLinkedInProfile = /\blinkedin\.com\/in\//i.test(url);

  // Tier 1: TinyFish. Skipped on linkedin.com/in/ — always login-walls.
  const tf = TinyFishClient.fromEnv();
  if (tf && !isLinkedInProfile) {
    const t0 = Date.now();
    const resp = await tf.fetchUrls([url], { format: "markdown" });
    if (resp.ok) {
      const first = resp.results[0];
      if (first && isUsable(first.text, first.title)) {
        log(`[linkedin] tinyfish ok (${first.text.length} chars)\n`);
        trace?.linkedInFetch({
          url,
          tier: "tinyfish",
          ok: true,
          textChars: first.text.length,
          title: first.title,
          durationMs: Date.now() - t0,
        });
        return { source: url, tier: "tinyfish", text: first.text };
      }
      const tfErr = resp.errors[0]?.error;
      log(
        `[linkedin] tinyfish returned ${first?.text?.length ?? 0} chars` +
          (tfErr ? ` (err: ${tfErr})` : "") +
          ` — trying jina.\n`,
      );
      trace?.linkedInFetch({
        url,
        tier: "tinyfish",
        ok: false,
        textChars: first?.text?.length ?? 0,
        title: first?.title,
        reason: tfErr ?? "login-wall or thin content",
        durationMs: Date.now() - t0,
      });
    } else {
      log(`[linkedin] tinyfish request failed: ${resp.requestError ?? "unknown"} — trying jina.\n`);
      trace?.linkedInFetch({
        url,
        tier: "tinyfish",
        ok: false,
        reason: resp.requestError ?? "request failed",
        durationMs: Date.now() - t0,
      });
    }
  } else if (isLinkedInProfile) {
    log(`[linkedin] skipping tinyfish — linkedin.com/in/ always login-walls; saves a credit.\n`);
    trace?.linkedInFetch({
      url,
      tier: "skipped",
      ok: false,
      reason: "linkedin.com/in/ known to login-wall — skipping tinyfish",
      durationMs: 0,
    });
  }

  // Tier 2: Jina Reader — free, no key, decent on static linkedin pages.
  const jinaT0 = Date.now();
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      redirect: "follow",
      headers: {
        Accept: "text/plain",
        "User-Agent": "GitShow/0.2 (+https://github.com/yatendrakumar/gitshow)",
      },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });
    if (res.ok) {
      const text = await res.text();
      if (isUsable(text)) {
        log(`[linkedin] jina ok (${text.length} chars)\n`);
        trace?.linkedInFetch({
          url,
          tier: "jina",
          ok: true,
          textChars: text.length,
          durationMs: Date.now() - jinaT0,
        });
        return { source: url, tier: "jina", text };
      }
      log(`[linkedin] jina returned ${text.length} chars — login wall / thin content, rejecting.\n`);
      trace?.linkedInFetch({
        url,
        tier: "jina",
        ok: false,
        textChars: text.length,
        reason: "login wall / thin content",
        durationMs: Date.now() - jinaT0,
      });
    } else {
      log(`[linkedin] jina http ${res.status}.\n`);
      trace?.linkedInFetch({
        url,
        tier: "jina",
        ok: false,
        reason: `http ${res.status}`,
        durationMs: Date.now() - jinaT0,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[linkedin] jina threw: ${msg}\n`);
    trace?.linkedInFetch({
      url,
      tier: "jina",
      ok: false,
      reason: `threw: ${msg}`,
      durationMs: Date.now() - jinaT0,
    });
  }

  return null;
}

function isUsable(text: string | null | undefined, title?: string): boolean {
  if (!text) return false;
  // A "Sign Up | LinkedIn" / "Sign In | LinkedIn" title is an unmistakable
  // wall regardless of length — reject even if the body is long (e.g.
  // TinyFish dumping footer boilerplate).
  if (title && LOGIN_WALL_TITLES.test(title.trim())) return false;
  if (text.length < MIN_TEXT_CHARS) {
    // Short responses are usually login walls or 404 shells.
    return !LOGIN_WALL_PATTERN.test(text);
  }
  return true;
}

/**
 * Accept pre-extracted PDF content from the webapp upload path. The
 * webapp handles PDF→text extraction; if nothing usable, caller passes null.
 *
 * TODO: wire into the webapp `/api/scan/pdf-upload` endpoint — it should
 * extract text server-side and forward it as CONTEXT_NOTES with a
 * `#linkedin-pdf` marker the worker can split on.
 */
export function parsePdfContent(text: string | null): LinkedInMaterial | null {
  if (!text || text.length < 200) return null;
  return { source: "pdf", tier: "pdf", text };
}

/**
 * Lightweight heuristic: extract any "companies" the user mentioned in
 * freeform `context_notes`. Used as a belt-and-braces signal for the
 * work-agent when LinkedIn fails and no intake form was completed.
 */
export function extractCompaniesFromNotes(notes: string | undefined): string[] {
  if (!notes) return [];
  const matches = notes.matchAll(/@([A-Za-z0-9][A-Za-z0-9\-._]{1,40})/g);
  const seen = new Set<string>();
  for (const m of matches) seen.add(m[1]);
  return Array.from(seen);
}

// Exported for unit testing.
export const __private = { isUsable, LOGIN_WALL_PATTERN, MIN_TEXT_CHARS };
