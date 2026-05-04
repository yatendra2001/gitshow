/**
 * Repo Judge — replaces regex-based pick-featured.ts.
 *
 * For each repo we judge: Kimi reads README + tree + manifests plus
 * chunk-level summaries from first-party source files, then emits a
 * structured Judgment. The Judgment drives:
 *   - whether the repo's Project node is featured
 *   - whether it appears in the build log
 *   - the project kind tag the render layer surfaces
 *
 * No string-matching on names. The Judge reads the code.
 */

import * as z from "zod/v4";
import pLimit from "p-limit";

import { runAgentWithSubmit, type AgentEventEmit } from "../../agents/base.js";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { RepoRef, GitHubData } from "../../types.js";
import { modelForRole } from "@gitshow/shared/models";
import {
  ProjectKindSchema,
  PolishSchema,
  type ProjectKind,
  type Polish,
} from "@gitshow/shared/kg";
import {
  sampleRepo,
  formatSample,
  formatChunksForAnalysis,
  type RepoCorpus,
  type RepoCorpusAnalysis,
  type RepoCorpusChunk,
  type RepoChunkFinding,
  type RepoFileSummary,
} from "./repo-sampler.js";
import type { ScanTrace } from "../observability/trace.js";
import type { RepoStudy } from "../../repo-study.js";

export const RepoJudgmentSchema = z.object({
  kind: ProjectKindSchema,
  authorship: z.enum(["primary", "co-author", "contributor", "templated-from-other"]),
  effort: z.enum(["substantial", "moderate", "light", "none"]),
  polish: PolishSchema,
  /** One-sentence honest description of what the repo IS. */
  purpose: z.string().min(4).max(280),
  shouldFeature: z.boolean(),
  /** Why featured / not — visible in trace.judge.verdict. */
  reason: z.string().min(4).max(400),
  technologies: z.array(z.string().max(40)).max(20).default([]),
});
export type RepoJudgment = z.infer<typeof RepoJudgmentSchema>;

const RepoChunkFindingSchema = z.object({
  chunkId: z.string().min(1).max(40),
  path: z.string().min(1).max(260),
  purpose: z.string().min(1).max(220),
  technologies: z.array(z.string().max(40)).max(12).default([]),
  domainSignals: z.array(z.string().max(180)).max(8).default([]),
  implementationSignals: z.array(z.string().max(180)).max(8).default([]),
  qualitySignals: z.array(z.string().max(180)).max(6).default([]),
  risks: z.array(z.string().max(180)).max(6).default([]),
});

const RepoChunkBatchAnalysisSchema = z.object({
  findings: z.array(RepoChunkFindingSchema).max(12),
});
type RepoChunkBatchAnalysis = z.infer<typeof RepoChunkBatchAnalysisSchema>;

export interface RepoJudgeInput {
  session: ScanSession;
  usage: SessionUsage;
  repo: RepoRef;
  /** Local path where the repo was cloned (inventory stage). */
  repoPath: string;
  /** Per-repo attribution + manifest stats produced by `studyRepo`. */
  study?: RepoStudy;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
  /** Optional structured emit — streams reasoning/tool events. */
  emit?: AgentEventEmit;
}

export interface RepoJudgeOutput {
  repo: RepoRef;
  judgment: RepoJudgment;
  filesRead: number;
  durationMs: number;
  coverage: RepoCorpus["stats"];
}

