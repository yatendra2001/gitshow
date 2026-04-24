/**
 * Resume — the data contract for a gitshow portfolio.
 *
 * Every user's portfolio is a single `Resume` JSON blob in R2, rendered by
 * the portfolio template at `/{handle}`. Sections are data-driven: the
 * editor mutates this object; publishing copies draft → published.
 *
 * Two render surfaces consume this:
 *   1. Server render at `/{handle}` → full page via section components.
 *   2. Editor at `/app/edit` → form mutations that write back to R2.
 *
 * The schema mirrors the `DATA` object shape of the portfolio template at
 * `portfolio/src/data/resume.tsx`, with some additions:
 *   - `buildLog` — all-repos timeline (reuses the template's hackathons
 *      section under the "I like building things" headline).
 *   - `blog` — imported verbatim from external sources (Medium, dev.to, …).
 *   - `sections` — user-controlled order + hidden list.
 *   - `meta.sourceTags` — tracks which fields are AI-generated vs
 *      user-authored vs GitHub-provided, so the editor can label each one.
 *
 * Icons don't round-trip through JSON — we store `iconKey` strings and map
 * them to React components at render time.
 */

import * as z from "zod/v4";

// ──────────────────────────────────────────────────────────────
// Shared primitives
// ──────────────────────────────────────────────────────────────

/**
 * URL or site-relative path. Media fields (`avatarUrl`, `logoUrl`,
 * `image`, `video`) accept either an absolute URL (http/https/data) or
 * a root-relative path beginning with `/` — the latter is what the
 * upload endpoint returns in dev and in production without a CDN base
 * URL (`/r2/assets/{id}/{name}.png`). Anything else is rejected.
 */
const UrlOrPath = z
  .string()
  .refine(
    (v) =>
      v === "" ||
      v.startsWith("/") ||
      /^(https?:|data:|blob:)/i.test(v),
    {
      message:
        "Expected an absolute URL or a path starting with '/'",
    },
  );

// ──────────────────────────────────────────────────────────────
// Link + icon primitives
// ──────────────────────────────────────────────────────────────

/**
 * Canonical icon keys for links, socials, and project CTAs. Matches the
 * icon registry in `apps/web/components/portfolio/icons.tsx`. `custom`
 * is the escape hatch — pair with `iconUrl` for a bespoke mark.
 */
export const IconKeySchema = z.enum([
  "github",
  "linkedin",
  "x",
  "twitter",
  "youtube",
  "email",
  "globe",
  "website",
  "instagram",
  "tiktok",
  "discord",
  "telegram",
  "mastodon",
  "bluesky",
  "producthunt",
  "devto",
  "medium",
  "hashnode",
  "substack",
  "generic",
  "custom",
]);
export type IconKey = z.infer<typeof IconKeySchema>;

export const LinkSchema = z.object({
  /** Short label — "Website", "Source", "Live demo", "Devpost". */
  label: z.string().max(40),
  href: z.string().url(),
  /** Canonical key; default "generic". */
  iconKey: IconKeySchema.default("generic"),
  /** When iconKey === "custom", an absolute URL to a square icon. */
  iconUrl: z.string().url().optional(),
});
export type Link = z.infer<typeof LinkSchema>;

export const SocialLinkSchema = z.object({
  /** Display name the dock/tooltip uses ("GitHub", "Twitter"). */
  name: z.string().max(40),
  url: z.string().url(),
  iconKey: IconKeySchema,
  /** Whether to show in the floating dock navbar. */
  navbar: z.boolean().default(true),
});
export type SocialLink = z.infer<typeof SocialLinkSchema>;

// ──────────────────────────────────────────────────────────────
// Person / identity
// ──────────────────────────────────────────────────────────────

export const PersonSchema = z.object({
  name: z.string().max(120),
  /** GitHub handle — becomes the public URL slug `/{handle}`. */
  handle: z.string().max(60),
  /** 2-letter avatar fallback, derived from name but stored so the AI can customise. */
  initials: z.string().max(4),
  /** Absolute URL or site-relative path (`/r2/...`) to the avatar. */
  avatarUrl: UrlOrPath.optional(),
  location: z.string().max(120).optional(),
  /** One-line bio shown under the name in the hero. */
  description: z.string().max(280),
  /**
   * About-section paragraph. Markdown, may contain inline links.
   * The AI is instructed to cross-link key phrases to other sections
   * of the portfolio, e.g. `[pursued a double degree](/#education)`.
   */
  summary: z.string().max(4000),
  /** Canonical personal URL (optional — shown near hero). */
  url: z.string().url().optional(),
});
export type Person = z.infer<typeof PersonSchema>;

