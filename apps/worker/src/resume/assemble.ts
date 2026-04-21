/**
 * Assemble — merge all agent outputs into a validated `Resume` JSON.
 *
 * Zero LLM. Deterministic. Failures here mean a schema mismatch between
 * an agent's output and `packages/shared/src/resume.ts` — surface them
 * loudly rather than quietly truncating.
 */

import { ResumeSchema, type Resume } from "@gitshow/shared/resume";
import type { ScanSession } from "../schemas.js";
import type { GitHubData } from "../types.js";
import type { PersonAgentOutput } from "./agents/person.js";
import type { SkillsAgentOutput } from "./agents/skills.js";
import type { BuildLogEntry } from "./agents/build-log.js";
import type { Project } from "./agents/projects.js";
import type { WorkEntry } from "./agents/work.js";
import type { EducationEntry } from "./agents/education.js";
import type { ContactOutput } from "./agents/contact.js";

export interface AssembleInput {
  session: ScanSession;
  github: GitHubData;
  person: PersonAgentOutput;
  skills: SkillsAgentOutput;
  projects: Project[];
  buildLog: BuildLogEntry[];
  work: WorkEntry[];
  education: EducationEntry[];
  contact: ContactOutput;
}

/**
 * Produce a validated Resume from agent outputs. Throws on schema mismatch.
 */
export function assembleResume(input: AssembleInput): Resume {
  const { session, github, person, skills, projects, buildLog, work, education, contact } = input;
  const now = new Date().toISOString();

  const draft = {
    schemaVersion: 1,
    person: {
      name: person.name,
      handle: session.handle,
      initials: person.initials,
      avatarUrl: github.profile.avatarUrl,
      location: github.profile.location ?? undefined,
      description: person.description,
      summary: person.summary,
      url: `https://gitshow.io/${session.handle}`,
    },
    contact: {
      email: contact.email,
      tel: undefined,
      socials: contact.socials,
    },
    skills: skills.skills.map((s) => ({ name: s.name, iconKey: s.iconKey })),
    work: work.map((w) => ({
      id: w.id,
      company: w.company,
      title: w.title,
      start: w.start,
      end: w.end,
      location: w.location,
      logoUrl: w.logoUrl,
      description: w.description,
      href: w.href,
      badges: w.badges,
    })),
    education: education.map((e) => ({
      id: e.id,
      school: e.school,
      degree: e.degree,
      start: e.start,
      end: e.end,
      logoUrl: e.logoUrl,
      href: e.href,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      dates: p.dates,
      active: p.active,
      technologies: p.technologies,
      links: p.links,
      image: p.image,
      video: p.video,
      href: p.href,
    })),
    buildLog: buildLog.map((b) => ({
      id: b.id,
      title: b.title,
      dates: b.dates,
      description: b.description,
      primaryLanguage: b.primaryLanguage,
      languageColor: b.languageColor,
      links: b.links,
    })),
    blog: [],
    theme: { mode: "dark" as const },
    sections: {
      order: ["hero", "about", "work", "education", "skills", "projects", "buildLog", "contact"] as const,
      hidden: [] as const,
    },
    meta: {
      version: 1,
      updatedAt: now,
      generatedAt: now,
      scanId: session.id,
      sourceTags: {},
    },
  };

  return ResumeSchema.parse(draft);
}
