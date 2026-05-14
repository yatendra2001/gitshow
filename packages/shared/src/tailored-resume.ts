/**
 * TailoredResume — a `ResumeDoc` regenerated against a specific job
 * description, plus the metadata we need to display it in the editor's
 * "Tailored versions" list.
 *
 * Storage:
 *   - `resumes/{handle}/tailored/{id}.json`     — one blob per tailored variant
 *   - `resumes/{handle}/tailored/index.json`    — light index for the list view
 *
 * Why a separate doc (not a new field on `ResumeDoc`)? The base resume
 * is the user's general-purpose, ATS-safe template they keep curating.
 * Tailored variants are *derived* — generated from the base + a JD —
 * and the user is expected to accumulate several over time. Treating
 * them as siblings keeps the base editor focused and the variants
 * deletable/regenerable without touching the canonical doc.
 */

import * as z from "zod/v4";
import { ResumeDocSchema } from "./resume-doc";

// ──────────────────────────────────────────────────────────────
// Metadata shown in the list view
// ──────────────────────────────────────────────────────────────

export const TailoredResumeMetaSchema = z.object({
  id: z.string().max(64),
  /** "Senior Backend Engineer". Extracted by the AI from the JD; user can rename later. */
  jobTitle: z.string().max(160).optional(),
  /** "Stripe". Extracted by the AI from the JD; optional. */
  company: z.string().max(160).optional(),
  /** First ~280 chars of the JD — shown as a one-line preview in the list. */
  jdExcerpt: z.string().max(400),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** `ResumeDoc.meta.version` of the base resume this was tailored from. */
  baseSourceVersion: z.number().int().nonnegative().optional(),
});
export type TailoredResumeMeta = z.infer<typeof TailoredResumeMetaSchema>;

// ──────────────────────────────────────────────────────────────
// Full tailored doc — meta + ResumeDoc + original JD
// ──────────────────────────────────────────────────────────────

export const TailoredResumeSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  meta: TailoredResumeMetaSchema,
  doc: ResumeDocSchema,
  /**
   * The full JD text the user pasted. Stored so the user can
   * re-tailor with the same JD later (or skim what they targeted).
   * Capped at 16k chars — generous for even verbose JDs.
   */
  jobDescription: z.string().max(16_000),
});
export type TailoredResume = z.infer<typeof TailoredResumeSchema>;

// ──────────────────────────────────────────────────────────────
// Index — the cheap lookup for the list pane
// ──────────────────────────────────────────────────────────────

export const TailoredResumeIndexSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  items: z.array(TailoredResumeMetaSchema).max(200).default([]),
});
export type TailoredResumeIndex = z.infer<typeof TailoredResumeIndexSchema>;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/** Build a JD excerpt for the list view. Strips whitespace + caps length. */
export function buildJdExcerpt(jd: string, max = 280): string {
  const collapsed = jd.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + "…";
}

/** Compact display label: "{title} · {company}" with sensible fallbacks. */
export function tailoredDisplayLabel(meta: TailoredResumeMeta): string {
  const title = meta.jobTitle?.trim();
  const company = meta.company?.trim();
  if (title && company) return `${title} · ${company}`;
  if (title) return title;
  if (company) return company;
  return "Tailored resume";
}
