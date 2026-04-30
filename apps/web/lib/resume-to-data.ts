/**
 * Transform a persisted `Resume` (JSON-friendly; icons as `iconKey` strings)
 * into the exact object shape the reference portfolio template expects as
 * its `DATA` constant (icons as React components, socials keyed uppercase,
 * etc.).
 *
 * The template's components consume `DATA` verbatim. By matching this
 * shape, we can keep every section component (work/projects/hackathons/
 * contact, navbar) unchanged aside from swapping the literal
 * `import { DATA } from "@/data/resume"` line for `const DATA = useData()`.
 */

import { createElement, type HTMLAttributes, type ComponentType } from "react";
import { HomeIcon, NotebookIcon } from "lucide-react";
import { Icons } from "@/components/icons";
import { resolveSkillIcon } from "@/components/skill-icons";
import type { Resume, IconKey, BlogPost } from "@gitshow/shared/resume";

type IconComp = ComponentType<HTMLAttributes<SVGElement>>;

function iconForKey(key: IconKey | string | undefined): IconComp {
  if (!key) return Icons.globe as IconComp;
  const map: Record<string, IconComp> = {
    github: Icons.github as IconComp,
    linkedin: Icons.linkedin as IconComp,
    x: Icons.x as IconComp,
    twitter: Icons.x as IconComp,
    youtube: Icons.youtube as IconComp,
    email: Icons.email as IconComp,
    globe: Icons.globe as IconComp,
    website: Icons.globe as IconComp,
  };
  return map[key] ?? (Icons.globe as IconComp);
}

/**
 * Skill pills get their own resolver with a much broader registry
 * (`@icons-pack/react-simple-icons` backed). We also try the skill's
 * display name as a fallback so the renderer still finds the right mark
 * when the pipeline didn't set an iconKey (older drafts, user-added
 * skills in the editor, etc.).
 */
