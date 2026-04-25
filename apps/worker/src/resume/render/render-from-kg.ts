/**
 * Render Resume from KG — pure projection.
 *
 * Resume JSON is now a deterministic function of the KnowledgeGraph plus
 * the hero-prose pair (description + summary). Zero LLM. Per the plan,
 * "the same KG must always project to the same Resume".
 *
 * Section visibility / ordering is decided here based on what the KG
 * actually contains: empty Hackathons → hidden; <2 Publications and the
 * persona is product-builder → hidden; etc. Hero-prose is mounted in by
 * the caller via `assembleResume()`.
 */

import {
  ResumeSchema,
  type Resume,
  type WorkEntry,
  type EducationEntry,
  type Project as ResumeProject,
  type ProjectMedia,
  type Skill as ResumeSkill,
  type HackathonEntry,
  type PublicationEntry,
  type BuildLogEntry,
  type BlogPost,
  type SocialLink,
  type SectionKey,
  type Link,
  DEFAULT_SECTION_ORDER,
} from "@gitshow/shared/resume";
import type {
  KnowledgeGraph,
  Edge,
  Project as KgProject,
  Repository,
  Company,
  School,
  Person as KgPerson,
  Skill as KgSkill,
  Publication as KgPublication,
  Achievement,
  MediaAsset,
  PublicationKind,
} from "@gitshow/shared/kg";
import { guessSkillIconKey } from "@gitshow/shared/skill-icon-slugs";
import { colorForLanguage } from "../language-colors.js";
import type { ScanTrace } from "../observability/trace.js";

export interface RenderInput {
  kg: KnowledgeGraph;
  /** GitHub handle — becomes the public URL slug. */
  handle: string;
  scanId: string;
  /** From hero-prose.ts — description + summary. */
  prose: { description: string; summary: string };
  /** Imported blog posts (KG doesn't carry full post bodies). */
  blog?: BlogPost[];
  /** Optional canonical email (intake or contact-fetcher). */
  email?: string;
  /**
   * User-supplied socials from the intake (linkedin / twitter / youtube /
   * orcid / stackoverflow). The KG carries a Person node but doesn't
   * round-trip these — feed them in here so they land on
   * `Resume.contact.socials.{linkedin,x,youtube}` instead of getting
   * dropped or relegated to `other[]` (which made the legacy
   * ContactSection crash on `social.X.url`).
   */
  intakeSocials?: {
    linkedin?: string;
    twitter?: string;
    youtube?: string;
    orcid?: string;
    stackoverflow?: string;
  };
  trace?: ScanTrace;
}

const VISIBLE_BANDS = new Set(["verified", "likely"] as const);
type VisibleBand = "verified" | "likely";

const NOISE_PROJECT_KINDS = new Set([
  "contribution-mirror",
  "dotfiles-config",
  "empty-or-trivial",
  "coursework",
  "tutorial-follow",
  "template-clone",
]);

/**
 * Project a KG into a validated Resume. Throws on schema mismatch
 * (those are bugs in the projection, not user errors).
 */
