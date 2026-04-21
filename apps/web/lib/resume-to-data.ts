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
  skills: { name: string; icon?: IconComp }[];
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
 * @param handle - Route handle, used for the dock's `Home`/`Blog` links
 */
export function resumeToTemplateData(
  resume: Resume,
  handle: string,
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
    summary: resume.person.summary,
    avatarUrl: resume.person.avatarUrl ?? "",
    skills: resume.skills.map((s) => ({
      name: s.name,
      icon: iconForSkill(s),
    })),
    navbar: [
      { href: `/${handle}`, icon: HomeIcon, label: "Home" },
      ...(hasBlog
        ? [{ href: `/${handle}/blog`, icon: NotebookIcon, label: "Blog" }]
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
    })),
    hackathons: resume.buildLog.map((b) => ({
      title: b.title,
      dates: b.dates,
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
