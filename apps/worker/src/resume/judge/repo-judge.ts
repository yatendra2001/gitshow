/**
 * Repo Judge — replaces regex-based pick-featured.ts.
 *
 * For each repo we judge: Kimi reads README + tree + manifests + a few
 * source files (sampled by repo-sampler.ts) and emits a structured
 * Judgment. The Judgment drives:
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
import { sampleRepo, formatSample, type RepoSample } from "./repo-sampler.js";
import type { ScanTrace } from "../observability/trace.js";

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

export interface RepoJudgeInput {
  session: ScanSession;
  usage: SessionUsage;
  repo: RepoRef;
  /** Local path where the repo was cloned (inventory stage). */
  repoPath: string;
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
}

const SYSTEM_PROMPT = `You are a code reader. You read a repository sample
and produce a structured Judgment about it. You must call submit_judgment
with the result.

What you receive (in tagged blocks):
  <readme>      first 3KB of README
  <tree>        depth-2 file tree
  <manifest>    package.json / Cargo.toml / pyproject.toml / etc.
  <file>        first 2KB of up to 5 source files

The ONLY test for shouldFeature=true is:
  "Did the user build something real that's worth showing on a portfolio?"

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

purpose: one honest sentence, e.g.
  "Open-source video-first podcast hosting platform with Web RTC + Whisper."
  "A toy implementation of Raft used for a distributed-systems class."
  "Auto-generated mirror of private repo — no real source code."

reason: one or two sentences explaining your shouldFeature decision,
quoting the specific README/code signal you used.

technologies: extracted from manifests + obvious framework usage (max 10).

Output ONLY by calling submit_judgment.`;

const REASONING_EFFORT = "medium" as const;

export async function judgeRepo(input: RepoJudgeInput): Promise<RepoJudgeOutput> {
  const { repo, repoPath, session, usage, trace, onProgress, emit } = input;
  const t0 = Date.now();
  const sample = await sampleRepo(repoPath);
  const formatted = formatSample(sample);

  const userInput = [
    `<repo>${repo.fullName}</repo>`,
    `<meta stars="${repo.stargazerCount ?? 0}" forks="${repo.forkCount ?? 0}" archived="${repo.isArchived}" fork="${repo.isFork}" lang="${repo.primaryLanguage ?? ""}">`,
    `description="${(repo.description ?? "").replace(/"/g, "'").slice(0, 200)}"`,
    `</meta>`,
    "",
    formatted,
  ].join("\n");

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

  const filesRead = (sample.readme ? 1 : 0) + sample.files.length + Object.keys(sample.manifests).length;

  trace?.judgeVerdict({
    label: `judge:${repo.fullName}`,
    repo: repo.fullName,
    judgeKind: judgment.kind,
    shouldFeature: judgment.shouldFeature,
    reason: judgment.reason,
    filesRead,
  });

  return {
    repo,
    judgment,
    filesRead,
    durationMs: Date.now() - t0,
  };
}

/**
 * Cap how many repos we judge in parallel. Kimi handles the parallelism
 * fine on the OpenRouter side; the limit keeps memory pressure bounded
 * since each judgment loads ~20KB of file samples.
 */
const JUDGE_CONCURRENCY = 5;

export interface JudgeAllOptions {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  /** Map of fullName → local clone path produced by inventory stage. */
  clonedPaths: Record<string, string>;
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
          };
          opts.trace?.judgeVerdict({
            label: `judge:${c.repo.fullName}`,
            repo: c.repo.fullName,
            judgeKind: judgment.kind,
            shouldFeature: judgment.shouldFeature,
            reason: judgment.reason,
            filesRead: 0,
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
  return {
    kind: "experiment",
    authorship: "primary",
    effort: "light",
    polish: "wip",
    purpose: repo.description?.slice(0, 200) ?? `Repository ${repo.fullName} (judge unavailable)`,
    shouldFeature: false,
    reason: `Judge failed: ${err.message.slice(0, 200)} — defaulted to non-featured experiment`,
    technologies: (repo.languages ?? []).slice(0, 6),
  };
}