// ──────────────────────────────────────────────────────────────
// Contact + socials
// ──────────────────────────────────────────────────────────────

export const ContactSchema = z.object({
  email: z.string().email().optional(),
  tel: z.string().max(40).optional(),
  /**
   * Keyed by canonical platform name for convenience; free-form `other`
   * holds user-added links the template doesn't know about by default.
   */
  socials: z.object({
    github: SocialLinkSchema.optional(),
    linkedin: SocialLinkSchema.optional(),
    x: SocialLinkSchema.optional(),
    youtube: SocialLinkSchema.optional(),
    website: SocialLinkSchema.optional(),
    email: SocialLinkSchema.optional(),
    other: z.array(SocialLinkSchema).default([]),
  }),
});
export type Contact = z.infer<typeof ContactSchema>;

// ──────────────────────────────────────────────────────────────
// Skills
// ──────────────────────────────────────────────────────────────

export const SkillSchema = z.object({
  name: z.string().max(40),
  /**
   * Key into the template's tech-icon registry (React, Next.js, etc.).
   * When unknown we still render the name pill without an icon.
   */
  iconKey: z.string().max(40).optional(),
});
export type Skill = z.infer<typeof SkillSchema>;

// ──────────────────────────────────────────────────────────────
// Work experience
// ──────────────────────────────────────────────────────────────

export const WorkEntrySchema = z.object({
  id: z.string(),
  company: z.string().max(120),
  title: z.string().max(120),
  /** Free-form month/year like "May 2021". Stored as string to match template copy. */
  start: z.string().max(40),
  /** "Oct 2022" or "Present". */
  end: z.string().max(40),
  location: z.string().max(120).optional(),
  /** Uploaded or Clearbit-fetched logo. Missing → initials fallback. */
  logoUrl: UrlOrPath.optional(),
  /** Markdown, rendered with react-markdown in the accordion body. */
  description: z.string().max(2000),
  href: z.string().url().optional(),
  badges: z.array(z.string().max(40)).default([]),
});
export type WorkEntry = z.infer<typeof WorkEntrySchema>;

// ──────────────────────────────────────────────────────────────
// Education
// ──────────────────────────────────────────────────────────────

export const EducationEntrySchema = z.object({
  id: z.string(),
  school: z.string().max(120),
  degree: z.string().max(200),
  start: z.string().max(40),
  end: z.string().max(40),
  logoUrl: UrlOrPath.optional(),
  href: z.string().url().optional(),
});
export type EducationEntry = z.infer<typeof EducationEntrySchema>;

// ──────────────────────────────────────────────────────────────
// Projects — the curated featured grid (top ~20)
// ──────────────────────────────────────────────────────────────

/** Project kind — `research-artifact` is for researcher personas (deferred image-first variant per §19.1). */
export const ProjectKindSchema = z.enum(["code", "research-artifact"]);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

export const ProjectMediaSchema = z.object({
  /** R2 URL or absolute hero image (1200×630). */
  hero: UrlOrPath.optional(),
  /** Optional thumbnails (square 400×400). */
  thumb: UrlOrPath.optional(),
  /** Up to 6 additional screenshots, R2-hosted. */
  screenshots: z.array(UrlOrPath).max(6).default([]),
  /** Origin of the hero asset — useful for the editor + future "regenerate" UI. */
  heroOrigin: z
    .enum(["og", "readme", "youtube", "generated", "user-upload"])
    .optional(),
});
export type ProjectMedia = z.infer<typeof ProjectMediaSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  title: z.string().max(120),
  /** Markdown description — may contain links and short inline formatting. */
  description: z.string().max(2000),
  /** Date range string, e.g. "Jan 2024 - Feb 2024" or "June 2023 - Present". */
  dates: z.string().max(80),
  active: z.boolean().default(false),
  technologies: z.array(z.string().max(40)).max(20).default([]),
  links: z.array(LinkSchema).max(10).default([]),
  /**
   * Featured media — image (png/jpg/gif) OR video (mp4) OR both.
   * Priority at render time: video > image > social-preview fallback.
   */
  image: UrlOrPath.optional(),
  video: UrlOrPath.optional(),
  /** Primary canonical link used when the whole card is clickable. */
  href: z.string().url().optional(),
  /** §3.2 — distinguishes code projects from research artifacts. Default "code". */
  kind: ProjectKindSchema.default("code"),
  /** Hero/thumbnails sourced via the media pipeline. */
  media: ProjectMediaSchema.optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