const SYSTEM_PROMPT = `You are a code reader. You read structured evidence
from a repository-wide source pass and produce a structured Judgment about it.
You must call submit_judgment with the result.

What you receive (in tagged blocks):
  <readme>         README text, when present
  <tree>           repository tree, with vendored/build dirs removed
  <manifest>       package.json / Cargo.toml / pyproject.toml / etc.
  <repo_coverage>  how many first-party files/chunks were analyzed
  <repo_analysis>  reduced findings from source chunks across the repo
  <file_summary>   per-file summaries from chunk-level source analysis
  <attribution>    git-log stats — what fraction of the repo this user authored

The ONLY test for shouldFeature=true is:
  "Did the user build something real that's worth showing on a portfolio?"

Use <attribution> as a TRUTH check: a low userShare (e.g. < 10%) on a
non-trivial repo is a strong signal of "fork-with-tiny-change" or
"clone-of-someone-else's-work" — those should NOT be featured even if
the README looks polished. Conversely, high userShare (>70%) with
substantial commits is strong evidence the user is the primary author.

External validation (stars, forks, mentions) is NEVER a gate.
Pinned vs. not is decided downstream — your job is to read and judge.

Hard bans — these MUST always be shouldFeature=false:
  - kind = "contribution-mirror" (auto-generated mirrors, contribution graph
    inflators, "Import_*" repos, mock data importers)
  - kind = "dotfiles-config" (shell rcfiles, neovim config dumps)
  - kind = "empty-or-trivial" (no real source code, README-only with
    placeholder text, scaffolded but never extended)

If the README literally says "auto-generated mock", "contributions importer",
"mirror of private repo", or shows commits like "Bulk import day 1",
choose kind = "contribution-mirror" regardless of how prolific it looks.

Choosing kind:
  - product:           shipped consumer/dev product, real domain logic
  - library:           reusable package others import (manifest declares it)
  - tool:              CLI / script the author uses
  - experiment:        prototype, sketch, learning project that DID write
                        original code — distinct from tutorial-follow
  - tutorial-follow:   following along with a tutorial / course
  - template-clone:    barely-modified create-* template
  - fork-contribution: a fork where the user landed real PRs upstream
  - contribution-mirror: see hard bans above
  - dotfiles-config:    see hard bans above
  - coursework:        homework / lab assignments
  - empty-or-trivial:  see hard bans above
  - research-artifact: code that accompanies a paper / model / dataset

Choosing polish:
  - shipped:  has a homepage, deployed, or clearly used in production
  - working:  README + non-trivial code, looks runnable
  - wip:      partially written, TODOs visible, missing pieces
  - broken:   broken builds, crashing on boot, half-migrated
  - not-code: docs / spec / artifact-only repository

purpose: ONE short, honest sentence. Aim for 8-15 words. Plain English,
no marketing-speak, no "robust" / "blazing-fast" / "elegant solution".
Lead with what the thing IS, then the most distinctive technical hook
if it fits.

  "Generates portfolio sites and ATS resumes from GitHub history."
  "Open-source video-first podcast hosting platform; WebRTC + Whisper."
  "AI tutor that teaches concepts visually using Manim animations."
  "CLI assistant using screen + audio context for summaries and actions."
  "Cross-platform AI chat assistant with PDF and image Q&A."
  "Toy implementation of Raft for a distributed-systems class."
  "Auto-generated mirror of a private repo. No real source code."

reason: one or two sentences explaining your shouldFeature decision,
quoting the specific README/code signal you used.

technologies: extracted from manifests + obvious framework usage (max 10).

Output ONLY by calling submit_judgment.`;

const CHUNK_ANALYZER_PROMPT = `You read raw source chunks from one repository
and extract compact evidence for a later repository judge.

For every <chunk> you receive, return one finding with the same chunkId and
path. Be concrete but concise. Prefer implementation facts over generic praise.
Do not quote long code. If a secret-like value appears, mention only the risk
category and never reproduce the value.

Fields:
  purpose: what this chunk/file appears to do
  technologies: frameworks, languages, libraries, build/runtime tools
  domainSignals: product/domain behavior visible in the code
  implementationSignals: architecture, APIs, data flow, algorithms, integrations
  qualitySignals: tests, error handling, polish, deployment, robustness
  risks: generated code, template-only code, broken TODOs, suspicious secrets`;

/**
 * Repo-judge is a structural-classification call: read reduced source
 * evidence, pick a `kind`, set `polish`, write a one-sentence purpose.
 * It does NOT need long reasoning chains. Bumping from "medium" to "low"
 * because traces showed Kimi K2.6 streaming reasoning for 30+ minutes
 * on a handful of large codebases (aimuse=1885s, autotext_v4=1063s,
 * memcast-v2=850s) with only ~600 chars of final output. Whether
 * Kimi actually respects this knob varies by model build, but it
 * never hurts to ask for less.
 */
