/**
 * ResumeDoc — the data contract for the printable, ATS-friendly resume.
 *
 * This is a separate document from `Resume` (the portfolio JSON). The
 * portfolio carries rich markdown prose and visual chrome; the resume
 * is bullet-first, single-column, B&W, hard-capped at one page.
 *
 * Storage:
 *   - `resumes/{handle}/resume-doc.json` (R2)
 *   - One blob per user. We do not version draft/published — the resume
 *     is always the current export-ready document.
 *
 * Generation flow:
 *   1. User opens /app/resume.
 *   2. If no doc exists, the server generates one from the user's
 *      published Resume via Claude Sonnet 4.6 on OpenRouter.
 *   3. User can edit any field, reorder sections, or hit "Regenerate"
 *      on a single section to re-roll bullets without nuking the rest.
 *   4. Export → Cloudflare Browser Rendering produces a real PDF.
 *
 * Section design philosophy (locked with the user):
 *   - No avatar, no summary/about, no theme color, no decorative chrome.
 *   - Hard one-page cap; the renderer warns if content overflows.
 *   - Action-verb-first impact bullets, ≤160 chars each.
 *   - Awards section appears only when ≥3 wins; otherwise the AI folds
 *     notable wins into the matching project bullets.
 */

import * as z from "zod/v4";

// ──────────────────────────────────────────────────────────────
// Header — the topmost block (name + contact line)
// ──────────────────────────────────────────────────────────────

export const ResumeDocHeaderSchema = z.object({
  /** Full display name. */
  name: z.string().max(120),
  /** One-line headline shown under the name. e.g. "Senior Software Engineer · Distributed systems". */
  headline: z.string().max(160),
  location: z.string().max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  /**
   * Up to 4 short links printed inline on the contact line, e.g.
   * "linkedin.com/in/jane · github.com/jane · jane.dev". Each entry is
   * a short label-only string (the visible text) and an absolute URL.
   */
  links: z
    .array(
      z.object({
        label: z.string().max(80),
        url: z.string().url(),
      }),
    )
    .max(4)
    .default([]),
});
export type ResumeDocHeader = z.infer<typeof ResumeDocHeaderSchema>;

// ──────────────────────────────────────────────────────────────
// Experience
// ──────────────────────────────────────────────────────────────

