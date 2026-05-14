/**
 * Tailored-resume AI — regenerate the user's base `ResumeDoc` against
 * a specific job description.
 *
 * Same model and gateway as `resume-doc-ai.ts` (Claude Sonnet 4.6 via
 * OpenRouter) but with a system prompt that pivots the task from
 * "summarize this portfolio" to "tailor this resume to this JD".
 *
 * What "tailoring" actually does:
 *   - Reorders experience bullets so the JD-relevant ones lead.
 *   - Reorders/prunes the projects list — top 3-4 most-relevant first.
 *   - Rewrites bullets to use the JD's vocabulary where the underlying
 *     fact supports it (no fabrication — that's a non-negotiable).
 *   - Regroups skills so the JD's required skills lead each group.
 *   - Tightens the headline to match the target role.
 *   - Extracts the job title + company from the JD into the meta layer
 *     so the list view in the editor has labels without a second call.
 *
 * Output shape:
 *   {
 *     "jobTitle": "Senior Backend Engineer",
 *     "company": "Stripe",
 *     "header": { ... ResumeDocHeader },
 *     "experience": [ ... ExperienceEntry ],
 *     "projects":   [ ... ProjectDocEntry ],
 *     "education":  [ ... EducationDocEntry ],
 *     "skills":     [ ... SkillGroup ],
 *     "awards":     [ ... AwardEntry ],
 *     "publications":[ ... PublicationDocEntry ]
 *   }
 *
 * The route splits `jobTitle` + `company` into the wrapping
 * `TailoredResume.meta`, and validates the rest as a `ResumeDoc`.
 */

import {
  type ResumeDoc,
  type ExperienceEntry,
  type ProjectDocEntry,
  type EducationDocEntry,
  type SkillGroup,
  type AwardEntry,
  type PublicationDocEntry,
  type ResumeDocHeader,
  ResumeDocSchema,
  DEFAULT_RESUME_SECTION_ORDER,
} from "@gitshow/shared/resume-doc";

export const TAILOR_SONNET_MODEL = "anthropic/claude-sonnet-4.6";
export const TAILOR_OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

export const TAILOR_SYSTEM_PROMPT = `You are an expert resume writer tailoring a candidate's existing one-page resume to a specific job description.

Two inputs arrive in the user message:
  1) BASE_RESUME — the candidate's existing, ATS-friendly resume (JSON ResumeDoc).
  2) JOB_DESCRIPTION — the role to tailor against (plain text).

Your job is to produce a NEW one-page resume that is the strongest possible match for the JD, using ONLY facts that already exist in the base resume. This is a tailoring task, not a fabrication task.

Tailoring rules — hard:
- NEVER invent companies, titles, dates, metrics, projects, skills, schools, or awards. If it isn't in the base resume, it doesn't go in the tailored one.
- Reorder experience bullets so the JD-relevant ones lead. You may rewrite bullets to use the JD's vocabulary where the underlying fact supports it (e.g. base says "shipped service handling 180M req/day on K8s", JD asks about "distributed systems at scale" → keep the metric, lean on the JD's wording).
- Reorder + prune projects: keep the 3-4 most JD-relevant projects in priority order. Drop ones that don't match.
- Regroup skills so JD-required skills lead each group. Don't add skills the base doesn't have. Don't drop key skills from the base just because the JD doesn't mention them — recruiters skim these.
- Tighten the headline to match the target role. ≤90 chars. Job title + 2-3 keywords. No "passionate", "results-driven".
- Education + publications: keep verbatim unless the JD strongly suggests pruning (e.g. JD is for a software role, don't drop a CS degree).
- Awards: keep only if there are ≥3 wins relevant to the JD; otherwise fold the best one into the matching project bullet.

Output rules — same as the base generator:
- No emoji, no decorative characters, no headers in bullet text.
- Bullets impact-first: action verb, what was done, quantified outcome where possible. ≤160 chars each.
- Action verbs vary; no repeated openers.
- Quantify with real numbers from the base resume. Never invent metrics.
- BOLD KEY METRICS: wrap impact numbers in **markdown bold**:
    · percentages and ratios:           **62%**, **3x**, **40% lower**
    · scale and counts:                 **180M req/day**, **12M events**, **3 engineers**, **18 services**
    · time spans and savings:           **9 months**, **from 38min to 11min**
    · money / business impact:          **$2M ARR**, **$400k saved/yr**
  Do NOT bold filler, role titles, action verbs, tech names, or company names. One bullet typically has 1-2 bolded fragments — never the whole sentence.
- Each role: 3-5 bullets. Single-bullet roles are fine for short stints.
- Each project: 1-3 bullets. Total projects: 4 max.
- Skills: 3-5 groups, comma-joined per group.
- Awards: include only if ≥3 wins. Otherwise fold the top win into a project bullet.

Hard constraint: one US Letter page at 10.5pt body, ~1in margins. Aim for ≤56 typeset lines total.

Extract from the JD into the top-level output:
- "jobTitle" — the exact target role title from the JD (e.g. "Senior Backend Engineer"). If the JD has no clear title, return "" — do not invent.
- "company"  — the hiring company name from the JD (e.g. "Stripe"). If absent, return "" — do not invent.

Return strict JSON, no prose, no comments, no markdown fences:

{
  "jobTitle": "string",
  "company": "string",
  "header": {
    "name": "string",
    "headline": "string",
    "location": "string?",
    "email": "string?",
    "phone": "string?",
    "links": [{ "label": "linkedin.com/in/jane", "url": "https://..." }]
  },
  "experience": [{
    "id": "stable-string",
    "company": "string",
    "title": "string",
    "start": "May 2022",
    "end": "Present",
    "location": "string?",
    "bullets": ["..."]
  }],
  "projects": [{
    "id": "stable-string",
    "title": "string",
    "url": "https://...?",
    "dates": "2024",
    "stack": "TypeScript, Next.js, Postgres",
    "bullets": ["..."]
  }],
  "education": [{
    "id": "stable-string",
    "school": "string",
    "degree": "string",
    "start": "2018",
    "end": "2022",
    "location": "string?",
    "detail": "string?"
  }],
  "skills": [{ "id": "stable-string", "label": "Languages", "items": "TypeScript, Go, Python" }],
  "awards": [{ "id": "stable-string", "title": "1st Place — Hack The North", "date": "Sep 2023", "detail": "string?" }],
  "publications": [{ "id": "stable-string", "citation": "Doe J. et al. Title. Venue, 2023.", "url": "https://...?" }]
}`;

