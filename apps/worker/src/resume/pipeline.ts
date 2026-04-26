/**
 * Resume pipeline orchestrator (KG-first).
 *
 * Stage map per session-8 §15:
 *   1. github-fetch         — owned repos + PRs + reviews + profile
 *   2. repo-filter          — tier repos (deep / light / metadata)
 *   3. inventory            — clone deep-tier repos for the Repo Judge
 *   4. repo-judge           — Kimi reads README + tree + samples per repo;
 *                             produces Judgment{kind, polish, shouldFeature, …}
 *   5. fetcher fan-out      — github-facts (sync) + linkedin tier chain +
 *                             personal-site + hn/devto/medium +
 *                             orcid + semantic-scholar + arxiv + stackoverflow
 *                             + youtube + blog-import. All emit TypedFacts.
 *   6. merge-facts          — fuse all TypedFacts into one KnowledgeGraph
 *                             (deterministic + LLM pair-resolution)
 *   7. apply-judgments      — overlay per-repo Judgments onto Project nodes
 *   8. media-fetch          — og → README hero → YouTube → Gemini gen for
 *                             projects; Clearbit/favicon for companies/schools
 *   9. persist-kg           — write latest.json + scan-{id}.json to R2
 *  10. evaluate-kg          — blocking-error gate + warnings
 *  11. hero-prose           — single Opus call → description + summary
 *  12. render-from-kg       — pure Resume projection (zero LLM)
 *  13. persist-resume       — write draft.json to R2
 *  14. persist-trace        — write trace.json to R2
 */

import { mkdir } from "node:fs/promises";
import pLimit from "p-limit";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { fetchGitHubData } from "../github-fetcher.js";
import { filterRepos } from "../repo-filter.js";
import { cloneAndInventory } from "../inventory-runner.js";
import { studyRepo, type RepoStudy } from "../repo-study.js";
import { aggregateSkillsFromStudies } from "./skills/aggregate-from-manifests.js";
import type { ScanSession } from "../schemas.js";
import type { GitHubData, StructuredInventory } from "../types.js";
import type { SessionUsage } from "../session.js";

import { judgeAllRepos, type RepoJudgeOutput } from "./judge/repo-judge.js";
import {
  runProjectRanker,
  type ProjectRankerOutput,
} from "./judge/project-ranker.js";
import {
  fetchAllRepoEvidence,
  type RepoEvidence,
} from "./judge/repo-evidence.js";
import {
  emitGithubFacts,
  runLinkedInPublicFetcher,
  runPersonalSiteFetcher,
  runHnProfileFetcher,
  runDevtoProfileFetcher,
  runMediumProfileFetcher,
  runOrcidFetcher,
  runSemanticScholarFetcher,
  runArxivFetcher,
  runStackoverflowFetcher,
  runYoutubeChannelFetcher,
} from "./fetchers/index.js";
import { runBlogImportAgent } from "./agents/blog-import.js";
import { mergeFactsIntoKG } from "./kg/merger.js";
import { evaluateKg } from "./kg/evaluator.js";
import { writeKgToR2 } from "./kg/persist-kg.js";
import { fetchMediaForKG } from "./media/index.js";
import { generateHeroProse } from "./render/hero-prose.js";
import { generatePersonReport } from "./render/person-report.js";
import { renderResumeFromKg } from "./render/render-from-kg.js";

import {
  makeSource,
  projectId as kgProjectId,
  type KnowledgeGraph,
  type TypedFact,
  type BuiltFact,
} from "@gitshow/shared/kg";
import { ScanTrace, traceR2Key } from "./observability/trace.js";
import {
  bindScanContext,
  captureEvent,
  clearScanContext,
  emitScanCostSummary,
  flushPostHog,
} from "@gitshow/shared/cloud/posthog";
import { writeDraftResume } from "./persist.js";
import { noopPhases, type PhaseReporter } from "./phases.js";
import { withTimeout, TimeoutError } from "../util/timeout.js";
import type { AgentEventEmit } from "../agents/base.js";
import type { Resume } from "@gitshow/shared/resume";

/**
 * Defensive ceiling on how many owned repos we clone + judge. Set to
 * 200 because no normal user has more than that — but a typo'd handle
 * pointing at a bot account with 5000 repos shouldn't burn $250 of
 * Kimi credits. Below this threshold the pipeline studies EVERY owned
 * repo so the Sonnet ranker has full context to pick the top 6 from.
 */
const INVENTORY_CAP = 200;
/**
 * Inventory cloning is bandwidth + disk-I/O bound. With dedicated CPUs
 * + 16 GB RAM + Fly's gigabit network, 24 parallel git clones still
 * leaves headroom. Each clone peaks at ~50 MB resident; 24 × 50 MB ≈
 * 1.2 GB — comfortable on a 16 GB box. Disk I/O is the real ceiling
 * (NVMe is fast but not infinite); bump higher only if traces show
 * inventory still gating scan duration.
 */
const INVENTORY_CONCURRENCY = 24;
const JUDGE_MAX_CANDIDATES = 200;

