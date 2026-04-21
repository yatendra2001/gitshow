/**
 * LinkedIn helper — fetches a user-provided LinkedIn URL via Jina Reader
 * and returns raw markdown text the work/education agents can feed into
 * their LLM input.
 *
 * Notes on reliability:
 *   - LinkedIn aggressively blocks anonymous scrapers. Jina Reader
 *     succeeds on most PUBLIC profile URLs (the ones you see without
 *     logging in) but fails unpredictably for "members only" pages.
 *   - We NEVER fabricate a LinkedIn URL. The user must have provided
 *     `session.socials.linkedin` — otherwise this helper returns null.
 *   - PDF upload fallback (user exports "Save to PDF" from LinkedIn)
 *     is exposed via `parsePdfContent`. Real PDF parsing requires a
 *     dependency we haven't added; for now that path accepts a text
 *     string the webapp has already extracted and just threads it
 *     through to the agents. See TODO in `fetchLinkedIn`.
 */

import type { ScanSession } from "../schemas.js";

export interface LinkedInMaterial {
  /** Source URL we fetched, or the word "pdf" when the user uploaded a PDF. */
  source: string;
  /** Markdown / plain text content for agent consumption. */
  text: string;
}

const JINA_TIMEOUT_MS = 30_000;

/**
 * Attempt to fetch the user's LinkedIn profile via Jina Reader.
 * Returns null when no LinkedIn URL was provided, the fetch fails, or
 * the page content is clearly a login wall (< 800 chars and contains
 * "sign in to see").
 */
export async function fetchLinkedIn(session: ScanSession): Promise<LinkedInMaterial | null> {
  const url = session.socials.linkedin;
  if (!url) return null;

  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      redirect: "follow",
      headers: {
        Accept: "text/plain",
        "User-Agent": "GitShow/0.2 (+https://github.com/yatendrakumar/gitshow)",
      },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    if (
      text.length < 800 &&
      /sign\s*in|login|authwall|members only/i.test(text)
    ) {
      // LinkedIn returned a login wall. Surface a synthetic hint so the
      // agent can fall back to GitHub-only signals without pretending it
      // got LinkedIn content.
      return null;
    }
    return { source: url, text };
  } catch {
    return null;
  }
}

/**
 * Accept pre-extracted PDF content from the webapp upload path. The
 * webapp handles the actual PDF→text conversion (pdf-parse or
 * equivalent) because adding that dep to the worker is more weight than
 * it needs. If the extraction failed, caller passes null.
 *
 * TODO: wire into the webapp `/api/scan/pdf-upload` endpoint — it should
 * extract text server-side and forward it as CONTEXT_NOTES with a
 * `#linkedin-pdf` marker the worker can split on.
 */
export function parsePdfContent(text: string | null): LinkedInMaterial | null {
  if (!text || text.length < 200) return null;
  return { source: "pdf", text };
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