const REASONING_EFFORT = "low" as const;

/**
 * Hard wall-clock cap per judge call. The agent SDK's default is
 * 86,400,000 ms (24h) — fine in theory ("the agent decides when to
 * stop") but in practice a single wedged Kimi call would pin a
 * concurrency slot for half an hour while the model streamed
 * reasoning in a black box with no events emitted. 3 minutes is well
 * past p95 (~14 min in the worst trace, but that includes retries).
 *
 * On timeout the agent throws, judgeRepo's try/catch fires, and
 * `fallbackJudgment` writes a synthetic verdict from RepoRef metadata
 * + repo description. We lose Kimi's per-repo judgment for that one
 * repo — but we lose it cheaply, and the project-ranker can still
 * rank it (just with less rich evidence).
 */
const JUDGE_TIMEOUT_MS = 3 * 60_000;

/**
 * Hard cap on agent-loop iterations per judge call. The agent SDK
 * defaults `maxIterations` to 10,000 (a "safety valve only" per its
 * own comment) — but a real Kimi run on memlearn was observed
 * spending 279 OpenRouter requests inside ONE judge call before
 * timing out. The model loops reasoning text without ever emitting
 * the submit_judgment tool_calls structure.
 *
 * 20 leaves comfortable headroom for legitimate analysis (read
 * prompt → reason through kind/polish/purpose → submit, plus
 * retries for tool-arg validation) while hard-capping pathological
 * runs. When the cap fires the SDK throws "exceeded step count" —
 * judgeRepo's try/catch then writes a fallback judgment from
 * RepoRef metadata.
 *
 * Combined with JUDGE_TIMEOUT_MS this caps worst-case waste per
 * judge at min(20 iterations × ~1.5 OpenRouter calls each ≈ 30
 * requests, 3 min wall-clock).
 */
const JUDGE_MAX_ITERATIONS = 20;

const CHUNK_BATCH_MAX_CHUNKS = 8;
const CHUNK_BATCH_MAX_CHARS = 90_000;
const CHUNK_ANALYSIS_CONCURRENCY = 4;
const CHUNK_ANALYSIS_TIMEOUT_MS = 2 * 60_000;
const CHUNK_ANALYSIS_MAX_ITERATIONS = 12;