/**
 * Hard wall-clock caps for each fetcher subPhase. The fan-out is a
 * `Promise.all`, so any single hung fetcher stalls the entire scan.
 * These caps are well above the 95th-percentile happy-path duration
 * — they exist purely so a stuck remote service can't wedge us.
 *
 * On timeout the fetcher returns []; the scan continues with whatever
 * facts the other fetchers produced.
 */
/**
 * One uniform safety-net cap. Used to be per-fetcher and tight; that
 * cost us real data when a fetcher legitimately took 110s and we'd
 * cut it off at 90s. Treat fetchers as best-effort: let them run
 * until they finish, only abort when something is truly stuck (15 min
 * is well past every observed real-world successful run).
 *
 * Inside-the-fetcher caps still apply — blog-import enforces 3 min
 * per URL because Kimi degeneracy is a real failure mode. But the
 * outer cap is no longer the silent-data-loss footgun it was.
 */
const FETCHER_HARD_CAP_MS = 15 * 60_000;

const FETCHER_TIMEOUTS_MS = {
  linkedin: FETCHER_HARD_CAP_MS,
  "personal-site": FETCHER_HARD_CAP_MS,
  hn: FETCHER_HARD_CAP_MS,
  devto: FETCHER_HARD_CAP_MS,
  medium: FETCHER_HARD_CAP_MS,
  orcid: FETCHER_HARD_CAP_MS,
  "semantic-scholar": FETCHER_HARD_CAP_MS,
  arxiv: FETCHER_HARD_CAP_MS,
  stackoverflow: FETCHER_HARD_CAP_MS,
  youtube: FETCHER_HARD_CAP_MS,
  "blog-import": FETCHER_HARD_CAP_MS,
} as const;

export interface RunResumePipelineOptions {
  session: ScanSession;
  usage: SessionUsage;
  /**
   * Scratch directory for clones. Defaults to `profiles/{handle}/`.
   * Cloud mode passes a Fly-local path (e.g. `/data/scans/{scanId}/`).
   */
  profileDir?: string;
  /** When true, write Resume + KG + trace to R2. */
  writeToR2?: boolean;
  onProgress?: (text: string) => void;
  phases?: PhaseReporter;
  /** GitHub-fetch snapshot hook (for early UI hydration). */
  onGitHubFetched?: (snapshot: {
    accessState: {
      orgs: GitHubData["orgAccess"];
      privateContributionsVisible: boolean;
    };
    dataSources: GitHubData["fetchStats"];
  }) => Promise<void> | void;
  /** User-supplied email captured at intake (overrides anything we infer). */
  intakeEmail?: string;
  /**
   * Structured event emitter. When provided, the LLM stages (Repo Judge,
   * KG merger, hero-prose, blog-import) stream reasoning-delta and
   * tool-start/end events through it so the progress page can render
   * Reasoning + Tool cards in real time.
   */
  emit?: AgentEventEmit;
}

export async function runResumePipeline(
  opts: RunResumePipelineOptions,
): Promise<Resume> {
  const { session, usage, onProgress } = opts;
  const log = onProgress ?? ((t: string) => process.stdout.write(t));
  const phases = opts.phases ?? noopPhases;
  const profileDir = opts.profileDir ?? `profiles/${session.handle}`;
  await mkdir(profileDir, { recursive: true });

  bindScanContext({ scanId: session.id, handle: session.handle });
  captureEvent({
    name: "scan started",
    properties: { model: session.model, has_linkedin: !!session.socials.linkedin },
  });

  const trace = new ScanTrace({
    scanId: session.id,
    handle: session.handle,
    model: session.model,
    worker: { version: "0.4.0-kg" },
  });

  // The persist-trace phase at the end runs trace.finalize + R2
  // upload on the success path. If the pipeline throws BEFORE
  // reaching that phase, we still want the partial trace on R2 —
  // it's how every post-mortem ("why did the scan crash in
  // merge?") starts. Wrap the whole pipeline body in try/catch:
  // the success path persists via the phase as before, the error
  // path persists inline and rethrows.
  let resumePersisted = false;
  try {
    const resume = await runPipelineBody({
      session,
      usage,
      log,
      onProgress,
      phases,
      profileDir,
      trace,
      opts,
      markPersisted: () => {
        resumePersisted = true;
      },
    });
    captureEvent({
      name: "scan completed",
      properties: {
        projects: resume.projects.length,
        work: resume.work.length,
        education: resume.education.length,
        skills: resume.skills.length,
        publications: resume.publications.length,
      },
    });
    return resume;
  } catch (err) {
    captureEvent({
      name: "scan failed",
      properties: { error: (err as Error).message.slice(0, 240) },
    });
    if (!resumePersisted && (opts.writeToR2 || process.env.R2_BUCKET_NAME)) {
      try {
        const packet = trace.finalize();
        await uploadTraceToR2(session.id, packet, log);
        log(`[pipeline] partial trace persisted after error\n`);
      } catch (innerErr) {
        log(
          `[pipeline] partial trace persist failed: ${(innerErr as Error).message.slice(0, 200)}\n`,
        );
      }
    }
    throw err;
  } finally {
    // Emit the scan-cost summary BEFORE clearing the context so the
    // aggregator is still alive. This event is what feeds the
    // "$/scan" + "$/model" dashboards in PostHog.
    const cost = emitScanCostSummary();
    if (cost) {
      log(
        `[pipeline] cost: $${cost.total_cost_usd.toFixed(4)} ` +
          `(${cost.total_calls} calls, ${cost.total_input_tokens + cost.total_output_tokens} tokens) ` +
          `top model: ${cost.by_model[0]?.display_name ?? "—"} ` +
          `($${cost.by_model[0]?.cost_usd.toFixed(4) ?? "0"})\n`,
      );
    }
    await flushPostHog();
    clearScanContext();
  }
}

