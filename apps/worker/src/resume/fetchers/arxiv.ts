/**
 * arxiv fetcher — free arXiv API for preprints.
 *
 * Uses the Atom XML Search API. fast-xml-parser is a dynamic import so
 * the worker typechecks without the dep (added separately in
 * package.json).
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
  /** Person's full name. Pipeline passes `github.profile.name`. */
  personName: string;
}

const API_TIMEOUT_MS = 30_000;

// ─── arXiv Atom feed shape (partial, after fast-xml-parser) ─────────

interface ArxivAtomFeed {
  feed?: {
    entry?: ArxivEntry | ArxivEntry[];
  };
}

interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  author?: ArxivAuthor | ArxivAuthor[];
  link?: ArxivLink | ArxivLink[];
}

interface ArxivAuthor {
  name?: string;
}

interface ArxivLink {
  "@_href"?: string;
  "@_rel"?: string;
  "@_title"?: string;
}

export async function runArxivFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const label = "arxiv";
  const t0 = Date.now();
  const log = input.onProgress ?? (() => {});
  const trace = input.trace;
  const name = input.personName?.trim();

  trace?.fetcherStart({ label, input: { name } });

  if (!name) {
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  // Dynamic import so we typecheck without fast-xml-parser installed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let XMLParser: any = null;
  try {
    const mod = (await import("fast-xml-parser")) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      XMLParser?: any;
    };
    XMLParser = mod.XMLParser;
  } catch {
    log(`[${label}] fast-xml-parser not installed — skipping.\n`);
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }
  if (!XMLParser) {
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  try {
    const query = `au:"${name}"`;
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=50`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: { Accept: "application/atom+xml" },
    });
    if (!res.ok) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }
    const xml = await res.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const parsed = parser.parse(xml) as ArxivAtomFeed;
    const entriesRaw = parsed.feed?.entry;
    const entries: ArxivEntry[] = Array.isArray(entriesRaw)
      ? entriesRaw
      : entriesRaw
        ? [entriesRaw]
        : [];

    const facts: TypedFact[] = [];
    for (const e of entries) {
      if (!e.title || !e.id) continue;
      const title = cleanXmlText(e.title);
      const abs = e.id; // arXiv id URL
      const arxivId = extractArxivId(abs);
      const authorsRaw = Array.isArray(e.author)
        ? e.author
        : e.author
          ? [e.author]
          : [];
      const coAuthors = authorsRaw
        .map((a) => a?.name)
        .filter((n): n is string => !!n);

      facts.push({
        kind: "AUTHORED",
        publication: {
          title,
          url: abs,
          kind: "preprint",
          arxivId,
          publishedAt: e.published
            ? e.published.slice(0, 10)
            : undefined,
          summary: e.summary
            ? cleanXmlText(e.summary).slice(0, 400)
            : undefined,
          coAuthors,
        },
        source: makeSource({
          fetcher: "arxiv",
          method: "api",
          confidence: "medium",
          url: abs,
          snippet: title.slice(0, 300),
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

function cleanXmlText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractArxivId(absUrl: string): string | undefined {
  // arXiv id URLs look like http://arxiv.org/abs/2403.12345v1
  const m = absUrl.match(/arxiv\.org\/abs\/([^/?]+)/i);
  return m?.[1];
}