export function renderResumeFromKg(input: RenderInput): Resume {
  const { kg, handle, scanId, prose, blog = [], email, trace } = input;
  const now = new Date().toISOString();

  const person = kg.entities.persons[0];
  if (!person) {
    throw new Error("renderResumeFromKg: KG has no Person node");
  }

  const companyById = new Map(kg.entities.companies.map((c) => [c.id, c]));
  const schoolById = new Map(kg.entities.schools.map((s) => [s.id, s]));
  const projectById = new Map(kg.entities.projects.map((p) => [p.id, p]));
  const repoById = new Map(kg.entities.repositories.map((r) => [r.id, r]));
  const publicationById = new Map(kg.entities.publications.map((p) => [p.id, p]));
  const achievementById = new Map(kg.entities.achievements.map((a) => [a.id, a]));
  const skillById = new Map(kg.entities.skills.map((s) => [s.id, s]));
  const mediaById = new Map(kg.entities.mediaAssets.map((m) => [m.id, m]));

  const work = projectWork({ kg, companyById, trace });
  const education = projectEducation({ kg, schoolById, trace });
  const projects = projectProjects({
    kg,
    projectById,
    repoById,
    mediaById,
    trace,
  });
  // Pass the curated grid's project IDs into Build Log so it acts as
  // an OVERFLOW timeline — everything else the user shipped — instead
  // of duplicating the top-6 cards.
  const featuredProjectIds = new Set(projects.map((p) => p.id));
  const buildLog = projectBuildLog({
    kg,
    repoById,
    trace,
    excludeProjectIds: featuredProjectIds,
  });
  const skills = projectSkills({ kg, skillById, trace });
  const hackathons = projectHackathons({ kg, achievementById, trace });
  const publications = projectPublications({ kg, publicationById, trace });
  const socials = projectSocials({
    person,
    handle,
    intakeSocials: input.intakeSocials,
  });
  const personLogos = projectCompanyLogos({ kg, mediaById, work });
  const educationLogos = projectSchoolLogos({ kg, mediaById, education });

  const draft = {
    schemaVersion: 1 as const,
    person: {
      name: person.name ?? handle,
      handle,
      initials: person.initials ?? deriveInitials(person.name ?? handle),
      avatarUrl: person.avatarUrl,
      location: person.location,
      description: prose.description,
      summary: prose.summary,
      url: person.url,
    },
    contact: {
      email: email ?? person.email,
      tel: undefined,
      socials,
    },
    skills,
    work: personLogos,
    education: educationLogos,
    projects,
    hackathons,
    publications,
    buildLog,
    blog,
    theme: { mode: "dark" as const },
    sections: pickSections({
      work: personLogos,
      education,
      projects,
      hackathons,
      publications,
      buildLog,
      blog,
    }),
    meta: {
      version: 1,
      updatedAt: now,
      generatedAt: now,
      scanId,
      sourceTags: {},
    },
  };

  return ResumeSchema.parse(draft);
}

// ─── Section projections ─────────────────────────────────────────────

function projectWork(opts: {
  kg: KnowledgeGraph;
  companyById: Map<string, Company>;
  trace?: ScanTrace;
}): WorkEntry[] {
  const { kg, companyById, trace } = opts;
  const edges = kg.edges
    .filter((e) => e.type === "WORKED_AT" && isVisible(e))
    .sort(byEndDescending);

  const out: WorkEntry[] = [];
  for (const e of edges) {
    const company = companyById.get(e.to);
    if (!company) continue;
    const role = String(e.attrs.role ?? "");
    if (!role) continue;
    const start = String(e.attrs.start ?? "");
    const end = String(e.attrs.end ?? (e.attrs.present ? "Present" : ""));
    out.push({
      id: e.id,
      company: company.canonicalName,
      title: role,
      start,
      end,
      location: optionalString(e.attrs.location),
      description: optionalString(e.attrs.description) ?? "",
      href: optionalUrl(e.attrs.url ?? (company.domain ? `https://${company.domain}` : undefined)),
      badges: [],
      logoUrl: undefined,
    });
  }

  trace?.renderSelect({
    label: "render.work",
    section: "work",
    entityCount: out.length,
    filter: "WORKED_AT/visible",
  });
  return out;
}

function projectEducation(opts: {
  kg: KnowledgeGraph;
  schoolById: Map<string, School>;
  trace?: ScanTrace;
}): EducationEntry[] {
  const { kg, schoolById, trace } = opts;
  const edges = kg.edges
    .filter((e) => e.type === "STUDIED_AT" && isVisible(e))
    .sort(byEndDescending);

  const out: EducationEntry[] = [];
  for (const e of edges) {
    const school = schoolById.get(e.to);
    if (!school) continue;
    out.push({
      id: e.id,
      school: school.canonicalName,
      degree: optionalString(e.attrs.degree) ?? "",
      start: optionalString(e.attrs.start) ?? "",
      end: optionalString(e.attrs.end) ?? (e.attrs.present ? "Present" : ""),
      logoUrl: undefined,
      href: optionalUrl(e.attrs.url ?? (school.domain ? `https://${school.domain}` : undefined)),
    });
  }

  trace?.renderSelect({
    label: "render.education",
    section: "education",
    entityCount: out.length,
    filter: "STUDIED_AT/visible",
  });
  return out;
}

