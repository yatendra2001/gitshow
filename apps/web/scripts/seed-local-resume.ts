#!/usr/bin/env bun
/**
 * Seed a hand-crafted Resume JSON into local R2 for render verification.
 *
 * Usage:
 *   bun run scripts/seed-local-resume.ts
 *
 * Writes to the local (miniflare) R2 bucket under
 *   resumes/{handle}/published.json
 * and also dumps the JSON to /tmp for inspection.
 */

import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { ResumeSchema, type Resume } from "@gitshow/shared/resume";

const HANDLE = "yatendra2001";
const NOW = new Date().toISOString();

const resume: Resume = ResumeSchema.parse({
  schemaVersion: 1,
  person: {
    name: "Yatendra Kumar",
    handle: HANDLE,
    initials: "YK",
    avatarUrl: "https://avatars.githubusercontent.com/yatendra2001",
    location: "Pune, Maharashtra, India",
    description:
      "I like building stuff. Currently at Flightcast — shipping AI-heavy tools that turn messy dev workflows into portfolios, summaries and signal.",
    summary:
      "I build products end-to-end. I'm [currently at Flightcast](/#work) where I own the full stack — from the AI pipeline that scans GitHub to the Next.js / Cloudflare Workers app that serves it globally. Before that I was in the [buildspace](/#education) community, shipping scrappy MVPs on every cohort I could squeeze into. Most of what I've built is open source and [lives in GitHub](https://github.com/yatendra2001) — [here are a few of the ones I'm proudest of](/#projects).",
    url: "https://gitshow.io/yatendra2001",
  },
  contact: {
    email: "yatendra2001kumar@gmail.com",
    socials: {
      github: {
        name: "GitHub",
        url: "https://github.com/yatendra2001",
        iconKey: "github",
        navbar: true,
      },
      linkedin: {
        name: "LinkedIn",
        url: "https://www.linkedin.com/in/yatendra2001/",
        iconKey: "linkedin",
        navbar: true,
      },
      x: {
        name: "X",
        url: "https://x.com/yatendra2001",
        iconKey: "x",
        navbar: true,
      },
      email: {
        name: "Email",
        url: "mailto:yatendra2001kumar@gmail.com",
        iconKey: "email",
        navbar: false,
      },
      other: [],
    },
  },
  skills: [
    { name: "TypeScript" },
    { name: "Next.js" },
    { name: "React" },
    { name: "Node.js" },
    { name: "Cloudflare Workers" },
    { name: "Python" },
    { name: "Postgres" },
    { name: "Drizzle" },
    { name: "Tailwind" },
    { name: "Anthropic SDK" },
  ],
  work: [
    {
      id: "work-flightcast",
      company: "Flightcast",
      title: "Founding Engineer",
      start: "Aug 2024",
      end: "Present",
      location: "Remote",
      description:
        "Shipping AI-heavy features end-to-end. Rebuilt core scanning pipeline to cut profile-generation latency, moved infra to Cloudflare Workers + D1 + R2, and own the public portfolio surface.",
      href: "https://flightcast.ai",
      badges: ["Founding"],
    },
    {
      id: "work-buildspace",
      company: "buildspace",
      title: "Builder (s3 / s4 / sf1 / s5)",
      start: "2022",
      end: "2024",
      location: "Remote",
      description:
        "Shipped multiple consumer-grade projects across cohorts, iterating in public on Twitter. Graduated from sf1 in-person cohort with a working product + paying users.",
      href: "https://buildspace.so",
      badges: [],
    },
  ],
  education: [
    {
      id: "edu-buildspace",
      school: "buildspace",
      degree: "s3 · s4 · sf1 · s5",
      start: "2022",
      end: "2024",
      href: "https://buildspace.so",
    },
    {
      id: "edu-college",
      school: "MIT World Peace University",
      degree: "B.Tech, Computer Science",
      start: "2019",
      end: "2023",
    },
  ],
  projects: [
    {
      id: "proj-gitshow",
      title: "gitshow",
      description:
        "Scrapes a developer's entire GitHub — code, commits, READMEs — and writes a beautiful, editable portfolio site from it. Built on Cloudflare Workers + D1 + R2, with a Bun/Fly pipeline doing the deep AI work.",
      dates: "2025 - Present",
      active: true,
      technologies: ["Next.js", "TypeScript", "Cloudflare Workers", "D1", "R2", "Anthropic"],
      links: [
        { label: "Website", href: "https://gitshow.io", iconKey: "globe" },
        { label: "Source", href: "https://github.com/yatendra2001/gitshow", iconKey: "github" },
      ],
      href: "https://gitshow.io",
    },
    {
      id: "proj-flightcast",
      title: "Flightcast",
      description:
        "AI-first flight-alerting and -planning for power travelers. I own the product surface and the scanning pipeline.",
      dates: "2024 - Present",
      active: true,
      technologies: ["Next.js", "Python", "Postgres", "OpenAI", "Anthropic"],
      links: [
        { label: "Website", href: "https://flightcast.ai", iconKey: "globe" },
      ],
      href: "https://flightcast.ai",
    },
  ],
  buildLog: [
    {
      id: "bl-gitshow",
      title: "gitshow",
      dates: "2025",
      description: "Git-history-to-portfolio engine. Cloudflare Workers + D1 + R2, Bun pipeline on Fly.",
      primaryLanguage: "TypeScript",
      languageColor: "#3178c6",
      links: [
        { label: "GitHub", href: "https://github.com/yatendra2001/gitshow", iconKey: "github" },
        { label: "Site", href: "https://gitshow.io", iconKey: "globe" },
      ],
    },
    {
      id: "bl-flightcast",
      title: "Flightcast",
      dates: "2024 - Present",
      description: "AI-first flight planner + alerts. Founding engineer.",
      primaryLanguage: "TypeScript",
      languageColor: "#3178c6",
      links: [
        { label: "Site", href: "https://flightcast.ai", iconKey: "globe" },
      ],
    },
    {
      id: "bl-s5-demo",
      title: "buildspace s5 demo",
      dates: "Summer 2024",
      description: "Rapid-prototype consumer AI app shipped during the buildspace s5 cohort.",
      primaryLanguage: "TypeScript",
      languageColor: "#3178c6",
      links: [],
    },
    {
      id: "bl-sf1",
      title: "buildspace sf1 project",
      dates: "2023",
      description: "Built a paying-user product at the in-person San Francisco cohort. Shipped in 6 weeks.",
      primaryLanguage: "Python",
      languageColor: "#3572A5",
      links: [],
    },
  ],
  blog: [],
  theme: { mode: "dark" },
  sections: {
    order: ["hero", "about", "work", "education", "skills", "projects", "buildLog", "contact"],
    hidden: [],
  },
  meta: {
    version: 1,
    updatedAt: NOW,
    generatedAt: NOW,
    sourceTags: {},
  },
});

const jsonPath = `/tmp/resume-${HANDLE}.json`;
writeFileSync(jsonPath, JSON.stringify(resume, null, 2));
console.log(`✓ Wrote ${jsonPath}`);

const bucketName = "gitshow-scans";
const key = `resumes/${HANDLE}/published.json`;

console.log(`Uploading to local R2: ${bucketName}/${key}`);
execSync(
  `wrangler r2 object put "${bucketName}/${key}" --file="${jsonPath}" --local --content-type="application/json"`,
  { stdio: "inherit" },
);

console.log(`\nDone. Render target: http://localhost:3000/${HANDLE}`);