interface PipelineBodyArgs {
  session: ScanSession;
  usage: SessionUsage;
  log: (t: string) => void;
  onProgress?: (t: string) => void;
  phases: PhaseReporter;
  profileDir: string;
  trace: ScanTrace;
  opts: RunResumePipelineOptions;
  markPersisted: () => void;
}

async function runPipelineBody(args: PipelineBodyArgs): Promise<Resume> {
  const { session, usage, log, onProgress, phases, profileDir, trace, opts, markPersisted } = args;
  // 1. GitHub fetch
  const githubRaw = await phases.phase("github-fetch", async () => {
    log(`\n[pipeline] stage 1: github fetch\n`);
    return fetchGitHubData(session.handle);
  });

  // 1b. Apply user-skipped repos. The intake's "Repos to skip" multi-
  // select gives us a set of full names ("owner/name"); strip them
  // out of every repo array on GitHubData before any downstream
  // stage runs. This is the single chokepoint — once filtered, the
  // judge / fetchers / merger / render layers all see a consistent
  // universe and no clever re-introduction is possible.
  const github = applyRepoSkipList(githubRaw, session.skip_repos ?? []);
  if (session.skip_repos && session.skip_repos.length > 0) {
    log(
      `[pipeline]   skipping ${session.skip_repos.length} user-excluded repos\n`,
    );
  }

  if (opts.onGitHubFetched) {
    try {
      await opts.onGitHubFetched({
        accessState: {
          orgs: github.orgAccess,
          privateContributionsVisible: github.privateContributionsVisible,
        },
        dataSources: github.fetchStats,
      });
    } catch (err) {
      log(
        `[pipeline] onGitHubFetched hook failed (non-fatal): ${(err as Error).message.slice(0, 160)}\n`,
      );
    }
  }

  // 2. Tier repos
  const filtered = await phases.phase("repo-filter", async () => {
    log(`[pipeline] stage 2: repo filter\n`);
    const f = filterRepos(github);
    log(
      `[pipeline]   deep=${f.deep.length}  light=${f.light.length}  metadata=${f.metadata.length}  external=${f.external.length}\n`,
    );
    return f;
  });

  // 3. Inventory: clone deep-tier repos so the Repo Judge can read them.
  //    For each successful clone we also run `studyRepo` to collect
  //    the user-attribution stats (`git log --author=<handle>`) and
  //    parse manifests — both feed downstream stages without needing
  //    a separate clone pass.
  const cloned: Record<string, string> = {};
  const studies: Record<string, RepoStudy> = {};
  await phases.phase("inventory", async () => {
    log(
      `[pipeline] stage 3: inventory (cap ${INVENTORY_CAP}, concurrency ${INVENTORY_CONCURRENCY})\n`,
    );
    const toInventory = filtered.deep.slice(0, INVENTORY_CAP);
    const limit = pLimit(INVENTORY_CONCURRENCY);
    await Promise.all(
      toInventory.map((repo) =>
        limit(async () => {
          try {
            const inv: StructuredInventory = await cloneAndInventory({
              fullName: repo.fullName,
              handle: session.handle,
              profileDir,
              log,
            });
            cloned[repo.fullName] = inv.repoPath;
            try {
              const study = await studyRepo({
                repoPath: inv.repoPath,
                fullName: repo.fullName,
                handle: session.handle,
                // Pass every verified email GitHub has on file for the
                // user so commits authored under their real personal /
                // work email get counted, not just commits where the
                // GitHub handle is a substring of the author email.
                userEmails: github.userEmails,
                log,
              });
              studies[repo.fullName] = study;
              log(
                `[study] ${repo.fullName}: user authored ${(study.userShare * 100).toFixed(0)}% (${study.userLines}/${study.totalLines} lines, ${study.userCommits}/${study.totalCommits} commits, ${study.manifestDeps.length} deps)\n`,
              );
            } catch (err) {
              log(
                `[study] ${repo.fullName} failed: ${(err as Error).message.slice(0, 80)}\n`,
              );
            }
          } catch (err) {
            log(
              `[inv] ${repo.fullName} failed: ${(err as Error).message.slice(0, 80)}\n`,
            );
          }
        }),
      ),
    );

    // Snapshot the per-repo blame stats into the trace so a future
    // post-mortem can answer "why did the ranker pick X over Y?"
    // without needing the original clone tree on disk.
    trace?.note(
      "repo-study:summary",
      `studied ${Object.keys(studies).length}/${toInventory.length} cloned repos`,
      {
        cloned: Object.keys(cloned).length,
        attempted: toInventory.length,
        perRepo: Object.fromEntries(
          Object.entries(studies).map(([fullName, s]) => [
            fullName,
            {
              userShare: s.userShare,
              userLines: s.userLines,
              totalLines: s.totalLines,
              userCommits: s.userCommits,
              totalCommits: s.totalCommits,
              manifestDeps: s.manifestDeps.length,
              firstUserCommit: s.firstUserCommit?.slice(0, 10),
              lastUserCommit: s.lastUserCommit?.slice(0, 10),
            },
          ]),
        ),
      },
    );
    return cloned;
  });

  // 4. Repo Judge (Kimi K2.6) — produces shouldFeature/kind/polish per repo.
  //    Runs over EVERY successfully-cloned owned repo (cap=200 is a
  //    defensive ceiling, not the working limit) so the downstream
  //    Sonnet ranker has full per-repo context to pick from.
  const judgments = await phases.phase("repo-judge", async () => {
    log(`[pipeline] stage 4: repo-judge (max ${JUDGE_MAX_CANDIDATES})\n`);
    return judgeAllRepos({
      session,
      usage,
      github,
      clonedPaths: cloned,
      studies,
      maxCandidates: JUDGE_MAX_CANDIDATES,
      trace,
      onProgress,
      emit: opts.emit,
    });
  });
  log(`[pipeline]   judged ${Object.keys(judgments).length} repos\n`);

  // 4b. Per-repo evidence (Gemini 3 Flash grounded). One grounded call
  //     per non-noise judged repo. Provides the ranker with reception,
  //     external mentions, and novelty signals — the "is this famous?"
  //     axis that's hard to infer from code alone.
  const evidence = await phases.phase("repo-evidence", async () => {
    log(`[pipeline] stage 4b: per-repo evidence (Gemini grounded)\n`);
    if (Object.keys(judgments).length === 0) {
      return {} as Record<string, RepoEvidence>;
    }
    return fetchAllRepoEvidence({ judgments, trace, log });
  });
  log(`[pipeline]   evidence reports: ${Object.keys(evidence).length}\n`);

  // 4c. Project Ranker (Sonnet 4.6) — single comparative pick over
  //     ALL judgments + evidence reports. Sonnet's picks become the
  //     My Projects grid; everything else falls through to the
  //     build-log timeline. This decouples "study each repo" (Kimi)
  //     and "investigate external traction" (Gemini grounded) from
  //     "decide which 6 to feature" (Sonnet, comparative).
  const ranking = await phases.phase("project-ranker", async () => {
    log(`[pipeline] stage 4c: project-ranker (Sonnet)\n`);
    if (Object.keys(judgments).length === 0) {
      return { picks: [], rationale: "no judgments to rank" } as ProjectRankerOutput;
    }
    const r = await runProjectRanker({
      session,
      usage,
      judgments,
      evidence,
      studies,
      trace,
      onProgress,
      emit: opts.emit,
    });
    log(
      `[pipeline]   ranker picked ${r.picks.length} project(s) for grid\n`,
    );
    return r;
  });

  // 5. Fetcher fan-out (parallel). Each fetcher returns TypedFact[].
  //    LinkedIn is internally tiered (1+2 → 3 → 4 PDF). Every fetcher
  //    runs under a hard wall-clock cap (FETCHER_TIMEOUTS_MS) so a
  //    single stuck remote service can't wedge the whole scan; on
  //    timeout the fetcher contributes [] and the scan continues.
  const personName = github.profile.name ?? session.handle;
  const safeFetch = <T>(
    name: string,
    capMs: number,
    fn: () => Promise<T[]>,
  ): Promise<T[]> =>
    phases.subPhase(name, async () => {
      try {
        return await withTimeout(fn(), capMs, name);
      } catch (err) {
        if (err instanceof TimeoutError) {
          // Loud warning — a fetcher hitting the cap usually means
          // we silently dropped data. The inner fetcher might still
          // log a misleading "fetcher.end status=ok" with N facts
          // because it kept running after we gave up on it. Flag
          // it so audit-trace can surface this clearly.
          log(
            `[pipeline] ⚠ ${name} timed out after ${capMs / 1000}s — DROPPING any facts the fetcher might still produce. Bump FETCHER_TIMEOUTS_MS["${name}"] if this is a real signal.\n`,
          );
          trace?.note(
            `fetcher-timeout:${name}`,
            `${name} did not complete within ${capMs / 1000}s — dropped facts`,
            { capMs, fetcher: name },
          );
          return [] as T[];
        }
        throw err;
      }
    });
  const fetchersResult = await phases.phase("fetchers", async () => {
    log(`[pipeline] stage 5: fetcher fan-out\n`);
    const githubFacts = emitGithubFacts({ github, trace });
    log(`[pipeline]   github-facts: ${githubFacts.length} facts (sync)\n`);

    // Run the 10 lightweight fetchers in parallel — they're all
    // network-bound (TinyFish / Jina / GitHub APIs / arXiv / etc.)
    // with small JSON payloads, so concurrency is the win.
    // Twitter / X fetcher dropped: the public page returns ~295
    // chars (a login-wall stub) for unauthed scrapers. The intake
    // already preserves the user's X URL on the contact card; trying
    // to enrich it just burned LLM credits for empty extractions.
    const [
      linkedInFacts,
      personalSiteFacts,
      hnFacts,
      devtoFacts,
      mediumFacts,
      orcidFacts,
      semanticScholarFacts,
      arxivFacts,
      stackoverflowFacts,
      youtubeFacts,
    ] = await Promise.all([
      safeFetch("fetch:linkedin", FETCHER_TIMEOUTS_MS.linkedin, () =>
        runLinkedInTierChain({ session, usage, trace, onProgress }),
      ),
      safeFetch("fetch:personal-site", FETCHER_TIMEOUTS_MS["personal-site"], () =>
        runPersonalSiteFetcher({ session, usage, trace, onProgress }),
      ),
      safeFetch("fetch:hn", FETCHER_TIMEOUTS_MS.hn, () =>
        runHnProfileFetcher({ session, usage, trace, onProgress }),
      ),
      safeFetch("fetch:devto", FETCHER_TIMEOUTS_MS.devto, () =>
        runDevtoProfileFetcher({ session, usage, trace, onProgress }),
      ),
      safeFetch("fetch:medium", FETCHER_TIMEOUTS_MS.medium, () =>
        runMediumProfileFetcher({ session, usage, trace, onProgress }),
      ),
      safeFetch("fetch:orcid", FETCHER_TIMEOUTS_MS.orcid, () =>
        runOrcidFetcher({ session, usage, trace, onProgress }),
      ),
      // Researcher-only fetchers. Semantic Scholar and arXiv match by
      // author NAME, which surfaces papers by anyone with the same
      // first name as the user (e.g. "Yatendra Singh" pharmacology
      // papers attached to a Flutter developer named "Yatendra
      // Kumar" — observed in the wild). Gate them on a user-provided
      // ORCID iD so we have at least one identifier strong enough to
      // disambiguate; without it, skip the body. Better to have an
      // empty Publications section than someone else's research on
      // your portfolio. We still go through `safeFetch` so the
      // subphase shows up in the timeline as a fast no-op rather
      // than dangling at "pending" forever.
      safeFetch(
        "fetch:semantic-scholar",
        FETCHER_TIMEOUTS_MS["semantic-scholar"],
        () => {
          if (!session.socials.orcid) {
            log(`[pipeline] fetch:semantic-scholar — no ORCID; skipping name-only match\n`);
            return Promise.resolve([] as TypedFact[]);
          }
          return runSemanticScholarFetcher({
            session,
            usage,
            trace,
            onProgress,
            personName,
            affiliationGuess: github.profile.bio ?? undefined,
          });
        },
      ),
      safeFetch("fetch:arxiv", FETCHER_TIMEOUTS_MS.arxiv, () => {
        if (!session.socials.orcid) {
          log(`[pipeline] fetch:arxiv — no ORCID; skipping name-only match\n`);
          return Promise.resolve([] as TypedFact[]);
        }
        return runArxivFetcher({ session, usage, trace, onProgress, personName });
      }),
      safeFetch("fetch:stackoverflow", FETCHER_TIMEOUTS_MS.stackoverflow, () =>
        runStackoverflowFetcher({ session, usage, trace, onProgress }),
      ),
      safeFetch("fetch:youtube", FETCHER_TIMEOUTS_MS.youtube, () =>
        runYoutubeChannelFetcher({ session, usage, trace, onProgress }),
      ),
    ]);

    // blog-import runs SEQUENTIALLY after the parallel fan-out. It
    // has very different cost/risk shape than the others — full LLM
    // call per URL, multi-KB streaming reasoning, occasional model
    // degeneracy — and overlapping it with Playwright's Chromium
    // subprocess is what blew the 2 GB worker open. Sequencing it
    // here means the heavy resources never coexist; a stuck
    // blog-import only slows blog-import, never the rest of the
    // fetchers row, never the next stage.
    const blog = await safeFetch(
      "blog-import",
      FETCHER_TIMEOUTS_MS["blog-import"],
      () =>
        runBlogImportAgent({
          session,
          usage,
          urls: session.blog_urls ?? [],
          onProgress,
          emit: opts.emit,
        }),
    );

    return {
      githubFacts,
      linkedInFacts,
      personalSiteFacts,
      hnFacts,
      devtoFacts,
      mediumFacts,
      orcidFacts,
      semanticScholarFacts,
      arxivFacts,
      stackoverflowFacts,
      youtubeFacts,
      blog,
    };
  });

  // 6. Project facts from judgments + intake email/socials.
  const judgmentFacts = projectJudgmentsToBuiltFacts(judgments);
  const intakeFacts = projectIntakeFacts(session, opts.intakeEmail);

  // Manifest-driven skills — aggregate every studied repo's deps
  // into HAS_SKILL facts with usage frequency + a 0..100 score that
  // drives the chip bars on the public profile.
  const pushedAtByRepo: Record<string, string | undefined> = {};
  for (const r of github.ownedRepos) pushedAtByRepo[r.fullName] = r.pushedAt ?? undefined;
  const manifestSkills = aggregateSkillsFromStudies({
    studies,
    pushedAtByRepo,
    attributionUrl: `https://github.com/${session.handle}`,
  });
  log(
    `[pipeline]   manifest skills: ${manifestSkills.facts.length} (top: ${manifestSkills.ranked
      .slice(0, 6)
      .map((s) => `${s.name}@${s.score}`)
      .join(", ")})\n`,
  );
  trace?.note(
    "manifest-skills:summary",
    `${manifestSkills.facts.length} skills aggregated from ${Object.keys(studies).length} studied repos`,
    {
      totalSkills: manifestSkills.facts.length,
      totalStudies: Object.keys(studies).length,
      top10: manifestSkills.ranked.slice(0, 10),
    },
  );

  const allFacts: TypedFact[] = [
    ...fetchersResult.githubFacts,
    ...fetchersResult.linkedInFacts,
    ...fetchersResult.personalSiteFacts,
    ...fetchersResult.hnFacts,
    ...fetchersResult.devtoFacts,
    ...fetchersResult.mediumFacts,
    ...fetchersResult.orcidFacts,
    ...fetchersResult.semanticScholarFacts,
    ...fetchersResult.arxivFacts,
    ...fetchersResult.stackoverflowFacts,
    ...fetchersResult.youtubeFacts,
    ...judgmentFacts,
    ...intakeFacts,
    ...manifestSkills.facts,
  ];
  log(`[pipeline]   total facts: ${allFacts.length}\n`);

  // 7. Merge facts into one KG.
  const kg = await phases.phase("merge", async () => {
    log(`[pipeline] stage 6: merge facts → KG\n`);
    return mergeFactsIntoKG(allFacts, {
      session,
      usage,
      meta: {
        scanId: session.id,
        handle: session.handle,
        model: session.model,
        startedAt: Date.parse(session.started_at),
        finishedAt: Date.now(),
      },
      trace,
      onProgress,
      emit: opts.emit,
    });
  });

  // 8. Apply judgments + ranker picks + per-repo blame stats to
  //    Project nodes.
  //    - Per-repo judgments (Kimi) write kind/polish/purpose/reason/tags.
  //    - The Sonnet ranker is the source of truth for shouldFeature +
  //      featureRank: ONLY the projects in `ranking.picks` get
  //      shouldFeature=true; everything else (including repos Kimi
  //      thought were featurable) falls through to the build-log.
  //    - The repo-study writes userShare/userCommits/userLines so the
  //      project cards can surface "Authored 87% of code".
  applyJudgmentsToKg(kg, judgments, ranking, studies, evidence);

  // 9. Media fetch (og → README → YouTube → Gemini gen / Clearbit logos).
  const r2 = r2ClientFromEnv();
  await phases.phase("media", async () => {
    log(`[pipeline] stage 7: media fetch\n`);
    if (!r2) {
      log(`[pipeline]   skipping R2-backed media (env missing); using remote URLs\n`);
    }
    await fetchMediaForKG(kg, {
      trace,
      r2: r2 ? { client: r2.client, bucket: r2.bucket, handle: session.handle } : undefined,
      scanId: session.id,
    });
  });

  // 10. Persist KG (latest + immutable snapshot).
  if (opts.writeToR2 || process.env.R2_BUCKET_NAME) {
    await phases.phase("persist-kg", async () => {
      log(`[pipeline] stage 8: persist KG\n`);
      const res = await writeKgToR2({
        handle: session.handle,
        scanId: session.id,
        kg,
        log,
      });
      if (!res.ok) {
        log(`[pipeline]   KG persist failed: ${res.error ?? "unknown"}\n`);
      }
    });
  }

  // 11. Evaluate.
  await phases.phase("evaluate-kg", async () => {
    log(`[pipeline] stage 9: evaluator\n`);
    const report = evaluateKg({
      kg,
      hasLinkedIn: !!session.socials.linkedin,
      hasPersonalSite: !!session.socials.website,
      trace,
    });
    log(
      `[pipeline]   evaluator: ${report.pass ? "PASS" : "FAIL"} — ${report.blockingErrors} blocking, ${report.warnings} warnings\n`,
    );
    for (const i of report.issues) {
      log(`[pipeline]   [${i.severity}] ${i.section}: ${i.message}\n`);
    }
    return report;
  });

  // 11.5 Person report (Gemini grounded, single call). Builds a
  //      "what does the world know about this person" markdown that
  //      hero-prose uses as context. Pulled out as its own stage so
  //      a Gemini outage doesn't take down the rest of the pipeline.
  const personReport = await phases.phase("person-report", async () => {
    log(`[pipeline] stage 9b: person-report (Gemini grounded)\n`);
    return generatePersonReport({ kg, session, trace, log });
  });

  // 12. Hero prose (single Opus call) — receives the person report
  //     as additional grounded context.
  const prose = await phases.phase("hero-prose", async () => {
    log(`[pipeline] stage 10: hero-prose\n`);
    return generateHeroProse({
      session,
      usage,
      kg,
      personReportMarkdown: personReport.reportMarkdown,
      trace,
      onProgress,
      emit: opts.emit,
    });
  });

  // 13. Render Resume from KG (zero LLM).
  const resume = await phases.phase("render", async () => {
    log(`[pipeline] stage 11: render-from-kg\n`);
    return renderResumeFromKg({
      kg,
      handle: session.handle,
      scanId: session.id,
      prose,
      blog: fetchersResult.blog,
      email: opts.intakeEmail,
      // Round-trip the intake-supplied socials so they land on
      // contact.socials.{linkedin,x,youtube} instead of getting
      // dropped — the legacy ContactSection on the web side reads
      // socials.X.url directly and crashes if it's missing.
      intakeSocials: {
        linkedin: session.socials.linkedin,
        twitter: session.socials.twitter,
        youtube: session.socials.youtube,
        orcid: session.socials.orcid,
        stackoverflow: session.socials.stackoverflow,
      },
      trace,
    });
  });

  log(
    `[pipeline] done. ${resume.projects.length} projects, ${resume.work.length} work, ` +
      `${resume.education.length} edu, ${resume.skills.length} skills, ` +
      `${resume.publications.length} pubs, ${resume.hackathons.length} hackathons, ` +
      `${resume.buildLog.length} build-log, ${resume.blog.length} blog\n`,
  );

  // 14. Persist Resume + trace.
  if (opts.writeToR2 || process.env.R2_BUCKET_NAME) {
    await phases.phase("persist-resume", async () => {
      log(`[pipeline] stage 12: persist resume\n`);
      try {
        await writeDraftResume({ handle: session.handle, resume, log });
      } catch (err) {
        log(
          `[pipeline] resume persist failed: ${(err as Error).message.slice(0, 200)}\n`,
        );
      }
    });
    await phases.phase("persist-trace", async () => {
      try {
        const packet = trace.finalize(resume);
        await uploadTraceToR2(session.id, packet, log);
        markPersisted();
      } catch (err) {
        log(
          `[pipeline] trace persist failed: ${(err as Error).message.slice(0, 200)}\n`,
        );
      }
    });
  }

  return resume;
}

