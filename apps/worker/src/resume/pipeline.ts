/**
 * Resume pipeline orchestrator.
 *
 * Produces a validated `Resume` JSON from a GitHub handle + optional
 * LinkedIn / socials / intake notes. Runs parallel to the legacy claim
 * pipeline at `apps/worker/src/pipeline.ts`; neither is deleted until
 * the new one is verified end-to-end.
 *
 * Stage map:
 *   1. github-fetch        — all owned repos + PRs + reviews + profile.
 *   2. repo-filter         — tier repos (deep / light / metadata).
 *   3. inventory           — clone deep-tier repos, run git-archaeology
 *                            for accurate first-commit dates + team-repo
 *                            signals + language LOC totals.
 *   4. normalize           — artifact table with inventory enrichment.
 *   5. discover            — one Opus/Sonnet pass to produce the
 *                            investigation_angles + primary_shape that
 *                            frame the person-agent's summary.
 *   6. pick-featured       — ~20 top repos for deep per-project research.
 *   7. section agents      — parallel: build-log, skills, projects,
 *                            work, education (projects is itself a
 *                            fan-out of 20 sub-agents with web research).
 *   8. person              — after the parallel batch so summary can
 *                            reference project titles + work companies.
 *   9. contact             — rule-based, zero LLM.
 *  10. assemble            — merge + Zod-validate into Resume.
 *  11. persist             — write draft.json to R2 when cloud env present.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import pLimit from "p-limit";

import { fetchGitHubData } from "../github-fetcher.js";
import { filterRepos } from "../repo-filter.js";
import { cloneAndInventory } from "../inventory-runner.js";
import { normalize } from "../normalize.js";
import { runDiscover } from "../agents/discover.js";
import type { ScanSession } from "../schemas.js";
import type { StructuredInventory } from "../types.js";
import type { SessionUsage } from "../session.js";
import { pickFeatured } from "./pick-featured.js";
import { runPersonAgent } from "./agents/person.js";
import { runSkillsAgent } from "./agents/skills.js";
import { runBuildLogAgent } from "./agents/build-log.js";
import { runProjectsAgent } from "./agents/projects.js";
import { runWorkAgent } from "./agents/work.js";
import { runEducationAgent } from "./agents/education.js";
import { runContactAgent } from "./agents/contact.js";
import { runBlogImportAgent } from "./agents/blog-import.js";
import { assembleResume } from "./assemble.js";
import { writeDraftResume } from "./persist.js";
import type { Resume } from "@gitshow/shared/resume";

/**
 * Max repos we'll clone + git-inventory. Above this we skip inventory
 * on the least-significant repos and fall back to raw GitHub metadata.
 * Keeps the pipeline bounded for prolific users with hundreds of repos.
 */
const INVENTORY_CAP = 15;
const INVENTORY_CONCURRENCY = 3;

export interface RunResumePipelineOptions {
  session: ScanSession;
  usage: SessionUsage;
  /**
   * Scratch directory for clones + web-cache. Defaults to
   * `profiles/{handle}/`. In cloud mode the caller passes a Fly-local
   * path (e.g. `/data/scans/{scanId}/`).
   */
  profileDir?: string;
  /**
   * When set, the resulting Resume is uploaded to R2 at
   * `resumes/{handle}/draft.json`. Enabled automatically in cloud mode
   * via env detection in `persist.ts`.
   */
  writeToR2?: boolean;
  onProgress?: (text: string) => void;
}