export const ExperienceEntrySchema = z.object({
  id: z.string(),
  company: z.string().max(120),
  title: z.string().max(120),
  /** "May 2022", "Aug 2021", etc. */
  start: z.string().max(40),
  /** "Present" or "Oct 2024". */
  end: z.string().max(40),
  location: z.string().max(120).optional(),
  /**
   * Impact bullets. Action verb first, quantified when possible, ≤160
   * chars each. The renderer trims to 5 max for one-page fit.
   */
  bullets: z.array(z.string().max(240)).max(8).default([]),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

// ──────────────────────────────────────────────────────────────
// Education
// ──────────────────────────────────────────────────────────────

export const EducationDocEntrySchema = z.object({
  id: z.string(),
  school: z.string().max(120),
  degree: z.string().max(200),
  start: z.string().max(40),
  end: z.string().max(40),
  location: z.string().max(120).optional(),
  /** Optional one-liner for honors/coursework. */
  detail: z.string().max(240).optional(),
});
export type EducationDocEntry = z.infer<typeof EducationDocEntrySchema>;

// ──────────────────────────────────────────────────────────────
// Projects
// ──────────────────────────────────────────────────────────────

export const ProjectDocEntrySchema = z.object({
  id: z.string(),
  title: z.string().max(120),
  /** Optional public URL printed next to the title. */
  url: z.string().url().optional(),
  /** "Jan 2024 - Mar 2024" or "2025" — short. */
  dates: z.string().max(40).optional(),
  /** Comma-joined tech stack — kept compact for one-line render. */
  stack: z.string().max(200).optional(),
  /** 1-3 impact bullets. */
  bullets: z.array(z.string().max(240)).max(5).default([]),
});
export type ProjectDocEntry = z.infer<typeof ProjectDocEntrySchema>;

// ──────────────────────────────────────────────────────────────
// Skills (grouped)
// ──────────────────────────────────────────────────────────────

export const SkillGroupSchema = z.object({
  id: z.string(),
  /** "Languages", "Frameworks", "Tools", "Cloud", etc. */
  label: z.string().max(40),
  /** Comma-joined plain string for ATS friendliness. */
  items: z.string().max(400),
});
export type SkillGroup = z.infer<typeof SkillGroupSchema>;

// ──────────────────────────────────────────────────────────────
// Awards / Hackathons (compact)
// ──────────────────────────────────────────────────────────────

export const AwardEntrySchema = z.object({
  id: z.string(),
  /** "1st Place — Hack the North 2023" */
  title: z.string().max(200),
  /** "Sep 2023" — optional */
  date: z.string().max(40).optional(),
  /** Optional one-line context. */
  detail: z.string().max(240).optional(),
});
export type AwardEntry = z.infer<typeof AwardEntrySchema>;

// ──────────────────────────────────────────────────────────────
// Publications (researcher persona — only rendered when present)
// ──────────────────────────────────────────────────────────────

export const PublicationDocEntrySchema = z.object({
  id: z.string(),
  /** "Title. Co-authors. Venue, Year." in IEEE/APA style. */
  citation: z.string().max(500),
  /** Optional canonical URL/DOI for the citation. */
  url: z.string().url().optional(),
});
export type PublicationDocEntry = z.infer<typeof PublicationDocEntrySchema>;

// ──────────────────────────────────────────────────────────────
// Section order + visibility
// ──────────────────────────────────────────────────────────────

export const ResumeSectionKeySchema = z.enum([
  "experience",
  "projects",
  "education",
  "skills",
  "awards",
  "publications",
]);
export type ResumeSectionKey = z.infer<typeof ResumeSectionKeySchema>;

export const DEFAULT_RESUME_SECTION_ORDER: ResumeSectionKey[] = [
  "experience",
  "projects",
  "education",
  "skills",
  "awards",
  "publications",
];

export const ResumeSectionsConfigSchema = z.object({
  order: z
    .array(ResumeSectionKeySchema)
    .default(DEFAULT_RESUME_SECTION_ORDER),
  hidden: z.array(ResumeSectionKeySchema).default([]),
});
export type ResumeSectionsConfig = z.infer<typeof ResumeSectionsConfigSchema>;

// ──────────────────────────────────────────────────────────────
// Meta
// ──────────────────────────────────────────────────────────────

export const ResumeDocMetaSchema = z.object({
  version: z.number().int().nonnegative().default(0),
  updatedAt: z.string(),
  /** ISO timestamp of the most recent AI generation pass. */
  generatedAt: z.string().optional(),
  /** Source `Resume.meta.version` we generated from — lets the UI prompt "regenerate?" when the portfolio changes. */
  sourceVersion: z.number().int().nonnegative().optional(),
});
export type ResumeDocMeta = z.infer<typeof ResumeDocMetaSchema>;

// ──────────────────────────────────────────────────────────────
// Page settings
// ──────────────────────────────────────────────────────────────

export const ResumeDocPageSchema = z.object({
  /** US Letter is the safer ATS default in NA; A4 elsewhere. */
  size: z.enum(["letter", "a4"]).default("letter"),
});
export type ResumeDocPage = z.infer<typeof ResumeDocPageSchema>;

// ──────────────────────────────────────────────────────────────
// Root document
// ──────────────────────────────────────────────────────────────

export const ResumeDocSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  header: ResumeDocHeaderSchema,
  experience: z.array(ExperienceEntrySchema).max(20).default([]),
  projects: z.array(ProjectDocEntrySchema).max(20).default([]),
  education: z.array(EducationDocEntrySchema).max(10).default([]),
  skills: z.array(SkillGroupSchema).max(8).default([]),
  awards: z.array(AwardEntrySchema).max(20).default([]),
  publications: z.array(PublicationDocEntrySchema).max(40).default([]),
  page: ResumeDocPageSchema.default({ size: "letter" }),
  sections: ResumeSectionsConfigSchema.default({
    order: DEFAULT_RESUME_SECTION_ORDER,
    hidden: [],
  }),
  meta: ResumeDocMetaSchema,
});
export type ResumeDoc = z.infer<typeof ResumeDocSchema>;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

export function visibleResumeSections(doc: ResumeDoc): ResumeSectionKey[] {
  const hidden = new Set(doc.sections.hidden);
  return doc.sections.order.filter((k) => !hidden.has(k));
}

/**
 * Flat AI-grade content count — used by the editor to surface a live
 * "fits one page" warning. The numbers are calibrated against a Letter
 * page with the print stylesheet at 10.5pt body, ~1in margins.
 *
 * This is a heuristic, not a layout pass — it's good enough to nudge
 * the user before they render the PDF and find out the hard way.
 */
export function estimateContentLines(doc: ResumeDoc): number {
  let lines = 4; // header (name + headline + 2 lines for contact/links)
  const visible = visibleResumeSections(doc);

  for (const key of visible) {
    if (key === "experience" && doc.experience.length) {
      lines += 1; // section header
      for (const e of doc.experience) {
        lines += 2; // company/title + date row
        lines += e.bullets.length;
      }
    } else if (key === "projects" && doc.projects.length) {
      lines += 1;
      for (const p of doc.projects) {
        lines += 1 + (p.stack ? 1 : 0); // title + optional stack line
        lines += p.bullets.length;
      }
    } else if (key === "education" && doc.education.length) {
      lines += 1;
      for (const e of doc.education) {
        lines += 1 + (e.detail ? 1 : 0);
      }
    } else if (key === "skills" && doc.skills.length) {
      lines += 1 + doc.skills.length;
    } else if (key === "awards" && doc.awards.length) {
      lines += 1 + doc.awards.length;
    } else if (key === "publications" && doc.publications.length) {
      lines += 1;
      for (const p of doc.publications) {
        // citations wrap to ~2 lines on average
        lines += 2;
      }
    }
  }
  return lines;
}

/**
 * Approximate page-fit threshold for Letter @ 10.5pt body / 1in margins.
 * Empirically about 56-58 typeset lines fit. We pick 56 to leave a hair
 * of safety margin; the printable preview is what actually rules.
 */
export const ONE_PAGE_LINE_BUDGET = 56;
