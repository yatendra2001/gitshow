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
 *                             personal-site + twitter + hn/devto/medium +
 *                             orcid + semantic-scholar + arxiv + stackoverflow
 *                             + blog-import (existing). All emit TypedFacts.
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
import type { ScanSession } from "../schemas.js";
import type { GitHubData, StructuredInventory } from "../types.js";
import type { SessionUsage } from "../session.js";

import { judgeAllRepos, type RepoJudgeOutput } from "./judge/repo-judge.js";
import {
  emitGithubFacts,
  runLinkedInPublicFetcher,
  runLinkedInPlaywrightFetcher,
  runLinkedInPdfFetcher,
  runPersonalSiteFetcher,
  runTwitterBioFetcher,
  runHnProfileFetcher,
  runDevtoProfileFetcher,
  runMediumProfileFetcher,
  runOrcidFetcher,
  runSemanticScholarFetcher,
  runArxivFetcher,
  runStackoverflowFetcher,
} from "./fetchers/index.js";
import { runBlogImportAgent } from "./agents/blog-import.js";
import { mergeFactsIntoKG } from "./kg/merger.js";
import { evaluateKg } from "./kg/evaluator.js";
import { writeKgToR2 } from "./kg/persist-kg.js";
import { fetchMediaForKG } from "./media/index.js";
import { generateHeroProse } from "./render/hero-prose.js";
import { renderResumeFromKg } from "./render/render-from-kg.js";

import {
  makeSource,
  projectId as kgProjectId,
  type KnowledgeGraph,
  type TypedFact,
  type BuiltFact,
} from "@gitshow/shared/kg";
import { ScanTrace, traceR2Key } from "./observability/trace.js";
import { writeDraftResume } from "./persist.js";
import { noopPhases, type PhaseReporter } from "./phases.js";
import type { Resume } from "@gitshow/shared/resume";

const INVENTORY_CAP = 30;
const INVENTORY_CONCURRENCY = 3;
const JUDGE_MAX_CANDIDATES = 30;

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
  /** Pre-extracted LinkedIn PDF text from scans.linkedin_pdf_text. */
  linkedinPdfText?: string;
  /** User-supplied email captured at intake (overrides anything we infer). */
  intakeEmail?: string;
}