export async function judgeRepo(input: RepoJudgeInput): Promise<RepoJudgeOutput> {
  const { repo, repoPath, study, session, usage, trace, onProgress, emit } = input;
  const t0 = Date.now();
  const sample = await sampleRepo(repoPath);
  const analysis = await analyzeRepoCorpus({
    corpus: sample,
    repo,
    session,
    usage,
    onProgress,
    trace,
  });
  const formatted = formatSample(sample, analysis);

  const attributionBlock = study
    ? [
        `<attribution>`,
        `  user lines: ${study.userLines}/${study.totalLines} (${(study.userShare * 100).toFixed(0)}% of all added lines)`,
        `  user commits: ${study.userCommits}/${study.totalCommits}`,
        study.firstUserCommit
          ? `  first user commit: ${study.firstUserCommit.slice(0, 10)}`
          : `  first user commit: (none)`,
        study.lastUserCommit
          ? `  last user commit: ${study.lastUserCommit.slice(0, 10)}`
          : `  last user commit: (none)`,
        `</attribution>`,
      ].join("\n")
    : "";

  const userInput = [
    `<repo>${repo.fullName}</repo>`,
    `<meta stars="${repo.stargazerCount ?? 0}" forks="${repo.forkCount ?? 0}" archived="${repo.isArchived}" fork="${repo.isFork}" lang="${repo.primaryLanguage ?? ""}">`,
    `description="${(repo.description ?? "").replace(/"/g, "'").slice(0, 200)}"`,
    `</meta>`,
    "",
    attributionBlock,
    formatted,
  ]
    .filter(Boolean)
    .join("\n");

  let judgment: RepoJudgment;
  try {
    const res = await runAgentWithSubmit({
      model: modelForRole("bulk"),
      systemPrompt: SYSTEM_PROMPT,
      input: userInput,
      submitToolName: "submit_judgment",
      submitToolDescription:
        "Submit the structured Judgment for this repository. Call exactly once.",
      submitSchema: RepoJudgmentSchema,
      reasoning: { effort: REASONING_EFFORT },
      timeoutMs: JUDGE_TIMEOUT_MS,
      maxIterations: JUDGE_MAX_ITERATIONS,
      session,
      usage,
      onProgress,
      trace,
      emit,
      label: `judge:${repo.fullName}`,
    });
    judgment = res.result;
  } catch (err) {
    judgment = fallbackJudgment(repo, err as Error);
  }

  const filesRead =
    sample.stats.analyzedFiles + (sample.readme ? 1 : 0) + Object.keys(sample.manifests).length;

  trace?.judgeVerdict({
    label: `judge:${repo.fullName}`,
    repo: repo.fullName,
    judgeKind: judgment.kind,
    shouldFeature: judgment.shouldFeature,
    reason: judgment.reason,
    filesRead,
    coverageTier: sample.stats.tier,
    fullCoverage: sample.stats.fullCoverage,
    eligibleFiles: sample.stats.eligibleFiles,
    analyzedFiles: sample.stats.analyzedFiles,
    sourceChunks: sample.stats.chunkCount,
  });

  return {
    repo,
    judgment,
    filesRead,
    durationMs: Date.now() - t0,
    coverage: sample.stats,
  };
}

async function analyzeRepoCorpus(input: {
  corpus: RepoCorpus;
  repo: RepoRef;
  session: ScanSession;
  usage: SessionUsage;
  onProgress?: (text: string) => void;
  trace?: ScanTrace;
}): Promise<RepoCorpusAnalysis> {
  const { corpus, repo, session, usage, onProgress, trace } = input;
  const batches = buildChunkBatches(corpus.chunks);
  trace?.note(`repo-corpus:${repo.fullName}`, "source corpus prepared", {
    tier: corpus.stats.tier,
    fullCoverage: corpus.stats.fullCoverage,
    eligibleFiles: corpus.stats.eligibleFiles,
    analyzedFiles: corpus.stats.analyzedFiles,
    analyzedBytes: corpus.stats.analyzedBytes,
    chunks: corpus.stats.chunkCount,
    batches: batches.length,
    skippedFiles: corpus.stats.skippedFiles,
    skippedSensitive: corpus.stats.skippedSensitive,
  });

  if (batches.length === 0) {
    return reduceFindings(corpus, [], 0, 0);
  }

  const limit = pLimit(CHUNK_ANALYSIS_CONCURRENCY);
  let failedBatches = 0;
  const results = await Promise.all(
    batches.map((batch, index) =>
      limit(async () => {
        try {
          return await analyzeChunkBatch({
            repo,
            chunks: batch,
            index,
            total: batches.length,
            session,
            usage,
            onProgress,
          });
        } catch (err) {
          failedBatches++;
          trace?.note(`repo-corpus:${repo.fullName}`, "chunk analysis batch failed", {
            batch: index + 1,
            chunks: batch.length,
            error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
          });
          return batch.map(fallbackFinding);
        }
      }),
    ),
  );

  const findings = results.flat();
  return reduceFindings(corpus, findings, batches.length, failedBatches);
}

