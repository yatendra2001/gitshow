/**
 * Pipeline orchestrator with checkpoint persistence.
 *
 * Every phase saves its output to disk. If the pipeline crashes,
 * re-running with the same handle resumes from the last checkpoint.
 *
 * Checkpoint directory: profiles/<handle>/
 * See checkpoint.ts for the file format.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CheckpointManager } from "./checkpoint.js";
import { fetchGitHubData } from "./github-fetcher.js";
import { filterRepos } from "./repo-filter.js";
import { getStructuredInventory } from "./git-inventory.js";
import { runSystemMapper } from "./agents/system-mapper.js";
import { runRepoAnalyzer } from "./agents/repo-analyzer.js";
import { runPRAnalyst } from "./agents/pr-analyst.js";
import { runSynthesizer } from "./agents/synthesizer.js";
import { runEvaluator } from "./agents/evaluator.js";

import type {
  PipelineConfig,
  PipelineProgress,
  RepoRef,
  TemporalPrecompute,
  SystemMapping,
  FilterResult,
  GitHubData,
} from "./types.js";
import type {
  ProfileResult,
  RepoAnalysisResult,
  ExternalContribution,
} from "./schemas.js";
import { toProfileCard } from "./schemas.js";

const execFileAsync = promisify(execFile);

// Phase ordering for resume logic
const PHASE_ORDER = [
  "init",
  "github-fetch",
  "repo-filter",
  "system-map",
  "repo-analysis",
  "pr-analysis",
  "synthesis",
  "evaluation",
  "complete",
] as const;

function phaseIndex(phase: string): number {
  return PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
}

function shouldRun(current: string, target: string): boolean {
  return phaseIndex(current) < phaseIndex(target);
}

// ---------- main pipeline ----------

export async function runPipeline(
  config: PipelineConfig
): Promise<ProfileResult> {
  const progress = config.onProgress ?? defaultProgress;
  const startTime = Date.now();

  const log = (text: string) => process.stderr.write(text);

  // Initialize checkpoint manager
  const ckpt = new CheckpointManager(config.handle);
  await ckpt.init();

  // Check for existing checkpoint
  const existing = await ckpt.loadExisting();
  if (existing && existing.phase !== "init") {
    log(
      `[pipeline] Found checkpoint at phase "${existing.phase}" ` +
        `(${existing.completedRepos.length} repos done, ` +
        `${existing.agentCalls} agent calls). Resuming...\n`
    );
  }

  const lastPhase = ckpt.currentPhase;

  // ──────────── Step 1: GitHub Discovery ────────────
  let githubData: GitHubData;

  if (shouldRun(lastPhase, "github-fetch")) {
    progress({
      phase: "github-fetch",
      message: `Fetching GitHub data for @${config.handle}...`,
      percent: 5,
    });

    githubData = await fetchGitHubData(config.handle);
    await ckpt.saveGitHubData(githubData);

    log(
      `[pipeline] GitHub: ${githubData.ownedRepos.length} repos, ` +
        `${githubData.authoredPRs.length} PRs, ` +
        `${githubData.submittedReviews.length} reviews ` +
        `[saved to checkpoint]\n`
    );
  } else {
    githubData = (await ckpt.loadGitHubData<GitHubData>())!;
    log(
      `[pipeline] Loaded GitHub data from checkpoint ` +
        `(${githubData.ownedRepos.length} repos)\n`
    );
  }

  // ──────────── Step 2: Repo Filtering ────────────
  let filtered: FilterResult;

  if (shouldRun(lastPhase, "repo-filter")) {
    progress({
      phase: "repo-filter",
      message: "Filtering significant repos...",
      percent: 10,
    });

    filtered = filterRepos(githubData);
    await ckpt.saveFilteredRepos(filtered);

    log(
      `[pipeline] Tiered: ${filtered.deep.length} deep, ` +
        `${filtered.light.length} light, ` +
        `${filtered.metadata.length} metadata, ` +
        `${filtered.external.length} external [saved]\n`
    );
  } else {
    filtered = (await ckpt.loadFilteredRepos<FilterResult>())!;
    log(
      `[pipeline] Loaded filter from checkpoint ` +
        `(${filtered.deep.length} deep, ${filtered.light.length} light)\n`
    );
  }

  // ──────────── Step 3: System Mapping ────────────
  let systems: SystemMapping;

  if (shouldRun(lastPhase, "system-map")) {
    progress({
      phase: "system-map",
      message: `Grouping ${filtered.deep.length + filtered.light.length + filtered.metadata.length} repos into systems...`,
      percent: 15,
    });

    // System mapper sees ALL repos — even metadata-only ones — to connect dots
    const allRepos = [...filtered.deep, ...filtered.light, ...filtered.metadata];
    try {
      systems = await runSystemMapper(
        { repos: allRepos },
        { model: config.model, onProgress: log }
      );
      ckpt.incrementAgentCalls();
      await ckpt.saveSystems(systems);
      log(
        `[pipeline] Systems: ${systems.systems.length} identified [saved]\n`
      );
    } catch (err) {
      const msg = (err as Error).message;
      log(`[pipeline] WARNING: System mapper failed: ${msg}\n`);
      ckpt.addError(`system-mapper: ${msg}`);
      systems = {
        systems: [],
        standalone: filtered.deep.map((r) => r.fullName),
      };
      await ckpt.saveSystems(systems);
    }
  } else {
    systems = (await ckpt.loadSystems<SystemMapping>())!;
    log(
      `[pipeline] Loaded systems from checkpoint ` +
        `(${systems.systems.length} systems)\n`
    );
  }

  // ──────────── Step 4: Per-Repo Deep Analysis ────────────
  progress({
    phase: "repo-analysis",
    message: `Deep-analyzing ${filtered.deep.length} repos...`,
    percent: 20,
  });

  const repoAnalyses = await analyzeReposWithCheckpoint(
    filtered.deep,
    config,
    ckpt,
    (repoName, idx, total) => {
      progress({
        phase: "repo-analysis",
        message: `Analyzing repo ${idx + 1}/${total}: ${repoName}`,
        repoName,
        percent: 20 + Math.round(((idx + 1) / total) * 40),
      });
    },
    log
  );

  await ckpt.setPhase("repo-analysis");
  log(`[pipeline] Completed ${repoAnalyses.length} repo analyses\n`);

  // ──────────── Step 5: External PR Analysis ────────────
  const externalContributions: ExternalContribution[] = [];

  if (filtered.external.length > 0) {
    progress({
      phase: "pr-analysis",
      message: `Analyzing ${filtered.external.length} external repo contributions...`,
      percent: 65,
    });

    const prsByRepo = new Map<string, typeof githubData.authoredPRs>();
    for (const pr of githubData.authoredPRs) {
      if (!pr.isExternal) continue;
      const existing = prsByRepo.get(pr.repoFullName) ?? [];
      existing.push(pr);
      prsByRepo.set(pr.repoFullName, existing);
    }

    const topExternalRepos = [...prsByRepo.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);

    for (const [repoFullName, prs] of topExternalRepos) {
      // Skip if already done in a previous run
      if (ckpt.isExternalRepoComplete(repoFullName)) {
        const cached = await ckpt.loadExternalAnalysis<ExternalContribution>(repoFullName);
        if (cached) {
          externalContributions.push(cached);
          log(`[pipeline] Loaded external ${repoFullName} from checkpoint\n`);
          continue;
        }
      }

      try {
        const contrib = await runPRAnalyst(
          { repoFullName, prs },
          { model: config.model, onProgress: log }
        );
        externalContributions.push(contrib);
        ckpt.incrementAgentCalls();
        await ckpt.saveExternalAnalysis(repoFullName, contrib);
        log(`[pipeline] External ${repoFullName} analyzed [saved]\n`);
      } catch (err) {
        const msg = (err as Error).message;
        log(`[pipeline] WARNING: PR analysis failed for ${repoFullName}: ${msg}\n`);
        ckpt.addError(`pr-analyst ${repoFullName}: ${msg}`);
      }
    }
  }

  await ckpt.setPhase("pr-analysis");

  // ──────────── Aggregate Temporal Data ────────────
  progress({
    phase: "temporal-aggregate",
    message: "Aggregating temporal data...",
    percent: 70,
  });

  const aggregateTemporal: TemporalPrecompute | null = null;

  // ──────────── Step 6: Profile Synthesis ────────────
  if (shouldRun(ckpt.currentPhase, "synthesis") || lastPhase === "pr-analysis") {
    progress({
      phase: "synthesis",
      message: "Synthesizing unified profile...",
      percent: 75,
    });

    const synthesized = await runSynthesizer(
      {
        handle: config.handle,
        githubData,
        systems,
        repoAnalyses,
        externalContributions,
        aggregateTemporal,
      },
      { model: config.model, onProgress: log }
    );
    ckpt.incrementAgentCalls();
    await ckpt.saveSynthesis(synthesized);
    log(`[pipeline] Synthesis complete. Hook: "${synthesized.hook}" [saved]\n`);
  } else {
    log(`[pipeline] Loaded synthesis from checkpoint\n`);
  }

  // Load synthesis (either just computed or from checkpoint)
  let synthesized = (await ckpt.loadSynthesis<
    Omit<ProfileResult, "evaluationScore" | "evaluationNotes" | "pipelineMeta" | "generatedAt">
  >())!;

  // ──────────── Step 7: LLM Evaluation ────────────
  let evaluationScore: number | undefined;
  let evaluationNotes: string | undefined;

  if (shouldRun(ckpt.currentPhase, "evaluation") || ckpt.currentPhase === "synthesis") {
    progress({
      phase: "evaluation",
      message: "Evaluating profile quality...",
      percent: 85,
    });

    try {
      const evaluation = await runEvaluator(synthesized, {
        model: config.model,
        onProgress: log,
      });
      ckpt.incrementAgentCalls();
      await ckpt.saveEvaluation(evaluation);

      evaluationScore = evaluation.score;
      evaluationNotes = evaluation.notes;

      log(
        `[pipeline] Evaluation: ${evaluation.score}/100` +
          `${evaluation.reject ? " (REJECTED)" : ""} [saved]\n`
      );

      // Re-synthesize if rejected
      if (evaluation.reject && evaluation.score < 40) {
        progress({
          phase: "re-synthesis",
          message: `Re-synthesizing (score: ${evaluation.score})...`,
          percent: 90,
        });

        const reSynthesized = await runSynthesizer(
          {
            handle: config.handle,
            githubData,
            systems,
            repoAnalyses,
            externalContributions,
            aggregateTemporal,
            evaluatorFeedback: evaluation.notes,
          },
          { model: config.model, onProgress: log }
        );
        ckpt.incrementAgentCalls();
        synthesized = reSynthesized;
        await ckpt.saveSynthesis(reSynthesized);

        const reeval = await runEvaluator(reSynthesized, {
          model: config.model,
          onProgress: log,
        });
        ckpt.incrementAgentCalls();
        evaluationScore = reeval.score;
        evaluationNotes = reeval.notes;
        await ckpt.saveEvaluation(reeval);
        log(`[pipeline] Re-evaluation: ${reeval.score}/100 [saved]\n`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      log(`[pipeline] WARNING: Evaluation failed: ${msg}\n`);
      ckpt.addError(`evaluator: ${msg}`);
    }
  } else {
    const cached = await ckpt.loadEvaluation<{ score: number; notes: string }>();
    if (cached) {
      evaluationScore = cached.score;
      evaluationNotes = cached.notes;
      log(`[pipeline] Loaded evaluation from checkpoint (${cached.score}/100)\n`);
    }
  }

  // ──────────── Step 8: Deterministic Validation ────────────
  progress({
    phase: "validation",
    message: "Running validation checks...",
    percent: 95,
  });

  const warnings = validateProfile(synthesized, repoAnalyses);
  if (warnings.length > 0) {
    progress({ phase: "validation", message: "Validation", warnings });
    for (const w of warnings) {
      log(`[pipeline] VALIDATION WARNING: ${w}\n`);
    }
  }

  // ──────────── Assemble final result ────────────
  const totalDurationMs = Date.now() - startTime;

  const result: ProfileResult = {
    ...synthesized,
    generatedAt: new Date().toISOString(),
    evaluationScore,
    evaluationNotes,
    pipelineMeta: {
      totalReposFound: githubData.ownedRepos.length,
      significantRepos: filtered.deep.length + filtered.light.length,
      systemsIdentified: systems.systems.length,
      externalReposAnalyzed: externalContributions.length,
      totalDurationMs,
      agentCalls: ckpt.totalAgentCalls,
    },
  };

  // Save full result (dashboard — reasoning, evidence, audit trail)
  await ckpt.saveFinal(result);

  // Save lean card (frontend — concise, no heavy descriptions)
  const card = toProfileCard(result);
  await ckpt.saveFile("09-card.json", card);

  progress({
    phase: "complete",
    message: `Profile generated in ${Math.round(totalDurationMs / 1000)}s ` +
      `(${ckpt.totalAgentCalls} agent calls)`,
    percent: 100,
  });

  log(
    `[pipeline] Full profile: ${ckpt.checkpointDir}/08-final.json\n` +
    `[pipeline] Frontend card: ${ckpt.checkpointDir}/09-card.json\n`
  );

  return result;
}

// ---------- repo analysis with checkpoint support ----------

async function analyzeReposWithCheckpoint(
  repos: RepoRef[],
  config: PipelineConfig,
  ckpt: CheckpointManager,
  onRepoStart: (name: string, idx: number, total: number) => void,
  log: (text: string) => void
): Promise<RepoAnalysisResult[]> {
  const concurrency = config.concurrency ?? 3;
  const results: RepoAnalysisResult[] = [];

  for (let i = 0; i < repos.length; i += concurrency) {
    const batch = repos.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (repo, batchIdx) => {
        const idx = i + batchIdx;
        onRepoStart(repo.fullName, idx, repos.length);

        // Check if already completed in a previous run
        if (ckpt.isRepoComplete(repo.fullName)) {
          const cached = await ckpt.loadRepoAnalysis<RepoAnalysisResult>(repo.fullName);
          if (cached) {
            log(`[pipeline] Loaded ${repo.fullName} from checkpoint\n`);
            return cached;
          }
        }

        let tmpDir: string | null = null;
        const MAX_REPO_RETRIES = 3;

        for (let attempt = 1; attempt <= MAX_REPO_RETRIES; attempt++) {
          tmpDir = null;
          try {
            tmpDir = await mkdtemp(join(tmpdir(), `gitshow-${repo.name}-`));
            const clonePath = join(tmpDir, repo.name);

            // Clone with retry-aware logging
            log(`[pipeline] Cloning ${repo.fullName}${attempt > 1 ? ` (retry ${attempt})` : ""}...\n`);
            await execFileAsync(
              "gh",
              ["repo", "clone", repo.fullName, clonePath, "--", "--no-checkout"],
              { timeout: 300_000 }
            );

            log(`[pipeline] Pre-computing inventory for ${repo.name}...\n`);
            const inventory = await getStructuredInventory(
              clonePath,
              config.handle
            );

            // Check if inventory has enough data for a full agent analysis.
            // Clone + inventory is cheap (~10s). Agent call is expensive (~$1).
            // For tiny repos, save the inventory data for the synthesizer but
            // skip the agent call — the synthesizer can still use basic stats.
            const MIN_COMMITS_FOR_AGENT = 5;
            const userCommits = inventory.stats.userCommits;

            if (!inventory.identity || userCommits === 0) {
              log(`[pipeline] ${repo.name}: no user commits found. Saving inventory, skipping agent.\n`);
              // Save a minimal analysis from inventory data so synthesizer sees it
              const minimalAnalysis = buildMinimalAnalysis(repo.fullName, inventory);
              await ckpt.saveRepoAnalysis(repo.fullName, minimalAnalysis);
              return minimalAnalysis;
            }

            if (userCommits < MIN_COMMITS_FOR_AGENT) {
              log(`[pipeline] ${repo.name}: only ${userCommits} commits. Saving inventory, skipping agent.\n`);
              const minimalAnalysis = buildMinimalAnalysis(repo.fullName, inventory);
              await ckpt.saveRepoAnalysis(repo.fullName, minimalAnalysis);
              return minimalAnalysis;
            }

            log(`[pipeline] Running agent for ${repo.name} (${userCommits} commits)...\n`);
            const analysis = await runRepoAnalyzer(inventory, {
              model: config.model,
              onProgress: log,
            });

            // Save immediately after each repo completes
            ckpt.incrementAgentCalls();
            await ckpt.saveRepoAnalysis(repo.fullName, analysis);
            log(`[pipeline] ${repo.fullName} complete [saved to checkpoint]\n`);

            return analysis;
          } catch (err) {
            const msg = (err as Error).message;
            const lower = msg.toLowerCase();
            const isTransient =
              lower.includes("timeout") ||
              lower.includes("econnreset") ||
              lower.includes("502") ||
              lower.includes("503") ||
              lower.includes("504") ||
              lower.includes("429") ||
              lower.includes("rate limit") ||
              lower.includes("socket hang up") ||
              lower.includes("socket connection") ||
              lower.includes("connectionclosed") ||
              lower.includes("connection closed") ||
              lower.includes("closed unexpectedly") ||
              lower.includes("abort") ||
              lower.includes("fetch failed") ||
              lower.includes("network") ||
              lower.includes("invalid final response") ||
              lower.includes("empty or invalid output") ||
              lower.includes("json") ||
              lower.includes("maximum context length");

            if (isTransient && attempt < MAX_REPO_RETRIES) {
              log(`[pipeline] Transient error on ${repo.fullName}: ${msg.slice(0, 100)}\n`);
              log(`[pipeline] Retrying in ${attempt * 5}s...\n`);
              await new Promise((r) => setTimeout(r, attempt * 5000));
              // Clean up failed attempt before retry
              if (tmpDir) {
                try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
              }
              continue;
            }

            log(`[pipeline] ERROR: ${repo.fullName}: ${msg.slice(0, 300)}\n`);
            ckpt.addError(`repo-analyzer ${repo.fullName}: ${msg.slice(0, 500)}`);
            return null;
          } finally {
            if (tmpDir) {
              try {
                await rm(tmpDir, { recursive: true, force: true });
              } catch { /* ignore */ }
            }
          }
        }
        // All retries exhausted
        return null;
      })
    );

    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  return results;
}

