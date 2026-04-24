/**
 * devto-profile fetcher — scrapes the user's dev.to profile for bio +
 * authored posts.
 *
 * URL is guessed from the GitHub handle. Low confidence; same-handle
 * heuristic is often wrong.
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

export async function runDevtoProfileFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const handle = input.session.handle;
  const url = `https://dev.to/${encodeURIComponent(handle)}`;
  return runProfileScrape({
    label: "devto-profile",
    fetcherTag: "devto",
    url,
    session: input.session,
    usage: input.usage,
    trace: input.trace,
    onProgress: input.onProgress,
    notFoundMarker: /We could not find the page|Page Not Found|404/i,
  });
}
