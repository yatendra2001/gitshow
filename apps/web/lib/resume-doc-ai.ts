/**
 * ResumeDoc AI — generate and regenerate the printable resume from the
 * user's portfolio Resume.
 *
 * Models: Claude Sonnet 4.6 via OpenRouter, the same gateway the rest
 * of the pipeline uses (`OPENROUTER_API_KEY`). We hit OpenRouter's
 * /chat/completions endpoint directly — no SDK dependency.
 *
 * Why one big call for full generation? The whole document fits in a
 * single prompt + response (≤8K tokens), and a single call is cheaper
 * and faster than fan-out for a one-page resume.
 */

import type { Resume } from "@gitshow/shared/resume";
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

export { SYSTEM_PROMPT, SONNET_MODEL, OPENROUTER_URL };
export { distillResume };

const SONNET_MODEL = "anthropic/claude-sonnet-4.6";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You are an expert resume writer producing a one-page, ATS-friendly resume from a candidate's portfolio data.

Output rules — non-negotiable:
- No emoji, no decorative characters, no headers in bullet text.
- Bullets must be impact-first: action verb, what was done, quantified outcome where possible. ≤160 chars each.
- Action verbs vary across bullets within the same role. Never repeat the same opener twice in a row.
- Quantify with real numbers from the source data. If no numbers exist, lead with scope/scale words ("across", "for", "company-wide"). Never invent metrics.
- Cut filler: "responsible for", "tasks include", "worked on", "helped with". Use "Built", "Shipped", "Led", "Reduced", "Scaled", "Designed", "Drove".
- BOLD KEY METRICS: Wrap impact numbers in **markdown bold** so the recruiter's eye lands on them. Bold these things only:
    · percentages and ratios:           **62%**, **3x**, **40% lower**
    · scale and counts:                 **180M req/day**, **12M events**, **3 engineers**, **18 services**
    · time spans and savings:           **9 months**, **from 38min to 11min**
    · money / business impact:          **$2M ARR**, **$400k saved/yr**
  Do NOT bold filler, role titles, action verbs, tech names, or company names. One bullet typically has 1-2 bolded fragments — never the whole sentence.
- Each role: 3-5 bullets. Single-bullet roles are fine for short stints.
- Each project: 1-3 bullets. Total projects: 4 max.
- Skills: group into 3-5 categories ("Languages", "Frameworks", "Cloud & Infra", "Tools", "Data"). Comma-joined. ATS-friendly.
- Awards section: include ONLY when there are 3+ notable wins. Otherwise fold the top 1-2 wins into the matching project bullets.
- Education: keep concise. Honors/coursework only if material.
- Publications: include only if the user is a researcher with ≥1 peer-reviewed paper, talk, or preprint.
- Headline: one line, ≤90 chars. Job title or focus + 2-3 keywords. No clichés like "passionate", "results-driven".

Hard constraint: the entire document must fit on a single US Letter page at 10.5pt body, ~1in margins. Aim for ≤56 typeset lines total.

Return strict JSON matching this exact shape — no prose, no comments, no markdown fences:

{
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

/** Strip a JSON code fence if the model wraps the response. */
function unwrapJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  return trimmed;
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

async function callSonnet(
  apiKey: string,
  appUrl: string,
  userPrompt: string,
): Promise<string> {
  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // Per OpenRouter best-practices: identify the source app.
      "HTTP-Referer": appUrl || "https://gitshow.io",
      "X-Title": "gitshow",
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      // Keep deterministic-ish — resume bullets shouldn't roll the dice each load.
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`openrouter_${resp.status}: ${body.slice(0, 400)}`);
  }
  const data = (await resp.json()) as OpenRouterResponse;
  if (data.error) throw new Error(`openrouter_error: ${data.error.message}`);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("openrouter_empty");
  return content;
}

// ──────────────────────────────────────────────────────────────
// Source distillation — Resume → compact JSON for the prompt
// ──────────────────────────────────────────────────────────────

/**
 * The portfolio Resume carries verbose markdown prose, hero images,
 * build logs, and theme settings — all noise for the resume task.
 * We distill to the fields that matter for bullet generation, in a
 * compact shape the model can ingest without burning tokens.
 */
function distillResume(resume: Resume) {
  return {
    person: {
      name: resume.person.name,
      handle: resume.person.handle,
      location: resume.person.location ?? null,
      headline: resume.person.description ?? "",
    },
    contact: {
      email: resume.contact.email ?? null,
      tel: resume.contact.tel ?? null,
      socials: [
        resume.contact.socials.linkedin?.url,
        resume.contact.socials.github?.url,
        resume.contact.socials.x?.url,
        resume.contact.socials.website?.url,
        ...resume.contact.socials.other.map((s) => s.url),
      ]
        .filter(Boolean)
        .slice(0, 6),
    },
    skills: resume.skills.map((s) => ({
      name: s.name,
      score: s.score ?? null,
      usageCount: s.usageCount ?? null,
    })),
    work: resume.work.map((w) => ({
      id: w.id,
      company: w.company,
      title: w.title,
      start: w.start,
      end: w.end,
      location: w.location ?? null,
      description: w.description.slice(0, 1800),
      badges: w.badges,
    })),
    education: resume.education.map((e) => ({
      id: e.id,
      school: e.school,
      degree: e.degree,
      start: e.start,
      end: e.end,
    })),
    projects: resume.projects.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description.slice(0, 1500),
      dates: p.dates,
      technologies: p.technologies,
      url: p.href ?? p.links[0]?.href ?? null,
      userShare: p.userShare ?? null,
      userCommits: p.userCommits ?? null,
    })),
    hackathons: resume.hackathons.map((h) => ({
      id: h.id,
      title: h.title,
      date: h.date ?? null,
      rank: h.rank ?? null,
      description: (h.description ?? "").slice(0, 400),
    })),
    publications: resume.publications.map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.kind,
      venue: p.venue ?? null,
      publishedAt: p.publishedAt ?? null,
      coAuthors: p.coAuthors,
      url: p.url,
      summary: p.summary ?? null,
    })),
  };
}