// ---------- minimal analysis from inventory (no LLM) ----------

import type { StructuredInventory } from "./types.js";

/**
 * Build a basic RepoAnalysisResult from pre-computed inventory data.
 * Used for repos with < 5 commits where a full agent call isn't worth the cost.
 * The synthesizer still sees all the key numbers.
 */
function buildMinimalAnalysis(
  repoFullName: string,
  inv: StructuredInventory
): RepoAnalysisResult {
  const langMap: Record<string, string> = {
    ts: "TypeScript", tsx: "React (TSX)", js: "JavaScript", jsx: "React (JSX)",
    py: "Python", go: "Go", rs: "Rust", dart: "Dart", swift: "Swift",
    rb: "Ruby", java: "Java", kt: "Kotlin", c: "C", cpp: "C++",
    cs: "C#", sql: "SQL", sh: "Shell", html: "HTML", css: "CSS",
    scss: "SCSS", yaml: "YAML", json: "JSON", md: "Markdown",
  };

  const languages = inv.languageLoc
    .filter((l) => l.insertions >= 100)
    .map((l) => langMap[l.extension] ?? l.extension)
    .slice(0, 6);

  // Determine archetype from primary language
  const primary = inv.languageLoc[0]?.extension ?? "";
  let archetype: "backend" | "frontend" | "fullstack" | "mobile" | "infra" | "ml" | "tooling" | "other" = "other";
  if (["go", "py", "rs", "java", "rb"].includes(primary)) archetype = "backend";
  else if (["ts", "tsx", "js", "jsx"].includes(primary)) archetype = "fullstack";
  else if (["dart", "swift", "kt"].includes(primary)) archetype = "mobile";
  else if (["sh", "yaml"].includes(primary)) archetype = "infra";
  else if (["html", "css"].includes(primary)) archetype = "frontend";

  const stats = inv.survivingStats;
  const dStats = inv.deletedStats;

  // Compute durability if we have enough data
  let durScore: number | null = null;
  const linesSurviving = stats.aggregateSurvivingEstimate;
  const durable = stats.aggregateDurable + dStats.durableUserLocEstimate;
  const ephemeral = stats.aggregateEphemeral + dStats.ephemeralUserLocEstimate;
  const denom = linesSurviving + durable + ephemeral;

  if (denom > 0 && inv.stats.activeDays >= 180) {
    durScore = Math.round(((linesSurviving + durable) / denom) * 100);
  }

  const repoName = repoFullName.split("/").pop() ?? repoFullName;

  return {
    repoName,
    archetype,
    repoSummary: {
      totalCommitsByUser: inv.stats.userCommits,
      totalCommitsInRepo: inv.stats.totalCommits,
      firstCommitDate: inv.stats.firstCommitDate,
      lastCommitDate: inv.stats.lastCommitDate,
      primaryLanguages: languages,
      activeDays: inv.stats.activeDays,
    },
    durability: {
      score: durScore,
      reasoning: durScore !== null
        ? `Computed from pre-compute: (${linesSurviving} surviving + ${durable} durable) / (${linesSurviving} + ${durable} + ${ephemeral}) = ${durScore}%. No agent analysis — ${inv.stats.userCommits} commits.`
        : `Score null: repo is ${inv.stats.activeDays} days old (below 180-day threshold) or insufficient data. ${inv.stats.userCommits} user commits, ${denom} total lines in formula.`,
      linesSampled: denom,
      linesSurviving,
      durableReplacedLines: durable,
      meaningfulRewrites: ephemeral,
      noiseRewrites: 0,
      evidence: [{
        repoName,
        description: `Pre-computed from inventory: ${inv.stats.userCommits} commits, ${linesSurviving} lines surviving, ${inv.stats.activeDays} active days. No agent deep-dive (< ${5} commits threshold).`,
        impact: "low" as const,
        kind: "pattern",
      }],
      confidence: "low" as const,
    },
    adaptability: {
      rampUpDays: inv.stats.isEarlyCommitter ? null : null, // can't determine without agent
      reasoning: `${languages.length} languages detected: ${languages.join(", ")}. No agent analysis to determine ramp-up time.`,
      languagesShipped: languages.filter((l) => {
        const loc = inv.languageLoc.find((ll) => (langMap[ll.extension] ?? ll.extension) === l);
        return loc && loc.insertions >= 500;
      }),
      recentNewTech: [],
      evidence: [{
        repoName,
        description: `Languages from inventory: ${languages.join(", ")}. No deep agent analysis performed.`,
        impact: "low" as const,
        kind: "pattern",
      }],
      confidence: "low" as const,
    },
    ownership: {
      score: null,
      reasoning: inv.stats.nonUserCommits === 0
        ? `Solo-maintained repo (0 non-user commits). Ownership score is null by definition.`
        : `${inv.ownershipEntries.length} ownership entries found but no agent analysis to classify cleanup vs collaboration.`,
      commitsAnalyzed: 0,
      commitsRequiringCleanup: 0,
      soloMaintained: inv.stats.nonUserCommits === 0,
      evidence: [{
        repoName,
        description: inv.stats.nonUserCommits === 0
          ? `Solo-maintained: all ${inv.stats.userCommits} commits are by the user.`
          : `${inv.stats.nonUserCommits} non-user commits present but not classified.`,
        impact: "low" as const,
        kind: "pattern",
      }],
      confidence: "low" as const,
    },
    commitClassifications: [],
    notes: `Minimal analysis from pre-compute engine (${inv.stats.userCommits} user commits). Full agent analysis not run — below threshold. Key data: ${linesSurviving} lines surviving, ${languages.length} languages, ${inv.stats.activeDays} active days.`,
  };
}