// ──────────────────────────────────────────────────────────────
// Raw → ResumeDoc coercion (mirrors resume-doc-ai.ts)
// ──────────────────────────────────────────────────────────────

interface RawTailored {
  jobTitle?: string;
  company?: string;
  header?: Partial<ResumeDocHeader>;
  experience?: Partial<ExperienceEntry>[];
  projects?: Partial<ProjectDocEntry>[];
  education?: Partial<EducationDocEntry>[];
  skills?: Partial<SkillGroup>[];
  awards?: Partial<AwardEntry>[];
  publications?: Partial<PublicationDocEntry>[];
}

function ensureId(prefix: string, idx: number, candidate: unknown): string {
  if (typeof candidate === "string" && candidate.trim()) return candidate;
  return `${prefix}-${idx}`;
}

/**
 * Coerce raw AI JSON into a `ResumeDoc`-shaped draft plus the
 * extracted `jobTitle` / `company`. Lenient — accepts partial input
 * and never throws, so the streaming endpoint can render mid-flight
 * partials safely.
 */
export function coerceTailoredFromAI(
  raw: unknown,
  baseSourceVersion: number,
): { doc: ResumeDoc; jobTitle?: string; company?: string } {
  const r = (raw as RawTailored) ?? {};
  const now = new Date().toISOString();

  const header: ResumeDocHeader = {
    name: r.header?.name ?? "",
    headline: r.header?.headline ?? "",
    location: r.header?.location || undefined,
    email: r.header?.email || undefined,
    phone: r.header?.phone || undefined,
    links: (r.header?.links ?? [])
      .slice(0, 4)
      .filter((l) => l && (l.label || l.url))
      .map((l) => ({ label: l.label ?? "", url: l.url ?? "" })),
  };

  const experience: ExperienceEntry[] = (r.experience ?? [])
    .filter((e) => e && (e.company || e.title))
    .map((e, i) => ({
      id: ensureId("exp", i, e.id),
      company: e.company ?? "",
      title: e.title ?? "",
      start: e.start ?? "",
      end: e.end ?? "",
      location: e.location || undefined,
      bullets: (e.bullets ?? []).filter(
        (b): b is string => typeof b === "string" && b.length > 0,
      ),
    }));

  const projects: ProjectDocEntry[] = (r.projects ?? [])
    .filter((p) => p && p.title)
    .map((p, i) => ({
      id: ensureId("proj", i, p.id),
      title: p.title ?? "",
      url: p.url || undefined,
      dates: p.dates || undefined,
      stack: p.stack || undefined,
      bullets: (p.bullets ?? []).filter(
        (b): b is string => typeof b === "string" && b.length > 0,
      ),
    }));

  const education: EducationDocEntry[] = (r.education ?? [])
    .filter((e) => e && (e.school || e.degree))
    .map((e, i) => ({
      id: ensureId("edu", i, e.id),
      school: e.school ?? "",
      degree: e.degree ?? "",
      start: e.start ?? "",
      end: e.end ?? "",
      location: e.location || undefined,
      detail: e.detail || undefined,
    }));

  const skills: SkillGroup[] = (r.skills ?? [])
    .filter((s) => s && (s.label || s.items))
    .map((s, i) => ({
      id: ensureId("skill", i, s.id),
      label: s.label ?? "",
      items: s.items ?? "",
    }));

  const awards: AwardEntry[] = (r.awards ?? [])
    .filter((a) => a && a.title)
    .map((a, i) => ({
      id: ensureId("award", i, a.id),
      title: a.title ?? "",
      date: a.date || undefined,
      detail: a.detail || undefined,
    }));

  const publications: PublicationDocEntry[] = (r.publications ?? [])
    .filter((p) => p && p.citation)
    .map((p, i) => ({
      id: ensureId("pub", i, p.id),
      citation: p.citation ?? "",
      url: p.url || undefined,
    }));

  const doc: ResumeDoc = {
    schemaVersion: 1 as const,
    header,
    experience,
    projects,
    education,
    skills,
    awards,
    publications,
    page: { size: "letter" as const },
    sections: {
      order: DEFAULT_RESUME_SECTION_ORDER,
      hidden: [] as never[],
    },
    meta: {
      version: 0,
      updatedAt: now,
      generatedAt: now,
      sourceVersion: baseSourceVersion,
    },
  };

  const jobTitle =
    typeof r.jobTitle === "string" && r.jobTitle.trim()
      ? r.jobTitle.trim().slice(0, 160)
      : undefined;
  const company =
    typeof r.company === "string" && r.company.trim()
      ? r.company.trim().slice(0, 160)
      : undefined;

  return { doc, jobTitle, company };
}

