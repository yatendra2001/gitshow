/**
 * Resume pipeline orchestrator.
 *
 * Runs the Phase 2 agents in dependency order and produces a validated
 * `Resume` JSON. Runs parallel to the existing claim pipeline at
 * `apps/worker/src/pipeline.ts` — neither is deleted until the new one
 * is verified end-to-end.
 *
 * Stage map (scaffold commit):
 *   1. github-fetch          — reuse github-fetcher.ts
 *   2. normalize (empty inv) — artifact table from raw GitHub data only
 *   3. pick-featured         — select top ~20 project candidates
 *   4. parallel section agents — build-log, skills, projects, work, education
 *   5. person-agent          — runs after the parallel batch so summary can
 *                              reference project titles + work companies
 *   6. contact               — rule-based, zero LLM
 *   7. assemble              — merge into validated Resume JSON
 *
 * Deliberately skipped in this scaffold (wire in next commit):
 *   - inventory-runner (cloned git repos for temporal/durability stats)
 *   - existing discover agent (useful signal for person-agent framing)
 *   - intake Q&A sourcing for work/education
 *   - per-project web research inside projects-agent
 */

import { fetchGitHubData } from "../github-fetcher.js";
import { normalize } from "../normalize.js";
import type { ScanSession } from "../schemas.js";
import type { SessionUsage } from "../session.js";
import { pickFeatured } from "./pick-featured.js";
import { runPersonAgent } from "./agents/person.js";
import { runSkillsAgent } from "./agents/skills.js";
import { runBuildLogAgent } from "./agents/build-log.js";
import { runProjectsAgent } from "./agents/projects.js";
import { runWorkAgent } from "./agents/work.js";
import { runEducationAgent } from "./agents/education.js";
import { runContactAgent } from "./agents/contact.js";
import { assembleResume } from "./assemble.js";
import type { Resume } from "@gitshow/shared/resume";

export interface RunResumePipelineOptions {
  session: ScanSession;
  usage: SessionUsage;
  onProgress?: (text: string) => void;
}

export async function runResumePipeline(
  opts: RunResumePipelineOptions,
): Promise<Resume> {
  const { session, usage, onProgress } = opts;
  const log = onProgress ?? ((t: string) => process.stdout.write(t));

  // 1. Collect GitHub data
  log(`\n[pipeline] stage 1: github fetch\n`);
  const github = await fetchGitHubData(session.handle);

  // 2. Normalize artifact table. No inventory data yet — scaffold runs
  //    on raw GitHub metadata only. When we wire inventory in the next
  //    commit, pass `inventories` here instead of `{}`.
  log(`[pipeline] stage 2: normalize (no inventory)\n`);
  const { artifacts } = normalize({ github, inventories: {} });

  // 3. Pick featured
  const featured = pickFeatured(github, artifacts);
  log(`[pipeline] picked ${featured.length} featured repos\n`);

  // 4. Parallel section agents. Person depends on project/work/edu
  //    outputs (for summary cross-linking), so it runs after.
  log(`[pipeline] stage 4: section agents (parallel)\n`);
  const [buildLog, skills, projects, work, education] = await Promise.all([
    runBuildLogAgent({ session, usage, github, artifacts, onProgress }),
    runSkillsAgent({ session, usage, github, artifacts, onProgress }),
    runProjectsAgent({
      session,
      usage,
      github,
      artifacts,
      featuredFullNames: featured,
      onProgress,
    }),
    runWorkAgent({ session, usage, github, artifacts, onProgress }),
    runEducationAgent({ session, usage, github, artifacts, onProgress }),
  ]);

  // 5. Person (post-synthesis — needs other agents' output to write the
  //    cross-linked summary paragraph)
  log(`[pipeline] stage 5: person (post-synthesis)\n`);
  // In the scaffold we don't run the existing discover agent; give person
  // a minimal stand-in. Next commit wires real discover output here.
  const placeholderDiscover = {
    distinctive_paragraph: github.profile.bio ?? "",
    investigation_angles: [],
    primary_shape: "builder",
  };
  const person = await runPersonAgent({
    session,
    usage,
    github,
    discover: placeholderDiscover,
    artifacts,
    featuredProjects: projects.slice(0, 6).map((p) => ({
      title: p.title,
      summary: p.description.slice(0, 160),
    })),
    workCompanies: work.map((w) => w.company),
    educationSchools: education.map((e) => e.school),
    onProgress,
  });

  // 6. Contact (no LLM)
  log(`[pipeline] stage 6: contact\n`);
  const contact = runContactAgent({ session, github });

  // 7. Assemble
  log(`[pipeline] stage 7: assemble\n`);
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
  });

  log(
    `[pipeline] done. ${projects.length} projects, ${buildLog.length} build-log entries, ${skills.skills.length} skills.\n`,
  );
  return resume;
}
