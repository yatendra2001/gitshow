/**
 * medium-profile fetcher — scrapes the user's Medium profile for bio +
 * authored posts.
 *
 * URL is guessed from the GitHub handle at `medium.com/@{handle}`. Low
 * confidence; same-handle heuristic often wrong.
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

export async function runMediumProfileFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const handle = input.session.handle;
  const url = `https://medium.com/@${encodeURIComponent(handle)}`;
  return runProfileScrape({
    label: "medium-profile",
    fetcherTag: "medium",
    url,
    session: input.session,
    usage: input.usage,
    trace: input.trace,
    onProgress: input.onProgress,
    notFoundMarker: /PAGE NOT FOUND|404 — this page is not available/i,
  });
}