export async function runResumePipeline(
  opts: RunResumePipelineOptions,
): Promise<Resume> {
  const { session, usage, onProgress } = opts;
  const log = onProgress ?? ((t: string) => process.stdout.write(t));
  const phases = opts.phases ?? noopPhases;
  const profileDir = opts.profileDir ?? `profiles/${session.handle}`;
  await mkdir(profileDir, { recursive: true });

  const trace = new ScanTrace({
    scanId: session.id,
    handle: session.handle,
    model: session.model,
    worker: { version: "0.4.0-kg" },
  });

  // 1. GitHub fetch
  const github = await phases.phase("github-fetch", async () => {
    log(`\n[pipeline] stage 1: github fetch\n`);
    return fetchGitHubData(session.handle);
  });
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
  const cloned: Record<string, string> = {};
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
          } catch (err) {
            log(
              `[inv] ${repo.fullName} failed: ${(err as Error).message.slice(0, 80)}\n`,
            );
          }
        }),
      ),
    );
    return cloned;
  });

  // 4. Repo Judge (Kimi K2.6) — produces shouldFeature/kind/polish per repo.
  const judgments = await phases.phase("repo-judge", async () => {
    log(`[pipeline] stage 4: repo-judge (max ${JUDGE_MAX_CANDIDATES})\n`);
    return judgeAllRepos({
      session,
      usage,
      github,
      clonedPaths: cloned,
      maxCandidates: JUDGE_MAX_CANDIDATES,
      trace,
      onProgress,
    });
  });
  log(`[pipeline]   judged ${Object.keys(judgments).length} repos\n`);

  // 5. Fetcher fan-out (parallel). Each fetcher returns TypedFact[].
  //    LinkedIn is internally tiered (1+2 → 3 → 4 PDF).
  const personName = github.profile.name ?? session.handle;
  const fetchersResult = await phases.phase("fetchers", async () => {
    log(`[pipeline] stage 5: fetcher fan-out\n`);
    const githubFacts = emitGithubFacts({ github, trace });
    log(`[pipeline]   github-facts: ${githubFacts.length} facts (sync)\n`);

    const [
      linkedInFacts,
      personalSiteFacts,
      twitterFacts,
      hnFacts,
      devtoFacts,
      mediumFacts,
      orcidFacts,
      semanticScholarFacts,
      arxivFacts,
      stackoverflowFacts,
      blog,
    ] = await Promise.all([
      phases.subPhase("fetch:linkedin", () =>
        runLinkedInTierChain({ session, usage, trace, onProgress, pdfText: opts.linkedinPdfText }),
      ),
      phases.subPhase("fetch:personal-site", () =>
        runPersonalSiteFetcher({ session, usage, trace, onProgress }),
      ),
      phases.subPhase("fetch:twitter", () =>
        runTwitterBioFetcher({ session, usage, trace, onProgress }),
      ),
      phases.subPhase("fetch:hn", () =>
        runHnProfileFetcher({ session, usage, trace, onProgress }),
      ),
      phases.subPhase("fetch:devto", () =>
        runDevtoProfileFetcher({ session, usage, trace, onProgress }),
      ),
      phases.subPhase("fetch:medium", () =>
        runMediumProfileFetcher({ session, usage, trace, onProgress }),
      ),
      phases.subPhase("fetch:orcid", () =>
        runOrcidFetcher({ session, usage, trace, onProgress }),
      ),
      phases.subPhase("fetch:semantic-scholar", () =>
        runSemanticScholarFetcher({
          session,
          usage,
          trace,
          onProgress,
          personName,
          affiliationGuess: github.profile.bio ?? undefined,
        }),
      ),
      phases.subPhase("fetch:arxiv", () =>
        runArxivFetcher({ session, usage, trace, onProgress, personName }),
      ),
      phases.subPhase("fetch:stackoverflow", () =>
        runStackoverflowFetcher({ session, usage, trace, onProgress }),
      ),
      phases.subPhase("blog-import", () =>
        runBlogImportAgent({
          session,
          usage,
          urls: session.blog_urls ?? [],
          onProgress,
        }),
      ),
    ]);

    return {
      githubFacts,
      linkedInFacts,
      personalSiteFacts,
      twitterFacts,
      hnFacts,
      devtoFacts,
      mediumFacts,
      orcidFacts,
      semanticScholarFacts,
      arxivFacts,
      stackoverflowFacts,
      blog,
    };
  });

  // 6. Project facts from judgments + intake email/socials.
  const judgmentFacts = projectJudgmentsToBuiltFacts(judgments);
  const intakeFacts = projectIntakeFacts(session, opts.intakeEmail);

  const allFacts: TypedFact[] = [
    ...fetchersResult.githubFacts,
    ...fetchersResult.linkedInFacts,
    ...fetchersResult.personalSiteFacts,
    ...fetchersResult.twitterFacts,
    ...fetchersResult.hnFacts,
    ...fetchersResult.devtoFacts,
    ...fetchersResult.mediumFacts,
    ...fetchersResult.orcidFacts,
    ...fetchersResult.semanticScholarFacts,
    ...fetchersResult.arxivFacts,
    ...fetchersResult.stackoverflowFacts,
    ...judgmentFacts,
    ...intakeFacts,
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
    });
  });

  // 8. Apply judgments to Project nodes. The judgment is the source of
  //    truth on shouldFeature/kind/polish/purpose/reason for repo-backed
  //    projects.
  applyJudgmentsToKg(kg, judgments);

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
      hasLinkedInPdf: !!opts.linkedinPdfText,
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

  // 12. Hero prose (single Opus call).
  const prose = await phases.phase("hero-prose", async () => {
    log(`[pipeline] stage 10: hero-prose\n`);
    return generateHeroProse({ session, usage, kg, trace, onProgress });
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

async function runLinkedInTierChain(opts: {
  session: ScanSession;
  usage: SessionUsage;
  trace: ScanTrace;
  onProgress?: (t: string) => void;
  pdfText?: string;
}): Promise<TypedFact[]> {
  const { session, usage, trace, onProgress, pdfText } = opts;

  if (!session.socials.linkedin && !pdfText) {
    return [];
  }

  // Tier 1 + Tier 2 (TinyFish + Jina).
  const t12 = await runLinkedInPublicFetcher({ session, usage, trace, onProgress });
  if (t12.length > 0) return t12;

  // Tier 3 — Playwright with Googlebot UA.
  const t3 = await runLinkedInPlaywrightFetcher({
    session,
    usage,
    trace,
    onProgress,
  });
  if (t3.length > 0) return t3;

  // Tier 4 — uploaded PDF salvage.
  if (pdfText) {
    return runLinkedInPdfFetcher({
      session,
      usage,
      trace,
      onProgress,
      pdfText,
    });
  }
  return [];
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
): void {
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
    project.shouldFeature = j.judgment.shouldFeature;
    project.purpose = j.judgment.purpose;
    project.reason = j.judgment.reason;
    project.tags = uniqStrings([...(project.tags ?? []), ...j.judgment.technologies]);
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