// ──────────────────────────────────────────────────────────────
// Hackathons — Achievement nodes with kind=hackathon, projected per §9.1
// ──────────────────────────────────────────────────────────────

export const HackathonEntrySchema = z.object({
  id: z.string(),
  title: z.string().max(200),
  date: z.string().max(40).optional(),
  description: z.string().max(800).optional(),
  location: z.string().max(120).optional(),
  rank: z.string().max(80).optional(),
  sources: z
    .array(
      z.object({
        label: z.string().max(40),
        href: z.string().url(),
      }),
    )
    .max(6)
    .default([]),
});
export type HackathonEntry = z.infer<typeof HackathonEntrySchema>;

// ──────────────────────────────────────────────────────────────
// Publications — research papers, talks, podcasts (researcher persona)
// ──────────────────────────────────────────────────────────────

export const PublicationKindSchema = z.enum([
  "paper",
  "preprint",
  "talk",
  "podcast",
  "video",
]);
export type PublicationKind = z.infer<typeof PublicationKindSchema>;

export const PublicationEntrySchema = z.object({
  id: z.string(),
  title: z.string().max(400),
  kind: PublicationKindSchema,
  /** Conference, journal, podcast host, etc. */
  venue: z.string().max(200).optional(),
  publishedAt: z.string().max(40).optional(),
  url: z.string().url(),
  doi: z.string().max(200).optional(),
  coAuthors: z.array(z.string().max(120)).max(20).default([]),
  /** Optional summary line for the card. */
  summary: z.string().max(600).optional(),
});
export type PublicationEntry = z.infer<typeof PublicationEntrySchema>;

// ──────────────────────────────────────────────────────────────
// Build-log entry — one row in "I like building things" timeline
// ──────────────────────────────────────────────────────────────
//
// Reuses the template's hackathons-section visual pattern, but populated
// from every meaningful repo (not just hackathons). Rendering uses a
// language-colored dot instead of an image per item to keep the section
// fast even with 100+ entries.

export const BuildLogEntrySchema = z.object({
  id: z.string(),
  /** Repo friendly name or event title ("Hack The North"). */
  title: z.string().max(120),
  /** "Sep 2023" or "Nov 23-25 2018" — free-form, short. */
  dates: z.string().max(80),
  /** One-liner description. Plain text, no markdown. */
  description: z.string().max(400),
  /** Primary GitHub language for color-dot; falls back to neutral. */
  primaryLanguage: z.string().max(40).optional(),
  /** Hex color for timeline dot — precomputed from language. */
  languageColor: z.string().max(20).optional(),
  /** Event location (only used for actual hackathons / talks). */
  location: z.string().max(120).optional(),
  /** Win label — "1st Place Winner", "Best Data Hack". */
  win: z.string().max(80).optional(),
  /** Optional image — only used when an actual hackathon badge exists. */
  image: UrlOrPath.optional(),
  links: z.array(LinkSchema).max(6).default([]),
});
export type BuildLogEntry = z.infer<typeof BuildLogEntrySchema>;

// ──────────────────────────────────────────────────────────────
// Blog — imported from external sources
// ──────────────────────────────────────────────────────────────

export const BlogPostSchema = z.object({
  slug: z
    .string()
    .max(120)
    .regex(/^[a-z0-9-]+$/, "slug must be kebab-case"),
  title: z.string().max(200),
  summary: z.string().max(400),
  /** ISO date string. */
  publishedAt: z.string(),
  updatedAt: z.string().optional(),
  /**
   * URL of the original post on Medium / dev.to / Hashnode / Substack.
   * Rendered as a "Originally posted on {platform}" link + canonical tag.
   */
  sourceUrl: z.string().url().optional(),
  sourcePlatform: z.string().max(40).optional(),
  /** Cover image URL. */
  image: UrlOrPath.optional(),
  /** Verbatim markdown body. Rendered with remark-gfm + shiki at build. */
  body: z.string(),
});
export type BlogPost = z.infer<typeof BlogPostSchema>;