/** How many projects to show in the curated grid. The rest get
 * surfaced via the chronological Build Log section, so nothing the
 * user shipped goes missing — but the portfolio isn't a wall of 22
 * tiles either. 6 is the sweet spot for a 3×2 grid that scans well
 * on mobile + desktop. */
const PROJECTS_GRID_CAP = 6;

function projectProjects(opts: {
  kg: KnowledgeGraph;
  projectById: Map<string, KgProject>;
  repoById: Map<string, Repository>;
  mediaById: Map<string, MediaAsset>;
  trace?: ScanTrace;
}): ResumeProject[] {
  const { kg, projectById, repoById, mediaById, trace } = opts;

  const featured = kg.entities.projects
    .filter((p) => p.shouldFeature && !NOISE_PROJECT_KINDS.has(p.kind))
    .sort(byProjectScore(repoById))
    .slice(0, PROJECTS_GRID_CAP);

  const heroByProject = collectMediaByEntity(kg.edges, mediaById, "hero");
  const thumbByProject = collectMediaByEntity(kg.edges, mediaById, "thumbnail");

  const builtBy = indexEdgesBy(kg.edges, "BUILT", "to");
  const out: ResumeProject[] = [];
  for (const p of featured) {
    const builtEdges = builtBy.get(p.id) ?? [];
    const repo = p.repoFullName
      ? kg.entities.repositories.find((r) => r.fullName === p.repoFullName)
      : undefined;
    const dates = formatProjectDates(p, repo);
    const links = projectLinks(p, repo);
    const hero = heroByProject.get(p.id);
    const thumb = thumbByProject.get(p.id);
    const media: ProjectMedia | undefined = hero || thumb
      ? {
          hero: hero?.url,
          thumb: thumb?.url,
          screenshots: [],
          heroOrigin: hero?.origin,
        }
      : undefined;

    out.push({
      id: p.id,
      title: p.title,
      description: p.purpose,
      dates,
      active: Boolean(p.dates?.active),
      technologies: dedupe(p.tags).slice(0, 12),
      links,
      image: hero?.url,
      video: undefined,
      href: p.homepageUrl ?? repoUrl(repo?.fullName) ?? undefined,
      kind: "code",
      media,
    });

    void builtEdges;
  }

  trace?.renderSelect({
    label: "render.projects",
    section: "projects",
    entityCount: out.length,
    filter: "shouldFeature && !noise",
  });
  return out;
}

function projectBuildLog(opts: {
  kg: KnowledgeGraph;
  repoById: Map<string, Repository>;
  trace?: ScanTrace;
  /** Project IDs already shown in the curated My Projects grid —
   *  skipped here so the Build Log isn't a duplicate of the cards
   *  above it. The Build Log's job is the chronological overflow. */
  excludeProjectIds?: Set<string>;
}): BuildLogEntry[] {
  const { kg, repoById, trace, excludeProjectIds } = opts;

  const out: BuildLogEntry[] = [];
  const projects = kg.entities.projects;
  const hackathons = kg.entities.achievements.filter((a) => a.kind === "hackathon");

  for (const p of projects) {
    if (NOISE_PROJECT_KINDS.has(p.kind)) continue;
    if (excludeProjectIds?.has(p.id)) continue;
    const repo = p.repoFullName
      ? kg.entities.repositories.find((r) => r.fullName === p.repoFullName)
      : undefined;
    const lang = repo?.primaryLanguage;
    out.push({
      id: `bl:${p.id}`,
      title: p.title,
      dates: formatProjectDates(p, repo),
      description: clip(p.purpose, 320),
      primaryLanguage: lang ?? undefined,
      languageColor: lang ? colorForLanguage(lang) : undefined,
      location: undefined,
      win: undefined,
      image: undefined,
      links: projectLinks(p, repo).slice(0, 3),
    });
  }

  for (const h of hackathons) {
    out.push({
      id: `bl:${h.id}`,
      title: h.title,
      dates: h.date ?? "",
      description: clip(h.description ?? "", 320),
      primaryLanguage: undefined,
      languageColor: undefined,
      location: h.location,
      win: extractWinLabel(h),
      image: undefined,
      links: h.url
        ? [{ label: "Devpost", href: h.url, iconKey: "generic" as const }]
        : [],
    });
  }

  out.sort((a, b) => extractYear(b.dates) - extractYear(a.dates));

  trace?.renderSelect({
    label: "render.buildLog",
    section: "buildLog",
    entityCount: out.length,
    filter: "all-projects + hackathons",
  });

  void repoById;
  return out.slice(0, 200);
}