// ──────────────────────────────────────────────────────────────
// Validation + ID stability
// ──────────────────────────────────────────────────────────────

interface RawResumeDoc {
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
 * Coerce the raw JSON the model returned into a ResumeDoc-shaped
 * draft, filling in meta/page/sections/schemaVersion that the AI
 * doesn't author. Lenient — accepts partial input and never throws.
 *
 * Used by the streaming endpoint so each partial-JSON tick can render
 * a valid-looking doc even when the model is mid-generation.
 */
export function coerceResumeDocFromAI(
  raw: unknown,
  sourceVersion: number,
): ResumeDoc {
  const r = (raw as RawResumeDoc) ?? {};
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
      .map((l) => ({
        label: l.label ?? "",
        url: l.url ?? "",
      })),
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
      bullets: (e.bullets ?? []).filter((b): b is string => typeof b === "string" && b.length > 0),
    }));

  const projects: ProjectDocEntry[] = (r.projects ?? [])
    .filter((p) => p && p.title)
    .map((p, i) => ({
      id: ensureId("proj", i, p.id),
      title: p.title ?? "",
      url: p.url || undefined,
      dates: p.dates || undefined,
      stack: p.stack || undefined,
      bullets: (p.bullets ?? []).filter((b): b is string => typeof b === "string" && b.length > 0),
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

  return {
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
      sourceVersion,
    },
  };
}

/**
 * Strict variant — used for the final write. Throws when the schema
 * validation fails so the caller knows the AI returned something the
 * editor can't safely persist.
 */
export function buildResumeDocFromAI(
  raw: unknown,
  sourceVersion: number,
): ResumeDoc {
  const draft = coerceResumeDocFromAI(raw, sourceVersion);
  const parsed = ResumeDocSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error(
      `resume_doc_validation: ${JSON.stringify(parsed.error.issues).slice(0, 600)}`,
    );
  }
  return parsed.data;
}

// ──────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────

export interface AiContext {
  apiKey: string;
  appUrl: string;
}

/**
 * Generate a fresh ResumeDoc from the user's portfolio Resume. One AI
 * call, returns a validated doc ready to write to R2.
 */
export async function generateResumeDoc(
  resume: Resume,
  ctx: AiContext,
): Promise<ResumeDoc> {
  const distilled = distillResume(resume);
  const userPrompt = `Generate a one-page resume from this portfolio data. Return JSON only.\n\nSource:\n${JSON.stringify(distilled, null, 2)}`;
  const raw = await callSonnet(ctx.apiKey, ctx.appUrl, userPrompt);
  const json = JSON.parse(unwrapJson(raw)) as unknown;
  return buildResumeDocFromAI(json, resume.meta.version ?? 0);
}

/**
 * Regenerate the bullets for a single experience entry. Keeps id +
 * company + title + dates frozen, returns a new bullets array. Used by
 * the per-entry "Regenerate" button in the editor.
 */
export async function regenerateExperienceBullets(
  entry: ExperienceEntry,
  resume: Resume,
  ctx: AiContext,
): Promise<string[]> {
  const sourceWork = resume.work.find((w) => w.id === entry.id);
  const sourceDescription = sourceWork?.description ?? "";

  const userPrompt = `Rewrite the impact bullets for ONE role on the resume. Return JSON: { "bullets": ["...", "..."] }.

Role:
- company: ${entry.company}
- title: ${entry.title}
- dates: ${entry.start} – ${entry.end}
- location: ${entry.location ?? "n/a"}

Source description from the candidate's portfolio (markdown allowed but DO NOT include markdown in the bullets):
"""
${sourceDescription}
"""

Existing bullets (rewrite, don't merely tweak):
${entry.bullets.map((b) => `- ${b}`).join("\n") || "(none)"}

Constraints:
- 3-5 bullets, action verb first, ≤160 chars each
- Vary verbs, no repeats
- Quantify with real numbers only — never invent
- Wrap key impact metrics in **markdown bold** (e.g. **62%**, **180M req/day**, **9 months**, **$2M ARR**). 1-2 bold fragments per bullet, never the whole sentence. Do not bold tech names, role titles, or company names.`;

  const raw = await callSonnet(ctx.apiKey, ctx.appUrl, userPrompt);
  const json = JSON.parse(unwrapJson(raw)) as { bullets?: unknown };
  const bullets = Array.isArray(json.bullets)
    ? json.bullets.filter((b): b is string => typeof b === "string" && b.trim().length > 0)
    : [];
  if (bullets.length === 0) throw new Error("regen_no_bullets");
  return bullets.slice(0, 5);
}
