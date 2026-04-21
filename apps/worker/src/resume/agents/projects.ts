/**
 * projects-agent — populates the curated top-N "My Projects" grid.
 *
 * This is the quality-critical agent. Each featured project fans out into
 * its own independent LLM call with:
 *   - Full README access via tools/code (read_file).
 *   - Web research via tools/web (browse_web, search_web). Budget per
 *     project: 3-5 queries, targeting launch posts, press, HN, Twitter.
 *   - Dependency-file parsing (package.json / go.mod / Cargo.toml /
 *     pyproject.toml / Gemfile) for accurate tech stack.
 *
 * The output is a rich Project with:
 *   - title, description (markdown), dates, active flag
 *   - technologies[] — extracted from actual dep files, not guessed
 *   - links[] — source + live + press/launch links with iconKey
 *   - sources[] — URLs the LLM used as evidence for impact claims
 *
 * ## Current status
 *
 * Scaffold — this module defines the output schema, the per-project
 * agent function signature, and the fan-out orchestration. The actual
 * prompt + tool wiring is stubbed (see TODO markers); the agent today
 * returns a minimal Project pulling only from GitHub metadata so the
 * full pipeline has something valid to assemble. The next commit wires
 * browse_web + search_web + package-json parsing into the prompt.
 */

import * as z from "zod/v4";
import pLimit from "p-limit";
import type { ScanSession, Artifact } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { GitHubData, RepoRef } from "../../types.js";

export const ProjectLinkSchema = z.object({
  label: z.string().max(40),
  href: z.string().url(),
  iconKey: z.string().max(40).default("generic"),
});
export type ProjectLink = z.infer<typeof ProjectLinkSchema>;

export const ProjectAgentOutputSchema = z.object({
  id: z.string(),
  title: z.string().max(120),
  description: z.string().max(2000),
  dates: z.string().max(80),
  active: z.boolean().default(false),
  technologies: z.array(z.string().max(40)).max(20).default([]),
  links: z.array(ProjectLinkSchema).max(10).default([]),
  image: z.string().url().optional(),
  video: z.string().url().optional(),
  href: z.string().url().optional(),
  /** URLs the agent used as evidence for impact claims. Not rendered; kept for audit. */
  sources: z.array(z.string().url()).default([]),
});
export type ProjectAgentOutput = z.infer<typeof ProjectAgentOutputSchema>;

export interface ProjectsAgentInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  artifacts: Record<string, Artifact>;
  /** Featured candidate full-names, pre-picked by the quick-scan stage. */
  featuredFullNames: string[];
  onProgress?: (text: string) => void;
}

/**
 * Concurrency of per-project agents. Three in flight is the sweet spot —
 * higher eats rate limits on the secondary scraper (Jina) during web
 * research and the OpenRouter concurrent-session caps at higher tiers.
 */
const PROJECT_CONCURRENCY = 3;

export async function runProjectsAgent(
  input: ProjectsAgentInput,
): Promise<ProjectAgentOutput[]> {
  const repos = input.featuredFullNames
    .map((fn) => input.github.ownedRepos.find((r) => r.fullName === fn))
    .filter((r): r is RepoRef => !!r);

  if (repos.length === 0) return [];

  const log = input.onProgress ?? (() => {});
  log(`\n[projects] fanning out ${repos.length} featured repos @ concurrency ${PROJECT_CONCURRENCY}\n`);

  const limit = pLimit(PROJECT_CONCURRENCY);
  const results = await Promise.all(
    repos.map((repo, i) =>
      limit(() =>
        runSingleProjectAgent({
          session: input.session,
          usage: input.usage,
          repo,
          artifacts: input.artifacts,
          index: i,
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
  index: number;
  onProgress?: (text: string) => void;
}

/**
 * Deep-research one project.
 *
 * TODO (next commit): wire browse_web, search_web, and dep-file parser
 * tools into a full agent loop. Target prompt structure:
 *
 *   System: "You produce the public-facing card for ONE shipped project.
 *   Run up to 5 web queries to find launch posts, press, user counts,
 *   HN threads. Cite every factual claim via the sources[] array."
 *
 *   Tools: read_file (code), browse_web, search_web (each with budget
 *   counters tracked on SessionUsage), submit_project.
 *
 *   Input: repo metadata, README (full), dep files, GitHub topics,
 *   stargazer count, forks, homepage, first/last commit dates.
 *
 *   Output: ProjectAgentOutput with description (markdown, 2-4 sentences,
 *   impact-led), technologies[] from dep files, links[] including any
 *   press/launch URLs discovered, sources[] listing every web URL used.
 *
 * For the scaffold this function returns a minimal Project using only
 * repo metadata, so the full pipeline can run end-to-end without missing
 * data. The resulting card is factually correct but shallow — no web
 * research, no impact claims, just "{name}: {github_description}".
 */
async function runSingleProjectAgent(input: SingleProjectInput): Promise<ProjectAgentOutput> {
  const { repo } = input;

  const description =
    repo.description ??
    `${repo.primaryLanguage ?? "Open source"} project: ${repo.name}.`;

  const links: ProjectLink[] = [];
  links.push({
    label: "Source",
    href: `https://github.com/${repo.fullName}`,
    iconKey: "github",
  });

  return {
    id: `proj:${repo.fullName}`,
    title: repo.name,
    description,
    dates: formatDates(repo.createdAt, repo.pushedAt),
    active: !repo.isArchived,
    technologies: repo.languages.slice(0, 8),
    links,
    href: `https://github.com/${repo.fullName}`,
    sources: [],
  };
}

function formatDates(firstISO: string | null | undefined, lastISO: string | null | undefined): string {
  if (!firstISO) return "";
  const first = formatMonthYear(firstISO);
  if (!lastISO) return first;
  const last = formatMonthYear(lastISO);
  if (first === last) return first;
  return `${first} - ${last}`;
}

function formatMonthYear(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 7);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
