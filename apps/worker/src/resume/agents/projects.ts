/**
 * projects-agent — populates the curated top-N "My Projects" grid.
 *
 * Quality-critical. Each featured project fans out into its own
 * independent LLM agent equipped with:
 *   - browse_web / search_web (per-project budget of 5 queries)
 *   - read_file / search_codebase (for README + source context)
 *   - parsed dependency manifest as pre-resolved technology list
 *
 * Hard rules the agent must follow:
 *   - Every factual claim in `description` (user counts, press, adoption,
 *     revenue, awards) has a corresponding URL in `sources[]`.
 *   - Links[] are constructed deterministically from source metadata;
 *     the LLM proposes ADDITIONAL links discovered from web research
 *     (launch posts, HN thread, Product Hunt) with iconKey hints we can
 *     resolve at render time.
 *   - No placeholder prose ("revolutionary", "powerful"). Terse specifics.
 *
 * The per-project run is bounded: 5 web queries, 2 GitHub searches, 10
 * code reads. If the agent burns through without producing substance,
 * we fall back to a minimal deterministic card (README's first para).
 */

import * as z from "zod/v4";
import pLimit from "p-limit";
import type { ScanSession, Artifact } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { GitHubData, RepoRef } from "../../types.js";
import { runAgentWithSubmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import { createWorkerTools } from "../../tools/web.js";
import { parseDependencies } from "../dep-parser.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export const ProjectLinkSchema = z.object({
  label: z.string().max(40),
  href: z.string().url(),
  iconKey: z.string().max(40).default("generic"),
});
export type ProjectLink = z.infer<typeof ProjectLinkSchema>;

export const ProjectAgentOutputSchema = z.object({
  /** Display title. Usually the repo name unless the product brands differently. */
  title: z.string().max(120),
  /**
   * Markdown description. 1-2 sentences, hard-capped at ~280 chars to
   * match the reference portfolio's project card density. Every
   * factual claim must be backed by an entry in sources[].
   */
  description: z.string().max(280),
  /** "Jan 2024 - Present" / "Nov 2023 - Feb 2024" / "2022". */
  dates: z.string().max(80),
  active: z.boolean().default(false),
  /** Extra links the agent discovered via web research. Source URL only — the pipeline classifies iconKey from the host. */
  extra_links: z
    .array(
      z.object({
        label: z.string().max(40),
        href: z.string().url(),
      }),
    )
    .max(8)
    .default([]),
  /**
   * URLs the agent used as evidence. Every adoption / press / metric claim
   * in `description` should have a corresponding entry here.
   */
  sources: z.array(z.string().url()).max(15).default([]),
});
export type ProjectAgentOutput = z.infer<typeof ProjectAgentOutputSchema>;

export interface ProjectsAgentInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  artifacts: Record<string, Artifact>;
  featuredFullNames: string[];
  /** Absolute path to the per-scan working directory (for web-cache + repo clones). */
  profileDir: string;
  /** Per-project web query budget. Default: 5. */
  webBudgetPerProject?: number;
  onProgress?: (text: string) => void;
}

/** Final shape the assembler expects (matches Resume.projects entry). */
export interface Project {
  id: string;
  title: string;
  description: string;
  dates: string;
  active: boolean;
  technologies: string[];
  links: ProjectLink[];
  image?: string;
  video?: string;
  href?: string;
  sources: string[];
}

const PROJECT_CONCURRENCY = 3;
const DEFAULT_WEB_BUDGET_PER_PROJECT = 5;
const DEFAULT_GITHUB_SEARCH_BUDGET_PER_PROJECT = 2;

const SYSTEM_PROMPT = `You write ONE project card for a developer's portfolio.

You have tools:
  - browse_web(url, reason) — fetch an external page (blog post, Product Hunt, HN thread, docs site)
  - search_web(query) — run a web search
  - search_github(query) — search GitHub
  - read_file(repo, path) / search_codebase(...) — read the actual repo source

You also have pre-computed context: the repo's GitHub description, README preview, language mix, stargazers, first/last commit dates, and a parsed list of technologies from its manifest files (package.json, go.mod, etc.).

Your output — produced via submit_project — has fields:
  title, description (markdown, 1-2 sentences, ≤280 chars), dates, active, extra_links[], sources[]

Rules that determine quality:

1. Grounded facts only. Every adoption / users / press / award claim in the description has a matching URL in sources[]. If you can't source it, don't claim it. Numbers without a source do not belong in a portfolio.

2. Web research budget: ~5 queries. Spend them on:
   - a direct search for the product name + developer's GitHub handle to find launch posts / press
   - HN / Product Hunt / dev.to / Medium search for the project name
   - the deployed URL if one exists in the repo metadata
   - one query for user counts / adoption if there's any signal the project shipped to users

3. NEVER invent links. Only put URLs in sources[] or extra_links[] that you actually loaded via browse_web (cached is fine).

4. description style: short. 1-2 sentences, ≤280 chars total. Lead with WHAT it is, then the single strongest signal (launch, traction, context). Skip build-log trivia ("implemented X, added Y") — that belongs in the build-log section, not the featured card. Reference-portfolio examples of the right density:
   - "Designed, developed and sold animated UI components for developers." (65 chars, 1 sentence)
   - "Developed an open-source logging and analytics platform for OpenAI: log your ChatGPT API requests, analyze costs, and improve your prompts." (137 chars, 1 sentence)
   - "With the release of the OpenAI GPT Store, I built a SaaS that collects email addresses from GPT users — a way to build an audience and monetize your GPT API usage." (2 sentences, ~260 chars)

5. dates: pull from the commit date range in the input. Format like "Jan 2024 - Feb 2024" or "June 2023 - Present" if active=true.

6. active: true when the repo is not archived AND last push is within 6 months.

7. Call submit_project EXACTLY ONCE when done. Don't narrate after.`;