// ─── LinkedIn tier chain ────────────────────────────────────────────
//
// All tiers live inside runLinkedInPublicFetcher:
//   Tier 0: ProxyCurl/EnrichLayer (canonical JSON, when key set)
//   Tier 1: TinyFish Agent API (scoped to the LinkedIn URL only)
//   Tier 2: Gemini grounded with URL context (anti-hallucination prompt)

async function runLinkedInTierChain(opts: {
  session: ScanSession;
  usage: SessionUsage;
  trace: ScanTrace;
  onProgress?: (t: string) => void;
}): Promise<TypedFact[]> {
  const { session, usage, trace, onProgress } = opts;
  if (!session.socials.linkedin) return [];
  return runLinkedInPublicFetcher({ session, usage, trace, onProgress });
}

// ─── Judgment → BUILT facts ─────────────────────────────────────────

function projectJudgmentsToBuiltFacts(
  judgments: Record<string, RepoJudgeOutput>,
): BuiltFact[] {
  const facts: BuiltFact[] = [];
  for (const [fullName, j] of Object.entries(judgments)) {
    facts.push({
      kind: "BUILT",
      project: {
        title: friendlyTitleFromFullName(fullName, j.repo.description),
        purpose: j.judgment.purpose,
        kind: j.judgment.kind,
        polish: j.judgment.polish,
        reason: j.judgment.reason,
        tags: j.judgment.technologies,
        repoFullName: fullName,
        dates: {
          start: j.repo.createdAt ?? undefined,
          end: j.repo.pushedAt ?? undefined,
          active: !j.repo.isArchived,
        },
      },
      attrs: {
        active: !j.repo.isArchived,
        start: j.repo.createdAt ?? undefined,
        end: j.repo.pushedAt ?? undefined,
      },
      source: makeSource({
        fetcher: "repo-judge",
        method: "llm-extraction",
        confidence: j.judgment.shouldFeature ? "high" : "medium",
        url: `https://github.com/${fullName}`,
        snippet: j.judgment.purpose,
      }),
    });
  }
  return facts;
}