// ──────────────────────────────────────────────────────────────
// Theme + section layout controls
// ──────────────────────────────────────────────────────────────

export const ThemeSchema = z.object({
  /** Default render mode. Dark is gitshow's default per product decision. */
  mode: z.enum(["light", "dark", "system"]).default("dark"),
  /** Future: bespoke accent color (hex). Not used in MVP rendering. */
  accentHex: z.string().optional(),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const SectionKeySchema = z.enum([
  "hero",
  "about",
  "work",
  "education",
  "skills",
  "projects",
  "hackathons",
  "publications",
  "buildLog",
  "contact",
]);
export type SectionKey = z.infer<typeof SectionKeySchema>;

export const DEFAULT_SECTION_ORDER: SectionKey[] = [
  "hero",
  "about",
  "work",
  "education",
  "publications",
  "skills",
  "hackathons",
  "projects",
  "buildLog",
  "contact",
];

export const SectionsConfigSchema = z.object({
  order: z.array(SectionKeySchema).default(DEFAULT_SECTION_ORDER),
  hidden: z.array(SectionKeySchema).default([]),
});
export type SectionsConfig = z.infer<typeof SectionsConfigSchema>;

// ──────────────────────────────────────────────────────────────
// Meta — provenance, versioning, attribution
// ──────────────────────────────────────────────────────────────

/**
 * Field-level provenance. Keyed by dot-path from the Resume root
 * ("person.summary", "work[0].description", "projects[2].image").
 * Used by the editor to show "AI-generated · edit" badges.
 */
export const SourceTagSchema = z.enum(["ai", "user", "github", "linkedin", "imported"]);
export type SourceTag = z.infer<typeof SourceTagSchema>;

export const ResumeMetaSchema = z.object({
  /** Monotonic integer, bumped on every write. */
  version: z.number().int().nonnegative().default(0),
  /** ISO timestamp of the most recent edit. */
  updatedAt: z.string(),
  /** ISO timestamp of the scan that generated this resume. */
  generatedAt: z.string(),
  /** Scan session id (for tracing back to pipeline artifacts). */
  scanId: z.string().optional(),
  /** Per-field source tagging. */
  sourceTags: z.record(z.string(), SourceTagSchema).default({}),
});
export type ResumeMeta = z.infer<typeof ResumeMetaSchema>;

// ──────────────────────────────────────────────────────────────
// Resume — the root document
// ──────────────────────────────────────────────────────────────

export const ResumeSchema = z.object({
  /** Schema version for future migrations. */
  schemaVersion: z.literal(1).default(1),
  person: PersonSchema,
  contact: ContactSchema,
  skills: z.array(SkillSchema).max(40).default([]),
  work: z.array(WorkEntrySchema).max(30).default([]),
  education: z.array(EducationEntrySchema).max(20).default([]),
  projects: z.array(ProjectSchema).max(40).default([]),
  hackathons: z.array(HackathonEntrySchema).max(40).default([]),
  publications: z.array(PublicationEntrySchema).max(60).default([]),
  buildLog: z.array(BuildLogEntrySchema).max(500).default([]),
  blog: z.array(BlogPostSchema).max(50).default([]),
  theme: ThemeSchema.default({ mode: "dark" }),
  sections: SectionsConfigSchema.default({
    order: DEFAULT_SECTION_ORDER,
    hidden: [],
  }),
  meta: ResumeMetaSchema,
});
export type Resume = z.infer<typeof ResumeSchema>;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/** Visible sections in the user-specified order, filtering out hidden ones. */
export function visibleSections(resume: Resume): SectionKey[] {
  const hidden = new Set(resume.sections.hidden);
  return resume.sections.order.filter((k) => !hidden.has(k));
}

/** Pull every social link out as a flat array in a stable order. */
export function allSocials(resume: Resume): SocialLink[] {
  const s = resume.contact.socials;
  const ordered: (SocialLink | undefined)[] = [
    s.github,
    s.linkedin,
    s.x,
    s.youtube,
    s.website,
    s.email,
  ];
  return [...ordered.filter((x): x is SocialLink => !!x), ...s.other];
}