function projectSkills(opts: {
  kg: KnowledgeGraph;
  skillById: Map<string, KgSkill>;
  trace?: ScanTrace;
}): ResumeSkill[] {
  const { kg, skillById, trace } = opts;

  const counts = new Map<string, number>();
  for (const e of kg.edges) {
    if (e.type !== "HAS_SKILL") continue;
    const score = bandWeight(e.band);
    counts.set(e.to, (counts.get(e.to) ?? 0) + score);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const out: ResumeSkill[] = [];
  for (const [skillId] of ordered) {
    const skill = skillById.get(skillId);
    if (!skill) continue;
    out.push({
      name: skill.canonicalName,
      iconKey: guessSkillIconKey(skill.canonicalName, skill.iconKey),
    });
    if (out.length >= 30) break;
  }

  trace?.renderSelect({
    label: "render.skills",
    section: "skills",
    entityCount: out.length,
    filter: "HAS_SKILL ranked",
  });
  return out;
}

function projectHackathons(opts: {
  kg: KnowledgeGraph;
  achievementById: Map<string, Achievement>;
  trace?: ScanTrace;
}): HackathonEntry[] {
  const { kg, trace } = opts;
  const wonEdges = kg.edges.filter((e) => e.type === "WON" && isVisible(e));

  const out: HackathonEntry[] = [];
  for (const a of kg.entities.achievements) {
    if (a.kind !== "hackathon") continue;
    const sources = wonEdges
      .filter((e) => e.to === a.id)
      .flatMap((e) => e.sources)
      .filter((s) => s.url)
      .map((s) => ({
        label: shortHostname(s.url!),
        href: s.url!,
      }))
      .slice(0, 6);

    out.push({
      id: a.id,
      title: a.title,
      date: a.date,
      description: a.description,
      location: a.location,
      rank: extractWinLabel(a),
      sources,
    });
  }

  out.sort((a, b) => extractYear(b.date ?? "") - extractYear(a.date ?? ""));

  trace?.renderSelect({
    label: "render.hackathons",
    section: "hackathons",
    entityCount: out.length,
    filter: "Achievement.kind=hackathon",
  });
  return out;
}

function projectPublications(opts: {
  kg: KnowledgeGraph;
  publicationById: Map<string, KgPublication>;
  trace?: ScanTrace;
}): PublicationEntry[] {
  const { kg, trace } = opts;
  const out: PublicationEntry[] = [];

  // Only include publications that have at least one AUTHORED edge in
  // verified|likely band — anything in `suggested` (single low-confidence
  // source like Semantic-Scholar name match) is too risky to surface
  // publicly. We saw this pull in 29 papers by a different "Yatendra
  // Singh" because the user has the same first name as a pharmacology
  // researcher.
  const authoredByPubId = new Map<string, "verified" | "likely">();
  for (const e of kg.edges) {
    if (e.type !== "AUTHORED") continue;
    if (e.band !== "verified" && e.band !== "likely") continue;
    const existing = authoredByPubId.get(e.to);
    // Keep the strongest band if multiple edges land on the same pub.
    if (!existing || (existing === "likely" && e.band === "verified")) {
      authoredByPubId.set(e.to, e.band);
    }
  }

  for (const p of kg.entities.publications) {
    const kind = mapPublicationKind(p.kind);
    if (!kind) continue;
    if (!authoredByPubId.has(p.id)) continue;
    out.push({
      id: p.id,
      title: p.title,
      kind,
      venue: p.venue ?? p.platform,
      publishedAt: p.publishedAt,
      url: p.url,
      doi: p.doi,
      coAuthors: dedupe(p.coAuthors).slice(0, 20),
      summary: p.summary,
    });
  }

  out.sort((a, b) => extractYear(b.publishedAt ?? "") - extractYear(a.publishedAt ?? ""));

  trace?.renderSelect({
    label: "render.publications",
    section: "publications",
    entityCount: out.length,
    filter: "AUTHORED edge band ∈ {verified, likely}",
  });
  return out;
}

function projectSocials(opts: {
  person: KgPerson;
  handle: string;
  intakeSocials?: {
    linkedin?: string;
    twitter?: string;
    youtube?: string;
    orcid?: string;
    stackoverflow?: string;
  };
}): Resume["contact"]["socials"] {
  const { person, handle, intakeSocials } = opts;
  const github: SocialLink = {
    name: "GitHub",
    url: `https://github.com/${handle}`,
    iconKey: "github",
    navbar: true,
  };
  const website: SocialLink | undefined = person.url
    ? {
        name: "Website",
        url: person.url,
        iconKey: "website",
        navbar: true,
      }
    : undefined;
  const email: SocialLink | undefined = person.email
    ? {
        name: "Email",
        url: `mailto:${person.email}`,
        iconKey: "email",
        navbar: true,
      }
    : undefined;

  const linkedin: SocialLink | undefined = intakeSocials?.linkedin
    ? {
        name: "LinkedIn",
        url: intakeSocials.linkedin,
        iconKey: "linkedin",
        navbar: true,
      }
    : undefined;

  const x: SocialLink | undefined = intakeSocials?.twitter
    ? {
        name: "X",
        url: normalizeTwitterUrl(intakeSocials.twitter),
        iconKey: "x",
        navbar: true,
      }
    : undefined;

  const youtube: SocialLink | undefined = intakeSocials?.youtube
    ? {
        name: "YouTube",
        url: intakeSocials.youtube,
        iconKey: "youtube",
        navbar: true,
      }
    : undefined;

  // ORCID / Stack Overflow don't have first-class slots in the legacy
  // template-shape socials, so they ride in `other[]` for now.
  const other: SocialLink[] = [];
  if (intakeSocials?.orcid) {
    other.push({
      name: "ORCID",
      url: intakeSocials.orcid,
      iconKey: "generic",
      navbar: false,
    });
  }
  if (intakeSocials?.stackoverflow) {
    other.push({
      name: "Stack Overflow",
      url: intakeSocials.stackoverflow,
      iconKey: "generic",
      navbar: false,
    });
  }

  return {
    github,
    linkedin,
    x,
    youtube,
    website,
    email,
    other,
  };
}

/**
 * Accept either a bare twitter handle (`@iamyatendrak`) or a full URL
 * and return a canonical https URL the contact section can link to.
 */
function normalizeTwitterUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const handle = trimmed.replace(/^@/, "");
  return `https://x.com/${handle}`;
}

