/**
 * semantic-scholar fetcher — free public API for academic paper discovery.
 *
 * Input: a person's full name (usually `github.profile.name`) and an
 * optional affiliation guess (used to disambiguate common names).
 *
 * Two hops:
 *   1. `/graph/v1/author/search?query=<name>` → pick the top author ID
 *      whose affiliation (if present) matches the guess substring.
 *   2. `/graph/v1/author/{id}/papers?limit=50` → emit AUTHORED per paper.
 *
 * Rate limits: ~100 req/5min unauthenticated. We hit 2 endpoints once
 * per scan — well under the limit. On 429 we skip silently.
 */

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
  /** Person's full name for search. Pipeline passes `github.profile.name`. */
  personName: string;
  /** Optional affiliation string to disambiguate common names. */
  affiliationGuess?: string;
}

interface S2Author {
  authorId: string;
  name: string;
  affiliations?: string[];
  paperCount?: number;
  citationCount?: number;
  hIndex?: number;
}

interface S2SearchResponse {
  total?: number;
  offset?: number;
  next?: number;
  data?: S2Author[];
}

interface S2Paper {
  paperId: string;
  title: string;
  year?: number;
  venue?: string;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
    CorpusId?: number;
  };
  authors?: Array<{ name: string }>;
  abstract?: string;
}

interface S2PapersResponse {
  offset?: number;
  data?: S2Paper[];
}

const API_TIMEOUT_MS = 30_000;

export async function runSemanticScholarFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const label = "semantic-scholar";
  const t0 = Date.now();
  const log = input.onProgress ?? (() => {});
  const trace = input.trace;
  const name = input.personName?.trim();

  trace?.fetcherStart({
    label,
    input: { name, affiliationGuess: input.affiliationGuess },
  });

  if (!name) {
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  try {
    // Step 1: author search
    const searchUrl = `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(name)}&limit=5&fields=name,affiliations,paperCount,hIndex`;
    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (searchRes.status === 429) {
      log(`[${label}] 429 — skipping silently.\n`);
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }
    if (!searchRes.ok) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }
    const search = (await searchRes.json()) as S2SearchResponse;
    const authors = search.data ?? [];
    if (authors.length === 0) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    // Pick best match: prefer affiliation substring match when provided,
    // otherwise take the highest hIndex / paperCount.
    const affGuess = input.affiliationGuess?.toLowerCase();
    let picked: S2Author | undefined;
    if (affGuess) {
      picked = authors.find((a) =>
        (a.affiliations ?? []).some((aff) =>
          aff.toLowerCase().includes(affGuess),
        ),
      );
    }
    if (!picked) {
      picked = [...authors].sort(
        (a, b) => (b.hIndex ?? 0) - (a.hIndex ?? 0)
          || (b.paperCount ?? 0) - (a.paperCount ?? 0),
      )[0];
    }
    if (!picked) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    // Step 2: papers
    const papersUrl = `https://api.semanticscholar.org/graph/v1/author/${picked.authorId}/papers?limit=50&fields=title,year,venue,externalIds,authors`;
    const papersRes = await fetch(papersUrl, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (papersRes.status === 429 || !papersRes.ok) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }
    const papersJson = (await papersRes.json()) as S2PapersResponse;
    const papers = papersJson.data ?? [];

    const facts: TypedFact[] = [];
    for (const p of papers) {
      if (!p.title) continue;
      const doi = p.externalIds?.DOI;
      const arxivId = p.externalIds?.ArXiv;
      const url = doi
        ? `https://doi.org/${doi}`
        : arxivId
          ? `https://arxiv.org/abs/${arxivId}`
          : `https://www.semanticscholar.org/paper/${p.paperId}`;
      facts.push({
        kind: "AUTHORED",
        publication: {
          title: p.title,
          url,
          kind: "paper",
          venue: p.venue,
          publishedAt: p.year ? `${p.year}-01-01` : undefined,
          doi,
          arxivId,
          coAuthors: (p.authors ?? []).map((a) => a.name).filter(Boolean),
        },
        source: makeSource({
          fetcher: "semantic-scholar",
          method: "api",
          confidence: "medium",
          url,
          snippet: p.title.slice(0, 300),
        }),
      });
    }

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