function iconForSkill(
  skill: Resume["skills"][number],
): IconComp | undefined {
  const byKey = resolveSkillIcon(skill.iconKey);
  if (byKey) return byKey as unknown as IconComp;
  return resolveSkillIcon(skill.name) as unknown as IconComp | undefined;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthYear(year: number, month: number): string {
  const m = MONTH_NAMES[month - 1];
  return m ? `${m} ${year}` : String(year);
}

/**
 * Prettify the `dates` string stored on a BuildLogEntry.
 *
 * The worker emits compact `YYYY-MM` or `YYYY-MM → YYYY-MM` strings
 * because that's what we can faithfully derive from git commit dates.
 * Users on the timeline want something human-readable — so at render
 * time we translate:
 *
 *   "2024-02"                    → "February 2024"
 *   "2024-02 → 2024-02"          → "February 2024"
 *   "2024-02 → 2024-10"          → "February – October 2024"
 *   "2024-02 → 2025-02"          → "February 2024 – February 2025"
 *
 * Any string that doesn't match the expected shape (user-edited custom
 * copy like "Hackathon weekend, Oct 2017") passes through untouched.
 */
function humanizeBuildLogDates(raw: string): string {
  if (!raw) return raw;

  const single = raw.match(/^(\d{4})-(\d{2})$/);
  if (single) {
    const y = Number(single[1]);
    const m = Number(single[2]);
    if (Number.isFinite(y) && m >= 1 && m <= 12) return monthYear(y, m);
    return raw;
  }

  const range = raw.match(
    /^(\d{4})-(\d{2})\s*(?:→|->|–|—|-)\s*(\d{4})-(\d{2})$/,
  );
  if (range) {
    const y1 = Number(range[1]);
    const m1 = Number(range[2]);
    const y2 = Number(range[3]);
    const m2 = Number(range[4]);
    const valid =
      Number.isFinite(y1) &&
      Number.isFinite(y2) &&
      m1 >= 1 &&
      m1 <= 12 &&
      m2 >= 1 &&
      m2 <= 12;
    if (!valid) return raw;
    if (y1 === y2 && m1 === m2) return monthYear(y1, m1);
    if (y1 === y2) {
      const first = MONTH_NAMES[m1 - 1];
      const last = MONTH_NAMES[m2 - 1];
      if (first && last) return `${first} – ${last} ${y1}`;
    }
    return `${monthYear(y1, m1)} – ${monthYear(y2, m2)}`;
  }

  return raw;
}

/**
 * The person-agent emits hero-section anchor links as bare fragment
 * paths (`/#projects`, `/#work`, etc.) to mirror the reference
 * portfolio's prose style. In our app those paths resolve to the
 * site root, not the user's page — rewrite them to
 * `{urlPrefix}/#anchor` at transform time so in-page jumps land
 * correctly. On a custom domain `urlPrefix` is empty, so `/#projects`
 * passes through unchanged (which is what we want — the root IS the
 * portfolio there).
 *
 * Matches both markdown (`](/#foo)`) and raw HTML (`href="/#foo"`)
 * just in case. External URLs and mailto: links pass through
 * untouched because the pattern only matches `/` followed by `#`.
 */
function rewriteInternalLinks(summary: string, urlPrefix: string): string {
  if (!urlPrefix) return summary;
  return summary.replace(
    /(\]\(|href=["'])\/#([A-Za-z0-9_-]+)/g,
    (_match, prefix: string, anchor: string) =>
      `${prefix}${urlPrefix}/#${anchor}`,
  );
}

/**
 * Template's DATA shape — mirrors `portfolio/src/data/resume.tsx`. We only
 * model the fields the template actually renders; any extra surface can be
 * added here as we wire new sections.
 */
export interface TemplateData {
  name: string;
  initials: string;
  url: string;
  location: string;
  locationLink?: string;
  description: string;
  summary: string;
  avatarUrl: string;
  skills: {
    name: string;
    icon?: IconComp;
    /** 0..100 — drives the score bar inside the chip. */
    score?: number;
    /** Number of owned repos that declared this dep. Tooltip copy. */
    usageCount?: number;
  }[];
  navbar: { href: string; icon: IconComp; label: string }[];
  contact: {
    email: string;
    tel?: string;
    social: Record<
      string,
      { name: string; url: string; icon: IconComp; navbar: boolean }
    >;
  };
  work: {
    company: string;
    href?: string;
    badges: string[];
    location?: string;
    title: string;
    logoUrl?: string;
    start: string;
    end: string;
    description: string;
  }[];
  education: {
    school: string;
    href?: string;
    degree: string;
    logoUrl?: string;
    start: string;
    end: string;
  }[];
  projects: {
    title: string;
    href?: string;
    dates: string;
    active: boolean;
    description: string;
    technologies: string[];
    links: { type: string; href: string; icon: React.ReactNode }[];
    image?: string;
    video?: string;
    /** 0..1 — fraction of repo authored by the user. */
    userShare?: number;
    /** Press / community mentions, populated for the 6 grid picks. */
    webMentions?: { title: string; url: string; source: string; snippet?: string }[];
  }[];
  hackathons: {
    title: string;
    dates: string;
    location?: string;
    description?: string;
    image?: string;
    win?: string;
    links: { title: string; icon: React.ReactNode; href: string }[];
  }[];
  /** Imported blog posts; body is markdown, rendered at /{handle}/blog/{slug}. */
  blog: BlogPost[];
}

/**
 * Convert a `Resume` to the template's `DATA` shape.
 *
 * @param resume - Persisted Resume blob (from R2)
 * @param handle - Route handle. Used as a stable identity (NOT for URLs).
 * @param urlPrefix - Path prefix for navbar links. `/{handle}` on the
 *   canonical site, `""` when serving on a custom domain. Defaults to
 *   `/{handle}` for backward compatibility with previewing surfaces.
 */
export function resumeToTemplateData(
  resume: Resume,
  handle: string,
  urlPrefix: string = `/${handle}`,
): TemplateData {
  const socials = resume.contact.socials;
  const socialMap: TemplateData["contact"]["social"] = {};

  const addSocial = (key: string, s: (typeof socials)["github"]) => {
    if (!s) return;
    socialMap[key] = {
      name: s.name,
      url: s.url,
      icon: iconForKey(s.iconKey),
      navbar: s.navbar,
    };
  };

  addSocial("GitHub", socials.github);
  addSocial("LinkedIn", socials.linkedin);
  addSocial("X", socials.x);
  addSocial("Youtube", socials.youtube);
  addSocial("email", socials.email);
  socials.other.forEach((s, i) => addSocial(s.name || `other-${i}`, s));

  const hasBlog = resume.blog.length > 0;

  return {
    name: resume.person.name,
    initials: resume.person.initials,
    url: resume.person.url ?? `https://gitshow.io/${handle}`,
    location: resume.person.location ?? "",
    description: resume.person.description,
    summary: rewriteInternalLinks(resume.person.summary, urlPrefix),
    avatarUrl: resume.person.avatarUrl ?? "",
    skills: resume.skills.map((s) => ({
      name: s.name,
      icon: iconForSkill(s),
      score: s.score,
      usageCount: s.usageCount,
    })),
    navbar: [
      { href: urlPrefix || "/", icon: HomeIcon, label: "Home" },
      ...(hasBlog
        ? [
            {
              href: `${urlPrefix}/blog`,
              icon: NotebookIcon,
              label: "Blog",
            },
          ]
        : []),
    ],
    contact: {
      email: resume.contact.email ?? "",
      tel: resume.contact.tel,
      social: socialMap,
    },
    work: resume.work.map((w) => ({
      company: w.company,
      href: w.href,
      badges: w.badges,
      location: w.location,
      title: w.title,
      logoUrl: w.logoUrl,
      start: w.start,
      end: w.end,
      description: w.description,
    })),
    education: resume.education.map((e) => ({
      school: e.school,
      href: e.href,
      degree: e.degree,
      logoUrl: e.logoUrl,
      start: e.start,
      end: e.end,
    })),
    projects: resume.projects.map((p) => ({
      title: p.title,
      href: p.href,
      dates: p.dates,
      active: p.active,
      description: p.description,
      technologies: p.technologies as unknown as string[],
      links: p.links.map((l) => ({
        type: l.label,
        href: l.href,
        icon: createElement(iconForKey(l.iconKey), { className: "size-3" }),
      })),
      image: p.image,
      video: p.video,
      userShare: p.userShare,
      webMentions: p.webMentions,
    })),
    hackathons: resume.buildLog.map((b) => ({
      title: b.title,
      dates: humanizeBuildLogDates(b.dates),
      location: b.location,
      description: b.description,
      image: b.image,
      win: b.win,
      links: b.links.map((l) => ({
        title: l.label,
        href: l.href,
        icon: createElement(iconForKey(l.iconKey), { className: "h-4 w-4" }),
      })),
    })),
    blog: resume.blog,
  };
}