function projectCompanyLogos(opts: {
  kg: KnowledgeGraph;
  mediaById: Map<string, MediaAsset>;
  work: WorkEntry[];
}): WorkEntry[] {
  const logoByCompany = collectMediaByEntity(opts.kg.edges, opts.mediaById, "logo");
  return opts.work.map((w) => {
    const edge = opts.kg.edges.find((e) => e.id === w.id);
    if (!edge) return w;
    const logo = logoByCompany.get(edge.to);
    if (!logo) return w;
    return { ...w, logoUrl: logo.url };
  });
}

function projectSchoolLogos(opts: {
  kg: KnowledgeGraph;
  mediaById: Map<string, MediaAsset>;
  education: EducationEntry[];
}): EducationEntry[] {
  const logoBySchool = collectMediaByEntity(opts.kg.edges, opts.mediaById, "logo");
  return opts.education.map((e) => {
    const edge = opts.kg.edges.find((edg) => edg.id === e.id);
    if (!edge) return e;
    const logo = logoBySchool.get(edge.to);
    if (!logo) return e;
    return { ...e, logoUrl: logo.url };
  });
}

// ─── Section ordering / visibility ──────────────────────────────────

function pickSections(args: {
  work: WorkEntry[];
  education: EducationEntry[];
  projects: ResumeProject[];
  hackathons: HackathonEntry[];
  publications: PublicationEntry[];
  buildLog: BuildLogEntry[];
  blog: BlogPost[];
}): Resume["sections"] {
  const hidden: SectionKey[] = [];
  if (args.work.length === 0) hidden.push("work");
  if (args.education.length === 0) hidden.push("education");
  if (args.hackathons.length === 0) hidden.push("hackathons");
  if (args.publications.length === 0) hidden.push("publications");
  if (args.projects.length === 0) hidden.push("projects");
  if (args.buildLog.length === 0) hidden.push("buildLog");
  return {
    order: [...DEFAULT_SECTION_ORDER],
    hidden,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function isVisible(e: Edge): boolean {
  return VISIBLE_BANDS.has(e.band as VisibleBand);
}

function bandWeight(band: string): number {
  if (band === "verified") return 2;
  if (band === "likely") return 1;
  return 0.25;
}

function byEndDescending(a: Edge, b: Edge): number {
  const aEnd = parseDate(String(a.attrs.end ?? ""), Boolean(a.attrs.present));
  const bEnd = parseDate(String(b.attrs.end ?? ""), Boolean(b.attrs.present));
  return bEnd - aEnd;
}

function byProjectScore(repoById: Map<string, Repository>) {
  return (a: KgProject, b: KgProject) => {
    const repoA = a.repoFullName
      ? findRepoByFullName(repoById, a.repoFullName)
      : undefined;
    const repoB = b.repoFullName
      ? findRepoByFullName(repoById, b.repoFullName)
      : undefined;
    const sa = (repoA?.stars ?? 0) * 2 + (polishScore(a.polish) ?? 0);
    const sb = (repoB?.stars ?? 0) * 2 + (polishScore(b.polish) ?? 0);
    return sb - sa;
  };
}

function findRepoByFullName(
  repoById: Map<string, Repository>,
  fullName: string,
): Repository | undefined {
  for (const r of repoById.values()) if (r.fullName === fullName) return r;
  return undefined;
}

function polishScore(p: string | undefined): number {
  switch (p) {
    case "shipped":
      return 5;
    case "working":
      return 3;
    case "wip":
      return 1;
    case "broken":
      return 0;
    case "not-code":
      return 0;
    default:
      return 0;
  }
}

function parseDate(s: string, present: boolean): number {
  if (!s) return present ? Number.POSITIVE_INFINITY : 0;
  if (/^present$/i.test(s)) return Number.POSITIVE_INFINITY;
  const yearMatch = s.match(/(\d{4})/);
  if (!yearMatch) return 0;
  const year = parseInt(yearMatch[1], 10);
  const monthMatch = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i);
  const monthName = monthMatch?.[1]?.toLowerCase();
  const month = monthName
    ? ({
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
        jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
      } as Record<string, number>)[monthName] ?? 1
    : 1;
  return year * 12 + month;
}

function extractYear(s: string): number {
  const m = s.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : 0;
}

function extractWinLabel(a: Achievement): string | undefined {
  const t = a.title.toLowerCase();
  const candidates = [
    "1st place",
    "2nd place",
    "3rd place",
    "winner",
    "grand prize",
    "best ",
    "finalist",
    "honorable mention",
  ];
  for (const c of candidates) if (t.includes(c)) return capitalise(c.trim());
  return undefined;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function dedupe<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of arr) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function optionalString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function optionalUrl(v: unknown): string | undefined {
  const s = optionalString(v);
  if (!s) return undefined;
  try {
    new URL(s);
    return s;
  } catch {
    return undefined;
  }
}

function shortHostname(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

function repoUrl(fullName?: string): string | undefined {
  if (!fullName) return undefined;
  return `https://github.com/${fullName}`;
}

function formatProjectDates(p: KgProject, repo: Repository | undefined): string {
  const start = humanDate(p.dates?.start);
  const end =
    humanDate(p.dates?.end) ?? (p.dates?.active ? "Present" : undefined);
  if (start && end) return start === end ? start : `${start} – ${end}`;
  if (start) return start;
  if (repo?.pushedAt) {
    const d = new Date(repo.pushedAt);
    return formatYearMonth(d);
  }
  return "";
}

/**
 * Coerce whatever date string the KG carries into "Mon YYYY". Handles:
 *   - bare year ("2024")             → "2024"
 *   - YYYY-MM ("2024-02")             → "Feb 2024"
 *   - ISO timestamp                   → "Feb 2024"
 *   - already-human ("Present")       → "Present"
 *   - the literal string "Present"    → "Present"
 *
 * Drops the day-of-month deliberately — projects span months/years,
 * not days, and "Feb 4, 2024" looks like a calendar event.
 */
function humanDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^present$/i.test(trimmed)) return "Present";
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return formatYearMonth(parsed);
  return trimmed;
}

