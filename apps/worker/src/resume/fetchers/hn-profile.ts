/**
 * hn-profile fetcher — scrapes the user's Hacker News profile page for
 * bio / "about" + any links they post about themselves.
 *
 * URL is guessed from the GitHub handle. HN profiles at
 * `news.ycombinator.com/user?id={handle}` — when no match exists HN
 * renders a "No such user" string we detect and skip.
 *
 * Low confidence: the GitHub handle is often NOT the HN handle; this is
 * a speculative fetch.
 */

import { runProfileScrape } from "./_profile-shared.js";
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

export async function runHnProfileFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const handle = input.session.handle;
  const url = `https://news.ycombinator.com/user?id=${encodeURIComponent(handle)}`;
  return runProfileScrape({
    label: "hn-profile",
    fetcherTag: "hn",
    url,
    session: input.session,
    usage: input.usage,
    trace: input.trace,
    onProgress: input.onProgress,
    // HN "no such user" page has very little content; the shared helper's
    // MIN_CHARS threshold catches this.
    notFoundMarker: /No such user|Unknown or expired/i,
  });
}