function friendlyTitleFromFullName(fullName: string, description?: string | null): string {
  if (description && description.length < 80 && /^[A-Z]/.test(description.trim())) {
    return description.trim();
  }
  const name = fullName.split("/").pop() ?? fullName;
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Apply judgments to KG ──────────────────────────────────────────

function applyJudgmentsToKg(
  kg: KnowledgeGraph,
  judgments: Record<string, RepoJudgeOutput>,
  ranking: ProjectRankerOutput,
  studies: Record<string, RepoStudy>,
  evidence: Record<string, RepoEvidence>,
): void {
  // Pre-build the Sonnet pick map so we can stamp featureRank in one
  // pass below. Pick index = featureRank (0 = best).
  const rankByFullName = new Map<string, number>();
  ranking.picks.forEach((pick, i) => {
    rankByFullName.set(pick.repoFullName, i);
  });

  for (const [fullName, j] of Object.entries(judgments)) {
    const expectedId = kgProjectId({
      repoFullName: fullName,
      title: friendlyTitleFromFullName(fullName, j.repo.description),
    });
    const project =
      kg.entities.projects.find((p) => p.id === expectedId) ??
      kg.entities.projects.find((p) => p.repoFullName === fullName);
    if (!project) continue;
    project.kind = j.judgment.kind;
    project.polish = j.judgment.polish;
    project.purpose = j.judgment.purpose;
    project.reason = j.judgment.reason;
    project.tags = uniqStrings([...(project.tags ?? []), ...j.judgment.technologies]);

    // Sonnet ranker is the source of truth for the My Projects grid.
    // Repos in `ranking.picks` get shouldFeature=true + featureRank;
    // everything else falls through to the build-log/timeline.
    const rank = rankByFullName.get(fullName);
    if (rank !== undefined) {
      project.shouldFeature = true;
      project.featureRank = rank;
    } else {
      project.shouldFeature = false;
      project.featureRank = undefined;
    }

    // Stamp per-repo attribution so the renderer can show
    // "Authored 87% of code" badges on the project card.
    const study = studies[fullName];
    if (study) {
      project.userShare = study.userShare;
      project.userCommits = study.userCommits;
      project.userLines = study.userLines;
    }

    // Surface external mentions from the Gemini evidence pass.
    // Featured projects get up to 5 (driven by ranker pick size);
    // build-log projects get them too so they can show traction
    // chips even without making the curated grid.
    const ev = evidence[fullName];
    if (ev && ev.mentions.length > 0) {
      project.webMentions = ev.mentions.map((m) => ({
        title: m.title,
        url: m.url,
        source: m.source,
      }));
    }

    kg.judgments[project.id] = j.judgment;
  }
}

function uniqStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

// ─── Intake facts (high-priority overrides) ──────────────────────────

function projectIntakeFacts(
  session: ScanSession,
  intakeEmail?: string,
): TypedFact[] {
  const facts: TypedFact[] = [];
  const src = makeSource({
    fetcher: "intake",
    method: "user-input",
    confidence: "high",
    snippet: "user-supplied at intake",
  });
  const personPatch: { email?: string; url?: string } = {};
  if (intakeEmail) personPatch.email = intakeEmail;
  if (session.socials.website) personPatch.url = session.socials.website;
  if (Object.keys(personPatch).length > 0) {
    facts.push({ kind: "PERSON", person: personPatch, source: src });
  }
  return facts;
}

// ─── Repo skip-list filter ─────────────────────────────────────────

/**
 * Strip user-skipped repos from every repo array on `GitHubData`.
 * Match is by full name ("owner/name"), case-insensitive.
 *
 * The PR-author / PR-review arrays carry their own `RepoRef` so we
 * filter those too — otherwise a skipped repo could resurface as
 * "contributed to" in the KG via the github-facts fetcher.
 */
function applyRepoSkipList(github: GitHubData, skip: string[]): GitHubData {
  if (skip.length === 0) return github;
  const skipSet = new Set(skip.map((s) => s.toLowerCase()));
  const allowRepo = (r: { fullName: string }) =>
    !skipSet.has(r.fullName.toLowerCase());
  return {
    ...github,
    ownedRepos: github.ownedRepos.filter(allowRepo),
    authoredPRs: github.authoredPRs.filter((pr) =>
      allowRepo({ fullName: pr.repoFullName }),
    ),
    submittedReviews: github.submittedReviews.filter((rv) =>
      allowRepo({ fullName: rv.repoFullName }),
    ),
  };
}

// ─── R2 helpers ─────────────────────────────────────────────────────

function r2ClientFromEnv(): { client: S3Client; bucket: string } | null {
  const accountId = process.env.CF_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

async function uploadTraceToR2(
  scanId: string,
  packet: unknown,
  log: (t: string) => void,
): Promise<void> {
  const r2 = r2ClientFromEnv();
  if (!r2) {
    log(`[trace] skipping R2 upload — missing R2 env\n`);
    return;
  }
  const key = traceR2Key(scanId);
  const body = JSON.stringify(packet, null, 2);
  await r2.client.send(
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      CacheControl: "no-store",
    }),
  );
  log(`[trace] uploaded ${key} (${body.length} bytes)\n`);
}