/**
 * Strict variant — validates the coerced doc against the ResumeDoc
 * schema. Used for the final write so an invalid AI response is a
 * proper error, not a malformed file in R2.
 */
export function buildTailoredFromAI(
  raw: unknown,
  baseSourceVersion: number,
): { doc: ResumeDoc; jobTitle?: string; company?: string } {
  const draft = coerceTailoredFromAI(raw, baseSourceVersion);
  const parsed = ResumeDocSchema.safeParse(draft.doc);
  if (!parsed.success) {
    throw new Error(
      `tailored_resume_validation: ${JSON.stringify(parsed.error.issues).slice(0, 600)}`,
    );
  }
  return { doc: parsed.data, jobTitle: draft.jobTitle, company: draft.company };
}

/**
 * Build the user-message body for the tailoring call. Keeps the
 * formatting consistent across the streaming and non-streaming paths.
 */
export function buildTailorUserPrompt(
  base: ResumeDoc,
  jobDescription: string,
): string {
  // Strip the base doc's meta — the AI doesn't need bookkeeping fields
  // and we save tokens. Sections config is also irrelevant to tailoring.
  const distilled = {
    header: base.header,
    experience: base.experience,
    projects: base.projects,
    education: base.education,
    skills: base.skills,
    awards: base.awards,
    publications: base.publications,
  };
  // JDs from job boards routinely include legal boilerplate, salary
  // ranges, and EEO copy that's noise for the model. We pass the full
  // text rather than try to clean it — the prompt's tailoring rules
  // tell the model to focus on responsibilities + requirements, and
  // we cap length on the schema layer (16k chars).
  return `Tailor this resume to the job below. Return JSON only.

BASE_RESUME:
${JSON.stringify(distilled, null, 2)}

JOB_DESCRIPTION:
"""
${jobDescription}
"""`;
}