// ---------- deterministic validation ----------

function validateProfile(
  profile: Omit<ProfileResult, "evaluationScore" | "evaluationNotes" | "pipelineMeta" | "generatedAt">,
  repoAnalyses: RepoAnalysisResult[]
): string[] {
  const warnings: string[] = [];

  if (profile.durability.score !== null) {
    const { linesSurviving, durableReplacedLines, meaningfulRewrites } =
      profile.durability;
    const durable = durableReplacedLines ?? 0;
    const denom = linesSurviving + durable + meaningfulRewrites;
    if (denom > 0) {
      const expected = Math.round(
        ((linesSurviving + durable) / denom) * 100
      );
      if (Math.abs(profile.durability.score - expected) > 3) {
        warnings.push(
          `Durability score ${profile.durability.score} vs formula ${expected}`
        );
      }
    }
  }

  if (profile.insights.length < 4)
    warnings.push(`Only ${profile.insights.length} insights (min 4)`);
  if (profile.radar.length < 4)
    warnings.push(`Only ${profile.radar.length} radar dims (min 4)`);
  if (profile.technicalDepth.length === 0)
    warnings.push("No technical depth entries");
  if (profile.shipped.length === 0)
    warnings.push("No shipped projects");

  const profileRepos = new Set(profile.repoAnalyses.map((r) => r.repoName));
  for (const ra of repoAnalyses) {
    if (!profileRepos.has(ra.repoName))
      warnings.push(`${ra.repoName} analyzed but missing from profile`);
  }

  for (const dim of profile.radar) {
    if (dim.value < 0 || dim.value > 100)
      warnings.push(`Radar "${dim.trait}" = ${dim.value} outside 0-100`);
  }

  if (profile.hook.length < 10)
    warnings.push(`Hook too short (${profile.hook.length} chars)`);

  return warnings;
}

// ---------- progress ----------

function defaultProgress(event: PipelineProgress): void {
  const pct = event.percent ? ` [${event.percent}%]` : "";
  process.stderr.write(`[pipeline${pct}] ${event.message}\n`);
  if (event.warnings) {
    for (const w of event.warnings) {
      process.stderr.write(`[pipeline] WARNING: ${w}\n`);
    }
  }
}
