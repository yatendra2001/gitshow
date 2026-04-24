/**
 * KG schema — typed entity nodes + edges + KnowledgeGraph wrapper.
 *
 * Resume JSON is a deterministic projection of this graph. Every fetcher
 * emits `TypedFact<E>` (see typed-fact.ts) which the merger fuses into a
 * KG. The render layer reads the KG and emits Resume.
 */

import * as z from "zod/v4";

// ─── Enums ────────────────────────────────────────────────────────────

export const ProjectKindSchema = z.enum([
  "product",
  "library",
  "tool",
  "experiment",
  "tutorial-follow",
  "template-clone",
  "fork-contribution",
  "contribution-mirror",
  "dotfiles-config",
  "coursework",
  "empty-or-trivial",
  "research-artifact",
]);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

export const PolishSchema = z.enum(["shipped", "working", "wip", "broken", "not-code"]);
export type Polish = z.infer<typeof PolishSchema>;

export const PublicationKindSchema = z.enum([
  "blog",
  "paper",
  "preprint",
  "talk",
  "podcast",
  "video",
  "other",
]);
export type PublicationKind = z.infer<typeof PublicationKindSchema>;

export const AchievementKindSchema = z.enum([
  "hackathon",
  "award",
  "feature",
  "press",
  "rep-milestone",
  "certification",
  "other",
]);
export type AchievementKind = z.infer<typeof AchievementKindSchema>;

export const EventKindSchema = z.enum(["conference", "hackathon", "talk", "podcast"]);
export type EventKind = z.infer<typeof EventKindSchema>;

export const MediaKindSchema = z.enum(["hero", "thumbnail", "screenshot", "logo"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const ConfidenceBandSchema = z.enum(["verified", "likely", "suggested"]);
export type ConfidenceBand = z.infer<typeof ConfidenceBandSchema>;

export const FetcherSchema = z.enum([
  "github",
  "github-fetcher",
  "github-hint",
  "linkedin-public",
  "linkedin-playwright",
  "linkedin-pdf",
  "personal-site",
  "twitter",
  "hn",
  "devto",
  "medium",
  "orcid",
  "semantic-scholar",
  "arxiv",
  "stackoverflow",
  "evidence-search",
  "repo-judge",
  "intake",
  "blog-import",
  "media-fetch",
]);
export type Fetcher = z.infer<typeof FetcherSchema>;

export const SourceMethodSchema = z.enum(["api", "scrape", "llm-extraction", "user-input"]);
export type SourceMethod = z.infer<typeof SourceMethodSchema>;

// ─── Source provenance ───────────────────────────────────────────────

export const SourceSchema = z.object({
  fetcher: FetcherSchema,
  url: z.string().optional(),
  /** Verbatim ~280-char snippet for human inspection. */
  snippet: z.string().max(560).optional(),
  method: SourceMethodSchema,
  confidence: z.enum(["high", "medium", "low"]),
  /** Reserved: "first-party-api" — ORCID, future LinkedIn portability API. */
  authority: z.literal("first-party-api").optional(),
  t: z.number(),
});
export type Source = z.infer<typeof SourceSchema>;

// ─── Entity nodes ────────────────────────────────────────────────────

export const PersonSchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string().optional(),
  bio: z.string().optional(),
  location: z.string().optional(),
  avatarUrl: z.string().optional(),
  initials: z.string().optional(),
  /** Discoverable in the future recruiter-match index. Off by default. */
  discoverable: z.boolean().default(false),
  /** Optional canonical personal URL. */
  url: z.string().optional(),
  email: z.string().optional(),
});
export type Person = z.infer<typeof PersonSchema>;

export const CompanySchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  domain: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  description: z.string().optional(),
});
export type Company = z.infer<typeof CompanySchema>;

export const SchoolSchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  domain: z.string().optional(),
  aliases: z.array(z.string()).default([]),
});
export type School = z.infer<typeof SchoolSchema>;

export const RoleSchema = z.object({
  id: z.string(),
  title: z.string(),
  normalizedTitle: z.string(),
});
export type Role = z.infer<typeof RoleSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** One-sentence honest description. */
  purpose: z.string(),
  kind: ProjectKindSchema,
  polish: PolishSchema,
  shouldFeature: z.boolean().default(false),
  reason: z.string().optional(),
  dates: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
      active: z.boolean().optional(),
    })
    .optional(),
  tags: z.array(z.string()).default([]),
  /** Optional repo back-pointer when the project corresponds to a repo. */
  repoFullName: z.string().optional(),
  /** Public homepage / live URL. */
  homepageUrl: z.string().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const RepositorySchema = z.object({
  id: z.string(),
  fullName: z.string(),
  primaryLanguage: z.string().optional(),
  isPrivate: z.boolean().default(false),
  isFork: z.boolean().default(false),
  isArchived: z.boolean().default(false),
  stars: z.number().int().nonnegative().default(0),
  pushedAt: z.string().optional(),
  description: z.string().optional(),
  homepageUrl: z.string().optional(),
  userCommitCount: z.number().int().nonnegative().optional(),
});
export type Repository = z.infer<typeof RepositorySchema>;

