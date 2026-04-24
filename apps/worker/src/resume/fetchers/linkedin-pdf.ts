/**
 * linkedin-pdf fetcher — Tier 4.
 *
 * Consumes pre-extracted PDF text (the webapp uses pdf-parse server-side
 * and stores the result on `scans.linkedin_pdf_text` in D1). When the
 * user has uploaded their LinkedIn "Save to PDF" export, this is the
 * highest-confidence source — so we mark facts with confidence=high.
 *
 * Uses Sonnet (section tier) because PDF text salvage benefits from
 * careful structural parsing. Bulk (Kimi) struggles with multi-column
 * PDF extraction noise.
 */

import {
  LinkedInExtractionSchema,
  buildFacts,
  emitFactsToTrace,
} from "./linkedin-public.js";
import { runAgentWithSubmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import type { TypedFact } from "@gitshow/shared/kg";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";

export interface FetcherInput {
  session: ScanSession;
  usage: SessionUsage;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
  /** Pre-extracted PDF text from scans.linkedin_pdf_text. */
  pdfText?: string;
}

const MIN_PDF_CHARS = 200;

const SYSTEM_PROMPT = `You convert a LinkedIn PDF export's text into structured JSON.

The input is noisy PDF text — multi-column layouts, garbled ordering, page footers. Your job is to salvage the real profile data.

Return positions (experience), educations, skills, bio, location.

Rules:
- Extract only facts stated in the text. Never invent.
- For "present" positions, set present=true and leave end empty.
- Dates: preserve "May 2021", "2020 - Present" verbatim. If only a year is present use that.
- Drop page numbers, "www.linkedin.com/in/..." URL footers, and duplicate contact blocks.
- Skills: max 50, prefer the named Skills section over keywords scraped from bullet points.

Call submit_linkedin_extraction exactly once.`;

export async function runLinkedInPdfFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const label = "linkedin-pdf";
  const t0 = Date.now();
  const log = input.onProgress ?? (() => {});
  const trace = input.trace;
  const text = input.pdfText;

  trace?.fetcherStart({
    label,
    input: { hasText: !!text, chars: text?.length ?? 0 },
  });

  if (!text || text.length < MIN_PDF_CHARS) {
    trace?.linkedInTierAttempt({
      tier: 4,
      method: "pdf",
      ok: false,
      durationMs: Date.now() - t0,
      reason: text ? `too-short:${text.length}` : "no-text",
    });
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  try {
    const { result: extraction } = await runAgentWithSubmit({
      model: modelForRole("section"),
      systemPrompt: SYSTEM_PROMPT,
      input: `## LinkedIn PDF text (user upload)\n\n${text.slice(0, 60_000)}\n\n---\nExtract positions, educations, skills, bio, location. Call submit_linkedin_extraction.`,
      submitToolName: "submit_linkedin_extraction",
      submitToolDescription:
        "Submit the extracted LinkedIn data. Call exactly once.",
      submitSchema: LinkedInExtractionSchema,
      reasoning: { effort: "low" },
      session: input.session,
      usage: input.usage,
      label: "fetcher:linkedin-pdf",
      onProgress: log,
      trace,
    });

    const facts = buildFacts({
      extraction,
      url: undefined,
      label: "linkedin-pdf",
      confidence: "high",
    });

    trace?.linkedInTierAttempt({
      tier: 4,
      method: "pdf",
      ok: true,
      durationMs: Date.now() - t0,
    });
    trace?.linkedInFactsEmitted({
      tier: 4,
      positions: extraction.positions.length,
      educations: extraction.educations.length,
      skills: extraction.skills.length,
    });
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
    trace?.linkedInTierAttempt({
      tier: 4,
      method: "pdf",
      ok: false,
      durationMs: Date.now() - t0,
      reason: `threw: ${msg}`,
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