export async function runResumePipeline(
  opts: RunResumePipelineOptions,
): Promise<Resume> {
  const { session, usage, onProgress } = opts;
  const log = onProgress ?? ((t: string) => process.stdout.write(t));
  const profileDir = opts.profileDir ?? `profiles/${session.handle}`;
  await mkdir(profileDir, { recursive: true });

  // 1. Collect GitHub data
  log(`\n[pipeline] stage 1: github fetch\n`);
  const github = await fetchGitHubData(session.handle);

  // 2. Tier repos for inventory depth
  log(`[pipeline] stage 2: repo filter\n`);
  const filtered = filterRepos(github);
  log(
    `[pipeline]   deep=${filtered.deep.length}  light=${filtered.light.length}  metadata=${filtered.metadata.length}  external=${filtered.external.length}\n`,
  );

  // 3. Inventory deep repos in parallel — bounded concurrency, capped
  //    overall so we don't die on a yatendra2001 with 500 repos.
  log(`[pipeline] stage 3: inventory (cap ${INVENTORY_CAP}, concurrency ${INVENTORY_CONCURRENCY})\n`);
  const toInventory = filtered.deep.slice(0, INVENTORY_CAP);
  const inventoryLimit = pLimit(INVENTORY_CONCURRENCY);
  const inventories: Record<string, StructuredInventory> = {};
  await Promise.all(
    toInventory.map((repo) =>
      inventoryLimit(async () => {
        try {
          const inv = await cloneAndInventory({
            fullName: repo.fullName,
            handle: session.handle,
            profileDir,
            log,
          });
          inventories[repo.fullName] = inv;
        } catch (err) {
          log(`[inv] ${repo.fullName} failed: ${(err as Error).message.slice(0, 80)}\n`);
        }
      }),
    ),
  );

  // 4. Normalize — artifact table w/ inventory enrichment
  log(`[pipeline] stage 4: normalize\n`);
  const { artifacts, indexes } = normalize({ github, inventories });

  // 5. Discover — frames downstream person-agent with investigation
  //    angles + primary_shape.
  log(`[pipeline] stage 5: discover\n`);
  const discover = await runDiscover({
    session,
    usage,
    github,
    artifacts,
    indexes,
    onProgress,
  });

  // 6. Pick featured set for deep per-project research
  const featured = pickFeatured(github, artifacts);
  log(`[pipeline] picked ${featured.length} featured repos\n`);

  // 7. Parallel section agents.
  log(`[pipeline] stage 7: section agents (parallel)\n`);
  const [buildLog, skills, projects, work, education, blog] = await Promise.all([
    runBuildLogAgent({ session, usage, github, artifacts, onProgress }),
    runSkillsAgent({ session, usage, github, artifacts, onProgress }),
    runProjectsAgent({
      session,
      usage,
      github,
      artifacts,
      featuredFullNames: featured,
      profileDir,
      onProgress,
    }),
    runWorkAgent({ session, usage, github, artifacts, onProgress }),
    runEducationAgent({ session, usage, github, artifacts, onProgress }),
    runBlogImportAgent({
      session,
      usage,
      urls: session.blog_urls ?? [],
      onProgress,
    }),
  ]);

  // 8. Person — post-synthesis so the summary can reference
  //    project titles, work companies, education schools.
  log(`[pipeline] stage 8: person (post-synthesis)\n`);
  const person = await runPersonAgent({
    session,
    usage,
    github,
    discover,
    artifacts,
    featuredProjects: projects.slice(0, 6).map((p) => ({
      title: p.title,
      summary: p.description.slice(0, 160),
    })),
    workCompanies: work.map((w) => w.company),
    educationSchools: education.map((e) => e.school),
    onProgress,
  });

  // 9. Contact — rules only.
  log(`[pipeline] stage 9: contact\n`);
  const contact = runContactAgent({ session, github });

  // 10. Assemble
  log(`[pipeline] stage 10: assemble\n`);
  const resume = assembleResume({
    session,
    github,
    person,
    skills,
    projects,
    buildLog,
    work,
    education,
    contact,
    blog,
  });

  log(
    `[pipeline] done. ${projects.length} projects, ${buildLog.length} build-log entries, ${skills.skills.length} skills, ${blog.length} blog posts.\n`,
  );

  // 11. Persist to R2 when requested (cloud mode) or when
  //     R2_BUCKET_NAME is present (dev-with-real-R2 flag).
  if (opts.writeToR2 || process.env.R2_BUCKET_NAME) {
    log(`[pipeline] stage 11: write draft.json to R2\n`);
    try {
      await writeDraftResume({ handle: session.handle, resume, log });
    } catch (err) {
      log(
        `[pipeline] R2 write failed: ${(err as Error).message.slice(0, 160)}\n`,
      );
    }
  }

  return resume;
}