function buildChunkBatches(chunks: RepoCorpusChunk[]): RepoCorpusChunk[][] {
  const batches: RepoCorpusChunk[][] = [];
  let current: RepoCorpusChunk[] = [];
  let chars = 0;
  for (const chunk of chunks) {
    const nextChars = chunk.content.length + 240;
    if (
      current.length > 0 &&
      (current.length >= CHUNK_BATCH_MAX_CHUNKS || chars + nextChars > CHUNK_BATCH_MAX_CHARS)
    ) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(chunk);
    chars += nextChars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function analyzeChunkBatch(input: {
  repo: RepoRef;
  chunks: RepoCorpusChunk[];
  index: number;
  total: number;
  session: ScanSession;
  usage: SessionUsage;
  onProgress?: (text: string) => void;
}): Promise<RepoChunkFinding[]> {
  const { repo, chunks, index, total, session, usage, onProgress } = input;
  const res = await runAgentWithSubmit<RepoChunkBatchAnalysis>({
    model: modelForRole("bulk"),
    systemPrompt: CHUNK_ANALYZER_PROMPT,
    input: [
      `<repo>${repo.fullName}</repo>`,
      `<batch index="${index + 1}" total="${total}" chunks="${chunks.length}">`,
      formatChunksForAnalysis(chunks),
      `</batch>`,
    ].join("\n"),
    submitToolName: "submit_chunk_findings",
    submitToolDescription:
      "Submit compact findings for every source chunk in this batch. Call exactly once.",
    submitSchema: RepoChunkBatchAnalysisSchema,
    reasoning: { effort: "low" },
    timeoutMs: CHUNK_ANALYSIS_TIMEOUT_MS,
    maxIterations: CHUNK_ANALYSIS_MAX_ITERATIONS,
    session,
    usage,
    onProgress,
    label: `repo-corpus:${repo.fullName}:${index + 1}/${total}`,
    // Deliberately omit trace/emit here: raw source chunks are pass-through
    // inference input and should not be retained in trace artifacts.
  });

  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const findingsById = new Map<string, RepoChunkFinding>();
  for (const finding of res.result.findings) {
    const chunk = chunkById.get(finding.chunkId);
    if (!chunk) continue;
    findingsById.set(chunk.id, normalizeFinding(finding, chunk));
  }
  for (const chunk of chunks) {
    if (!findingsById.has(chunk.id)) {
      findingsById.set(chunk.id, fallbackFinding(chunk));
    }
  }
  return [...findingsById.values()];
}

function normalizeFinding(finding: RepoChunkFinding, chunk: RepoCorpusChunk): RepoChunkFinding {
  return {
    chunkId: chunk.id,
    path: chunk.path,
    purpose: limitText(finding.purpose, 220),
    technologies: uniqueStrings(finding.technologies, 12),
    domainSignals: uniqueStrings(finding.domainSignals, 8).map((s) => limitText(s, 180)),
    implementationSignals: uniqueStrings(finding.implementationSignals, 8).map((s) =>
      limitText(s, 180),
    ),
    qualitySignals: uniqueStrings(finding.qualitySignals, 6).map((s) => limitText(s, 180)),
    risks: uniqueStrings(finding.risks, 6).map((s) => limitText(s, 180)),
  };
}

function fallbackFinding(chunk: RepoCorpusChunk): RepoChunkFinding {
  return {
    chunkId: chunk.id,
    path: chunk.path,
    purpose: `Source chunk from ${chunk.path}`,
    technologies: technologyFromExtension(chunk.extension),
    domainSignals: [],
    implementationSignals: [],
    qualitySignals: [],
    risks: ["Chunk analysis unavailable"],
  };
}

function reduceFindings(
  corpus: RepoCorpus,
  findings: RepoChunkFinding[],
  analyzedBatches: number,
  failedBatches: number,
): RepoCorpusAnalysis {
  const chunksByPath = new Map<string, number>();
  for (const chunk of corpus.chunks) {
    chunksByPath.set(chunk.path, (chunksByPath.get(chunk.path) ?? 0) + 1);
  }
  const fileByPath = new Map(corpus.files.map((file) => [file.path, file]));
  const byPath = new Map<string, RepoChunkFinding[]>();
  for (const finding of findings) {
    const arr = byPath.get(finding.path) ?? [];
    arr.push(finding);
    byPath.set(finding.path, arr);
  }

  const fileSummaries: RepoFileSummary[] = [];
  for (const [path, fileFindings] of byPath.entries()) {
    const file = fileByPath.get(path);
    const signals = uniqueStrings(
      fileFindings.flatMap((f) => [
        ...f.domainSignals,
        ...f.implementationSignals,
        ...f.qualitySignals,
      ]),
      10,
    );
    const purposes = uniqueStrings(fileFindings.map((f) => f.purpose), 3);
    fileSummaries.push({
      path,
      bytes: file?.bytes ?? 0,
      chunks: chunksByPath.get(path) ?? fileFindings.length,
      summary: limitText(purposes.join(" / "), 260),
      technologies: uniqueStrings(fileFindings.flatMap((f) => f.technologies), 12),
      signals,
      risks: uniqueStrings(fileFindings.flatMap((f) => f.risks), 6),
    });
  }
  fileSummaries.sort((a, b) => scoreSummary(b) - scoreSummary(a) || a.path.localeCompare(b.path));

  return {
    findings,
    fileSummaries,
    technologies: topFrequent(findings.flatMap((f) => f.technologies), 30),
    repoSignals: topFrequent(
      findings.flatMap((f) => [
        ...f.domainSignals,
        ...f.implementationSignals,
        ...f.qualitySignals,
      ]),
      60,
    ),
    risks: topFrequent(findings.flatMap((f) => f.risks), 30),
    analyzedBatches,
    failedBatches,
  };
}

function scoreSummary(summary: RepoFileSummary): number {
  let score = summary.signals.length * 3 + summary.technologies.length + summary.risks.length;
  const path = summary.path.toLowerCase();
  if (path.startsWith("src/") || path.includes("/src/")) score += 10;
  if (path.includes("app") || path.includes("api") || path.includes("service")) score += 6;
  if (path.includes("test") || path.includes("spec")) score -= 4;
  return score;
}

function uniqueStrings(values: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

function topFrequent(values: string[], limit: number): string[] {
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const current = counts.get(key);
    counts.set(key, { value: current?.value ?? trimmed, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit)
    .map((entry) => entry.value);
}

function limitText(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function technologyFromExtension(extension: string): string[] {
  const map: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".rb": "Ruby",
    ".java": "Java",
    ".kt": "Kotlin",
    ".swift": "Swift",
    ".php": "PHP",
    ".cs": "C#",
    ".cpp": "C++",
    ".c": "C",
    ".vue": "Vue",
    ".svelte": "Svelte",
  };
  return map[extension] ? [map[extension]] : [];
}

function emptyCoverage(): RepoCorpus["stats"] {
  return {
    tier: "prioritized",
    eligibleFiles: 0,
    eligibleBytes: 0,
    analyzedFiles: 0,
    analyzedBytes: 0,
    skippedFiles: 0,
    skippedBytes: 0,
    skippedTooLarge: 0,
    skippedSensitive: 0,
    skippedUnreadable: 0,
    chunkCount: 0,
    fullCoverage: false,
  };
}

/**
 * Cap how many repos we judge in parallel.
 *
 * OpenRouter has effectively no rate limit at our scale for paid
 * accounts (a recent scan ran 53 Kimi + 47 Gemini grounded calls
 * concurrent with zero 429s). The Fly worker is performance-4x /
 * 16 GB and was sitting at 586 MB / 3.7% utilization at peak, so
 * memory's not the constraint either.
 *
 * Full-repo reading adds bounded chunk-analysis calls inside each
 * judge. Keep outer fan-out modest so a scan does not multiply into
 * hundreds of simultaneous OpenRouter requests.
 */
const JUDGE_CONCURRENCY = 12;

export interface JudgeAllOptions {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  /** Map of fullName → local clone path produced by inventory stage. */
  clonedPaths: Record<string, string>;
  /** Map of fullName → RepoStudy produced alongside cloning. */
  studies?: Record<string, RepoStudy>;
  /** Limit the candidate set; default 30. */
  maxCandidates?: number;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
  emit?: AgentEventEmit;
}

export async function judgeAllRepos(
  opts: JudgeAllOptions,
): Promise<Record<string, RepoJudgeOutput>> {
  const candidates = pickJudgeCandidates(opts.github, opts.clonedPaths, opts.maxCandidates ?? 30);
  const limit = pLimit(JUDGE_CONCURRENCY);
  const out: Record<string, RepoJudgeOutput> = {};
  await Promise.all(
    candidates.map((c) =>
      limit(async () => {
        try {
          const judged = await judgeRepo({
            session: opts.session,
            usage: opts.usage,
            repo: c.repo,
            repoPath: c.repoPath,
            study: opts.studies?.[c.repo.fullName],
            trace: opts.trace,
            onProgress: opts.onProgress,
            emit: opts.emit,
          });
          out[c.repo.fullName] = judged;
        } catch (err) {
          // Fallback: if the agent failed entirely, log + assume "experiment / suggested".
          const judgment = fallbackJudgment(c.repo, err as Error);
          out[c.repo.fullName] = {
            repo: c.repo,
            judgment,
            filesRead: 0,
            durationMs: 0,
            coverage: emptyCoverage(),
          };
          opts.trace?.judgeVerdict({
            label: `judge:${c.repo.fullName}`,
            repo: c.repo.fullName,
            judgeKind: judgment.kind,
            shouldFeature: judgment.shouldFeature,
            reason: judgment.reason,
            filesRead: 0,
            coverageTier: "prioritized",
            fullCoverage: false,
            eligibleFiles: 0,
            analyzedFiles: 0,
            sourceChunks: 0,
          });
        }
      }),
    ),
  );
  return out;
}

/**
 * Lightweight pre-score: pinned + owned + non-archived + non-fork +
 * (stars * 3 + commits * 0.5). NO regex noise filter. Top N candidates
 * go to the LLM for the real judgment.
 */
function pickJudgeCandidates(
  github: GitHubData,
  cloned: Record<string, string>,
  n: number,
): Array<{ repo: RepoRef; repoPath: string }> {
  const owned = github.ownedRepos.filter((r) => {
    const rel = r.relationship ?? "owner";
    return rel === "owner" || rel === "collaborator" || rel === "org_member";
  });
  const scored = owned
    .filter((r) => !r.isArchived)
    .map((r) => ({
      repo: r,
      score: scoreRepo(r),
      cloned: cloned[r.fullName],
    }))
    .filter((c) => Boolean(c.cloned));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((c) => ({ repo: c.repo, repoPath: c.cloned! }));
}

function scoreRepo(r: RepoRef): number {
  const stars = r.stargazerCount ?? 0;
  const commits = r.userCommitCount ?? 0;
  let s = stars * 3 + commits * 0.5;
  if (r.isFork) s *= 0.4; // forks rank below original work but still eligible
  return s;
}

function fallbackJudgment(repo: RepoRef, err: Error): RepoJudgment {
  // Prefer the repo's own description (always written by the user
  // themselves, so it reads well in the rendered build log). Fall
  // back to a language-aware one-liner instead of the previous
  // "Repository X (judge unavailable)" string, which leaked into the
  // public portfolio when Kimi judges timed out — bad UX.
  const fromGithubDescription = repo.description?.trim();
  const langTag = repo.primaryLanguage?.trim();
  const friendlyName = repo.fullName.split("/").pop()?.replace(/[-_]+/g, " ") ?? repo.fullName;
  const purpose =
    fromGithubDescription && fromGithubDescription.length >= 8
      ? fromGithubDescription.slice(0, 200)
      : langTag
        ? `${friendlyName} — ${langTag} project on GitHub.`
        : `${friendlyName} — public repository on GitHub.`;
  return {
    kind: "experiment",
    authorship: "primary",
    effort: "light",
    polish: "wip",
    purpose,
    shouldFeature: false,
    // Internal-only — surfaced in trace.json + kg.judgments. Never
    // rendered into the public portfolio.
    reason: `Judge failed: ${err.message.slice(0, 200)} — defaulted to non-featured experiment`,
    technologies: (repo.languages ?? []).slice(0, 6),
  };
}