export async function runProjectsAgent(input: ProjectsAgentInput): Promise<Project[]> {
  const repos = input.featuredFullNames
    .map((fn) => input.github.ownedRepos.find((r) => r.fullName === fn))
    .filter((r): r is RepoRef => !!r);

  if (repos.length === 0) return [];

  const log = input.onProgress ?? (() => {});
  log(`\n[projects] fanning out ${repos.length} featured repos @ concurrency ${PROJECT_CONCURRENCY}\n`);

  const limit = pLimit(PROJECT_CONCURRENCY);
  const results = await Promise.all(
    repos.map((repo) =>
      limit(() =>
        runSingleProjectAgent({
          session: input.session,
          usage: input.usage,
          repo,
          artifacts: input.artifacts,
          profileDir: input.profileDir,
          webBudget: input.webBudgetPerProject ?? DEFAULT_WEB_BUDGET_PER_PROJECT,
          onProgress: input.onProgress,
        }),
      ),
    ),
  );

  return results;
}

interface SingleProjectInput {
  session: ScanSession;
  usage: SessionUsage;
  repo: RepoRef;
  artifacts: Record<string, Artifact>;
  profileDir: string;
  webBudget: number;
  onProgress?: (text: string) => void;
}

async function runSingleProjectAgent(input: SingleProjectInput): Promise<Project> {
  const { session, usage, repo, artifacts, profileDir, webBudget, onProgress } = input;
  const log = onProgress ?? (() => {});

  // Resolve technologies deterministically before the LLM runs, so the
  // agent doesn't burn queries guessing the stack.
  const clonePath = join(profileDir, "repos", repo.fullName.replace(/\//g, "-"));
  let technologies: string[] = repo.languages.slice(0, 8);
  if (existsSync(clonePath)) {
    try {
      const parsed = await parseDependencies(clonePath);
      if (parsed.technologies.length > 0) {
        // Merge — languages + packages, packages first (more specific).
        technologies = Array.from(
          new Set([...parsed.technologies.slice(0, 10), ...repo.languages.slice(0, 4)]),
        ).slice(0, 10);
      }
    } catch {
      /* leave languages-only */
    }
  }

  // Pre-read the README if present so the prompt carries it directly —
  // saves a read_file tool call on the common path.
  const readmePreview = await readReadmePreview(clonePath);

  // Per-project artifact sink so the agent can cite any new `web`
  // artifacts it pulls (HN threads, launch posts, etc.) — these merge
  // back into the global table at the pipeline level.
  const artifactSink: Record<string, Artifact> = {};
  const tools = createWorkerTools({
    session,
    usage,
    artifacts,
    artifactSink,
    profileDir,
    webBudget,
    githubSearchBudget: DEFAULT_GITHUB_SEARCH_BUDGET_PER_PROJECT,
    log,
    handle: session.handle,
    includeCodeTools: true,
  });

  const userMessage = buildInput({
    repo,
    technologies,
    readmePreview,
    artifacts,
  });

  let result: ProjectAgentOutput;
  try {
    const run = await runAgentWithSubmit({
      model: modelForRole("section"),
      systemPrompt: SYSTEM_PROMPT,
      input: userMessage,
      extraTools: tools,
      submitToolName: "submit_project",
      submitToolDescription:
        "Submit the fully-researched project card. Call exactly once when done.",
      submitSchema: ProjectAgentOutputSchema,
      reasoning: { effort: "high" },
      session,
      usage,
      label: `resume:project:${repo.name}`,
      onProgress,
      maxIterations: 40,
    });
    result = run.result;
  } catch (err) {
    log(`[projects] ${repo.fullName} — agent failed, using minimal fallback: ${(err as Error).message.slice(0, 80)}\n`);
    return buildFallback(repo, technologies);
  }

  // Assemble final project. Links come from deterministic sources first
  // (repo URL, website) then the agent's discovered extra_links.
  const links: ProjectLink[] = [];
  links.push({
    label: "Source",
    href: `https://github.com/${repo.fullName}`,
    iconKey: "github",
  });
  for (const l of result.extra_links) {
    links.push({
      label: l.label,
      href: l.href,
      iconKey: inferIconKeyFromHost(l.href),
    });
  }

  return {
    id: `proj:${repo.fullName}`,
    title: result.title || repo.name,
    description: result.description,
    dates: result.dates || fallbackDates(repo),
    active: result.active,
    technologies: sanitizeTechnologies(technologies),
    links,
    href: `https://github.com/${repo.fullName}`,
    sources: result.sources,
  };
}

/**
 * Last line of defence before Zod validation in assemble.ts. Upstream
 * data (GitHub's `languages`, parsed manifests) occasionally contains
 * null/undefined/empty entries — one bad item here fails the whole scan
 * with an opaque "expected string, received undefined" error.
 */
function sanitizeTechnologies(items: ReadonlyArray<unknown>): string[] {
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return Array.from(new Set(out));
}

function buildInput(args: {
  repo: RepoRef;
  technologies: string[];
  readmePreview: string | null;
  artifacts: Record<string, Artifact>;
}): string {
  const { repo, technologies, readmePreview, artifacts } = args;
  const lines: string[] = [];

  lines.push(`## Project: ${repo.fullName}`);
  if (repo.description) lines.push(`GitHub description: ${repo.description}`);
  if (repo.primaryLanguage) lines.push(`Primary language: ${repo.primaryLanguage}`);
  if (repo.stargazerCount) lines.push(`Stars: ${repo.stargazerCount}`);
  if (repo.forkCount) lines.push(`Forks: ${repo.forkCount}`);
  if (repo.createdAt) lines.push(`Created: ${repo.createdAt}`);
  if (repo.pushedAt) lines.push(`Last push: ${repo.pushedAt}`);
  lines.push(`Archived: ${repo.isArchived}`);
  lines.push("");

  lines.push(`## Technologies (parsed from manifests + languages)`);
  lines.push(technologies.join(", ") || "(none detected)");
  lines.push("");

  // Pull any activity/ownership metadata from the inventory artifact.
  const inv = artifacts[`inventory:${repo.fullName}`];
  if (inv) {
    const m = inv.metadata as Record<string, unknown>;
    lines.push(`## Inventory signals`);
    if (m.first_commit) lines.push(`First commit: ${m.first_commit}`);
    if (m.last_commit) lines.push(`Last commit: ${m.last_commit}`);
    if (m.user_commits) lines.push(`User commits: ${m.user_commits}`);
    if (m.looks_like_team_repo) lines.push(`Team repo: yes (${m.total_contributors} contributors)`);
    if (m.features_shipped) lines.push(`Features shipped: ${m.features_shipped}`);
    lines.push("");
  }

  if (readmePreview) {
    lines.push(`## README (first 4000 chars)`);
    lines.push(readmePreview);
    lines.push("");
  }

  lines.push(`---`);
  lines.push(
    `Research this project. Use up to 5 web queries to find launch posts, HN, press, adoption signals. Every impact claim in your description needs a URL in sources[]. Produce submit_project.`,
  );
  return lines.join("\n");
}

async function readReadmePreview(clonePath: string): Promise<string | null> {
  if (!existsSync(clonePath)) return null;
  const candidates = ["README.md", "readme.md", "README.MD", "Readme.md", "README.rst", "README"];
  for (const c of candidates) {
    const full = join(clonePath, c);
    if (!existsSync(full)) continue;
    try {
      const text = await readFile(full, "utf-8");
      return text.slice(0, 4000);
    } catch {
      /* try next */
    }
  }
  return null;
}

function inferIconKeyFromHost(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("github.com")) return "github";
    if (host.includes("news.ycombinator.com")) return "generic";
    if (host.includes("producthunt.com")) return "producthunt";
    if (host.includes("medium.com")) return "medium";
    if (host.includes("dev.to")) return "devto";
    if (host.includes("hashnode")) return "hashnode";
    if (host.includes("substack.com")) return "substack";
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
    if (host.includes("twitter.com") || host.includes("x.com")) return "x";
  } catch {
    /* fall through */
  }
  return "globe";
}

function fallbackDates(repo: RepoRef): string {
  const first = formatMonthYear(repo.createdAt);
  const last = repo.pushedAt ? formatMonthYear(repo.pushedAt) : "";
  if (!first) return "";
  if (!last || first === last) return first;
  return `${first} - ${last}`;
}

function formatMonthYear(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 7);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * When the LLM agent fails entirely, produce a minimal but factually
 * safe project card using only GitHub metadata — no claims, no sources.
 */
function buildFallback(repo: RepoRef, technologies: string[]): Project {
  return {
    id: `proj:${repo.fullName}`,
    title: repo.name,
    description:
      repo.description ??
      `${repo.primaryLanguage ?? "Open source"} project: ${repo.name}.`,
    dates: fallbackDates(repo),
    active: !repo.isArchived,
    technologies: sanitizeTechnologies(technologies),
    links: [
      {
        label: "Source",
        href: `https://github.com/${repo.fullName}`,
        iconKey: "github",
      },
    ],
    href: `https://github.com/${repo.fullName}`,
    sources: [],
  };
}