export const SkillSchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  category: z.string().optional(),
  iconKey: z.string().optional(),
});
export type Skill = z.infer<typeof SkillSchema>;

export const PublicationSchema = z.object({
  id: z.string(),
  title: z.string(),
  platform: z.string().optional(),
  publishedAt: z.string().optional(),
  url: z.string(),
  body: z.string().optional(),
  summary: z.string().optional(),
  kind: PublicationKindSchema,
  venue: z.string().optional(),
  doi: z.string().optional(),
  arxivId: z.string().optional(),
  coAuthors: z.array(z.string()).default([]),
  /** Cover image / paper preview URL. */
  imageUrl: z.string().optional(),
});
export type Publication = z.infer<typeof PublicationSchema>;

export const AchievementSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: AchievementKindSchema,
  date: z.string().optional(),
  /** Reputation milestone (e.g., StackOverflow rep at the time of capture). */
  repUnit: z.number().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  location: z.string().optional(),
});
export type Achievement = z.infer<typeof AchievementSchema>;

export const EventSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: EventKindSchema,
  date: z.string().optional(),
  location: z.string().optional(),
  url: z.string().optional(),
});
export type Event = z.infer<typeof EventSchema>;

export const MediaAssetSchema = z.object({
  id: z.string(),
  kind: MediaKindSchema,
  r2Key: z.string().optional(),
  remoteUrl: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** Where the media came from: og scrape, README image, YouTube thumb, Gemini gen, Clearbit logo. */
  origin: z.enum(["og", "readme", "youtube", "generated", "clearbit", "favicon", "user-upload"]).optional(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

// ─── Edges ───────────────────────────────────────────────────────────

export const EdgeTypeSchema = z.enum([
  "WORKED_AT",
  "STUDIED_AT",
  "BUILT",
  "CONTRIBUTED_TO",
  "LIVES_IN",
  "HAS_SKILL",
  "WON",
  "CO_BUILT_WITH",
  "AUTHORED",
  "OPERATES",
  "HAS_JUDGMENT",
  "HAS_MEDIA",
  "ATTENDED",
]);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

export const EdgeSchema = z.object({
  id: z.string(),
  type: EdgeTypeSchema,
  from: z.string(),
  to: z.string(),
  attrs: z.record(z.string(), z.unknown()).default({}),
  sources: z.array(SourceSchema).default([]),
  band: ConfidenceBandSchema.default("suggested"),
});
export type Edge = z.infer<typeof EdgeSchema>;

// ─── KnowledgeGraph wrapper ──────────────────────────────────────────

export const KnowledgeGraphMetaSchema = z.object({
  scanId: z.string(),
  handle: z.string(),
  model: z.string(),
  startedAt: z.number(),
  finishedAt: z.number(),
});
export type KnowledgeGraphMeta = z.infer<typeof KnowledgeGraphMetaSchema>;

export const PairResolutionSchema = z.object({
  a: z.string(),
  b: z.string(),
  decision: z.enum(["merge", "separate", "unclear"]),
  rationale: z.string(),
});
export type PairResolution = z.infer<typeof PairResolutionSchema>;

export const KnowledgeGraphSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  meta: KnowledgeGraphMetaSchema,
  entities: z.object({
    persons: z.array(PersonSchema).default([]),
    companies: z.array(CompanySchema).default([]),
    schools: z.array(SchoolSchema).default([]),
    roles: z.array(RoleSchema).default([]),
    projects: z.array(ProjectSchema).default([]),
    repositories: z.array(RepositorySchema).default([]),
    skills: z.array(SkillSchema).default([]),
    publications: z.array(PublicationSchema).default([]),
    achievements: z.array(AchievementSchema).default([]),
    events: z.array(EventSchema).default([]),
    mediaAssets: z.array(MediaAssetSchema).default([]),
  }),
  edges: z.array(EdgeSchema).default([]),
  resolved: z
    .object({
      pairs: z.array(PairResolutionSchema).default([]),
    })
    .default({ pairs: [] }),
  warnings: z.array(z.string()).default([]),
  /** Per-repo Judgment outputs, keyed by repository id. */
  judgments: z.record(z.string(), z.unknown()).default({}),
});
export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;

// ─── Confidence math ─────────────────────────────────────────────────

/** Derive band from a list of sources per §3.3 of the plan. */
export function deriveBand(sources: Source[]): ConfidenceBand {
  let score = 0;
  for (const s of sources) {
    if (s.confidence === "high") score += 1;
    else if (s.confidence === "medium") score += 0.5;
    if (s.authority === "first-party-api") score += 2;
  }
  if (score >= 2) return "verified";
  if (score >= 1) return "likely";
  return "suggested";
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function emptyKG(meta: KnowledgeGraphMeta): KnowledgeGraph {
  return {
    schemaVersion: 1,
    meta,
    entities: {
      persons: [],
      companies: [],
      schools: [],
      roles: [],
      projects: [],
      repositories: [],
      skills: [],
      publications: [],
      achievements: [],
      events: [],
      mediaAssets: [],
    },
    edges: [],
    resolved: { pairs: [] },
    warnings: [],
    judgments: {},
  };
}