function formatYearMonth(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function projectLinks(p: KgProject, repo?: Repository): Link[] {
  const out: Link[] = [];
  if (p.homepageUrl) {
    out.push({ label: "Website", href: p.homepageUrl, iconKey: "website" });
  }
  if (repo?.fullName) {
    out.push({
      label: "Source",
      href: `https://github.com/${repo.fullName}`,
      iconKey: "github",
    });
  } else if (p.repoFullName) {
    out.push({
      label: "Source",
      href: `https://github.com/${p.repoFullName}`,
      iconKey: "github",
    });
  }
  return out.slice(0, 4);
}

function indexEdgesBy(
  edges: Edge[],
  type: Edge["type"],
  side: "from" | "to",
): Map<string, Edge[]> {
  const out = new Map<string, Edge[]>();
  for (const e of edges) {
    if (e.type !== type) continue;
    const key = side === "from" ? e.from : e.to;
    const list = out.get(key);
    if (list) list.push(e);
    else out.set(key, [e]);
  }
  return out;
}

interface ResolvedMedia {
  url: string;
  origin?: ProjectMedia["heroOrigin"];
}

function collectMediaByEntity(
  edges: Edge[],
  mediaById: Map<string, MediaAsset>,
  kind: "hero" | "thumbnail" | "logo" | "screenshot",
): Map<string, ResolvedMedia> {
  const out = new Map<string, ResolvedMedia>();
  for (const e of edges) {
    if (e.type !== "HAS_MEDIA") continue;
    const media = mediaById.get(e.to);
    if (!media || media.kind !== kind) continue;
    if (out.has(e.from)) continue;
    const url = mediaUrl(media);
    if (!url) continue;
    out.set(e.from, { url, origin: mapMediaOrigin(media.origin) });
  }
  return out;
}

function mediaUrl(m: MediaAsset): string | undefined {
  if (m.r2Key) return `/r2/${m.r2Key}`;
  if (m.remoteUrl) return m.remoteUrl;
  return undefined;
}

function mapMediaOrigin(o: MediaAsset["origin"]): ProjectMedia["heroOrigin"] {
  switch (o) {
    case "og":
      return "og";
    case "readme":
      return "readme";
    case "youtube":
      return "youtube";
    case "generated":
      return "generated";
    case "user-upload":
      return "user-upload";
    default:
      return undefined;
  }
}

function mapPublicationKind(
  k: PublicationKind,
): PublicationEntry["kind"] | undefined {
  switch (k) {
    case "paper":
    case "preprint":
    case "talk":
    case "podcast":
    case "video":
      return k;
    case "blog":
    case "other":
      return undefined;
  }
}
