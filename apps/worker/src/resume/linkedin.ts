/**
 * LinkedIn helper — fetches a user-provided LinkedIn URL and returns
 * markdown text the work/education agents feed into their LLM input.
 *
 * Fallback chain (first non-null wins):
 *   1. TinyFish Fetch (real-browser render — handles LinkedIn's JS auth-wall better)
 *   2. Jina Reader (plain scraper — works for many PUBLIC profiles)
 *
 * Both endpoints can return login-wall HTML for signed-out viewers; we
 * reject results shorter than MIN_TEXT_CHARS AND matching login-wall
 * heuristics. Returning null is the signal "no usable LinkedIn content"
 * — agents then fall back to intake + GitHub hints.
 */

import type { ScanSession } from "../schemas.js";
import { TinyFishClient } from "@gitshow/shared/cloud/tinyfish";

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
const LOGIN_WALL_PATTERN = /sign\s*in|login|authwall|members only|join (?:now|linkedin)/i;

/**
 * Attempt to fetch the user's LinkedIn profile via the best available
 * scraper. Returns null when no URL was provided, all fetches fail, or
 * the only content we got is clearly a login wall.
 */
export async function fetchLinkedIn(
  session: ScanSession,
  opts: { onProgress?: (text: string) => void } = {},
): Promise<LinkedInMaterial | null> {
  const url = session.socials.linkedin;
  if (!url) return null;
  const log = opts.onProgress ?? (() => {});

  // Tier 1: TinyFish. Real browser renders JS, bypasses simple auth-walls.
  const tf = TinyFishClient.fromEnv();
  if (tf) {
    const resp = await tf.fetchUrls([url], { format: "markdown" });
    if (resp.ok) {
      const first = resp.results[0];
      if (first && isUsable(first.text)) {
        log(`[linkedin] tinyfish ok (${first.text.length} chars)\n`);
        return { source: url, tier: "tinyfish", text: first.text };
      }
      const tfErr = resp.errors[0]?.error;
      log(
        `[linkedin] tinyfish returned ${first?.text?.length ?? 0} chars` +
          (tfErr ? ` (err: ${tfErr})` : "") +
          ` — trying jina.\n`,
      );
    } else {
      log(`[linkedin] tinyfish request failed: ${resp.requestError ?? "unknown"} — trying jina.\n`);
    }
  }

  // Tier 2: Jina Reader — free, no key, decent on static linkedin pages.
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
        return { source: url, tier: "jina", text };
      }
      log(`[linkedin] jina returned ${text.length} chars — rejecting.\n`);
    } else {
      log(`[linkedin] jina http ${res.status}.\n`);
    }
  } catch (err) {
    log(`[linkedin] jina threw: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  return null;
}

function isUsable(text: string | null | undefined): boolean {
  if (!text) return false;
  if (text.length < MIN_TEXT_CHARS) {
    // Short responses are usually login walls or 404 shells.
    return !LOGIN_WALL_PATTERN.test(text);
  }
  // Longer responses are probably real content even if they mention
  // "sign in" somewhere in the header chrome — length is the stronger signal.
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
