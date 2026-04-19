/**
 * Pipeline orchestrator for the v2 AI backend.
 *
 * Design: orchestrator-workers pattern (Anthropic) + evaluator-optimizer for
 * the hook loop. Deterministic code wraps the LLM steps — normalize and
 * assemble are pure; every LLM call is a focused sub-agent.
 *
 * Stages (see checkpoint.ts for file layout):
 *   1  github-fetch   — gh CLI (no LLM)
 *   2  repo-filter    — tiered (no LLM)
 *   3  inventory      — clone + git-inventory per deep repo (no LLM, parallel)
 *   4  normalize      — artifact table + indexes (no LLM)
 *   5  discover       — 1 LLM call
 *   6  workers        — 4 parallel LLM calls (cross-repo, temporal, content, signal)
 *   7  hook           — writer + critic loop (up to 2 rounds)
 *   8  numbers        — 1 LLM call
 *   9  disclosure     — 1 LLM call (may return empty)
 *   10 shipped        — 1 LLM call
 *   11 assemble       — merge into Profile (no LLM)
 *   12 critic         — 1 LLM call (profile-level critic)
 *   13 bind           — validate evidence refs (no LLM)
 *
 * ~9 LLM calls per profile, 4 of them concurrent.
 *
 * Checkpointed at every stage boundary. Resumable with the same session_id.
 */

import pLimit from "p-limit";

import { ScanCheckpoint, shouldRun, type ScanPhase } from "./checkpoint.js";
import { fetchGitHubData } from "./github-fetcher.js";
import { filterRepos } from "./repo-filter.js";
import { normalize, type NormalizeResult } from "./normalize.js";
import { cloneAndInventory } from "./inventory-runner.js";
import { SessionUsage } from "./session.js";
import { assembleProfile } from "./assemble.js";
import { bindEvidence, formatBindReport } from "./bind-evidence.js";
import { emitCard } from "./emit-card.js";
import { applyGuardrails, formatGuardrailReport } from "./guardrails.js";

import { runDiscover } from "./agents/discover.js";
import { runCrossRepoWorker } from "./agents/workers/cross-repo.js";
import { runTemporalWorker } from "./agents/workers/temporal.js";
import { runContentWorker } from "./agents/workers/content.js";
import { runSignalWorker } from "./agents/workers/signal.js";
import { runDeepDiveWorker } from "./agents/workers/deep-dive.js";
import { runReviewsWorker } from "./agents/workers/reviews.js";
import { runHookWriter } from "./agents/hook/writer.js";
import { runHookCritic } from "./agents/hook/critic.js";
import { runHookStabilityCheck } from "./agents/hook/stability-check.js";
import { runAngleSelector } from "./agents/hook/angle-selector.js";
import { runNumbersAgent } from "./agents/numbers.js";
import { runDisclosureAgent } from "./agents/disclosure.js";
import { runShippedAgent } from "./agents/shipped.js";
import { runProfileCritic } from "./agents/profile-critic.js";
import { runCopyEditor } from "./agents/copy-editor.js";
import { runTimelineAgent } from "./agents/timeline.js";
import { runHiringReviseLoop } from "./revise-loop.js";

import type {
  GitHubData,
  FilterResult,
  StructuredInventory,
} from "./types.js";
import type {
  Artifact,
  Profile,
  ScanSession,
  DiscoverOutput,
  WorkerOutput,
  HookCandidate,
  PipelineMeta,
} from "./schemas.js";

const PIPELINE_VERSION = "0.2.0-v2";

/**
 * Load a required checkpoint file or throw with a clear message.
 * Replaces the unsafe `(await loadFile(x))!` pattern.
 */
async function requireFile<T>(
  ckpt: ScanCheckpoint,
  filename: string,
  stage: string,
): Promise<T> {
  const loaded = await ckpt.loadFile<T>(filename);
  if (!loaded) {
    throw new Error(
      `Stage "${stage}" expected ${ckpt.checkpointDir}/${filename} to exist but it's missing. ` +
      `Delete ${ckpt.checkpointDir}/checkpoint.json to force a clean restart.`,
    );
  }
  return loaded;
}

export type StageName =
  | "github-fetch"
  | "repo-filter"
  | "inventory"
  | "normalize"
  | "discover"
  | "workers"
  | "hook"
  | "numbers"
  | "disclosure"
  | "shipped"
  | "assemble"
  | "critic"
  | "bind";

/**
 * Pipeline events flow as the shared PipelineEvent union (see
 * @gitshow/shared/events). The pipeline emits stage boundaries,
 * worker updates, and stream lines; agents emit reasoning deltas,
 * tool calls, sources, and KPI previews through the same channel.
 */
export type { PipelineEvent } from "@gitshow/shared/events";
import type { PipelineEvent as SharedPipelineEvent } from "@gitshow/shared/events";

export interface RunPipelineInput {
  session: ScanSession;
  /** Parallelism for the inventory stage (repo clone + git-inventory). */
  concurrency?: number;
  /**
   * Max repos to deep-scan. Default: no cap — every deep repo is analyzed.
   * Pass a number only when deliberately testing or short on disk.
   */
  maxDeepRepos?: number | null;
  /** Event callback. Receives the full shared PipelineEvent union. */
  onEvent?: (ev: SharedPipelineEvent) => void;
  /**
   * Override the checkpoint (used by the cloud entrypoint to inject an
   * R2-mirroring checkpoint). Defaults to a plain local-disk checkpoint.
   */
  checkpoint?: ScanCheckpoint;
  /** Scope every emitted event to a user-initiated turn. Default: none. */
  messageId?: string;
}

export async function runPipeline(input: RunPipelineInput): Promise<Profile> {
  const events = input.onEvent ?? (() => {});
  const stream = (text: string) => events({ kind: "stream", text });
  const messageId = input.messageId;
  const concurrency = input.concurrency ?? 3;

  // Convenience wrapper: add the scan's messageId to events that accept
  // it. Agents that emit reasoning/tools carry it forward via their own
  // emit passthrough.
  const emitScoped = (ev: SharedPipelineEvent) => {
    if (messageId && "message_id" in ev && !ev.message_id) {
      events({ ...ev, message_id: messageId });
    } else {
      events(ev);
    }
  };

  const ckpt = input.checkpoint ?? new ScanCheckpoint(input.session);
  await ckpt.init();
  const existing = await ckpt.loadExisting();
  if (existing) {
    stream(`[pipeline] resuming at phase "${existing.phase}"\n`);
  }

  const usage = new SessionUsage();
  const stageTimings: PipelineMeta["stage_timings"] = [];

  const withStage = async <T>(stage: StageName, fn: () => Promise<T>, detail?: string): Promise<T> => {
    emitScoped({ kind: "stage-start", stage, detail });
    const t0 = Date.now();
    const startedAt = new Date().toISOString();
    try {
      const result = await fn();
      const duration_ms = Date.now() - t0;
      stageTimings.push({
        stage,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms,
      });
      emitScoped({ kind: "stage-end", stage, duration_ms, detail });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      usage.recordError(`${stage}: ${msg}`);
      ckpt.addError(`${stage}: ${msg}`);
      throw err;
    }
  };

  // ── 1. GitHub fetch ────────────────────────────────────────
  let githubData: GitHubData;
  if (shouldRun(ckpt.currentPhase, "github-fetch")) {
    githubData = await withStage("github-fetch", async () => {
      const d = await fetchGitHubData(input.session.handle);
      await ckpt.saveGitHubData(d);
      return d;
    }, `@${input.session.handle}`);
  } else {
    githubData = await requireFile<GitHubData>(ckpt, "01-github-data.json", "github-fetch");
    stream(`[pipeline] loaded github data (${githubData.ownedRepos.length} repos)\n`);
  }

  // ── 2. Repo filter ─────────────────────────────────────────
  let filtered: FilterResult;
  if (shouldRun(ckpt.currentPhase, "repo-filter")) {
    filtered = await withStage("repo-filter", async () => {
      const f = filterRepos(githubData);
      await ckpt.saveFilter(f);
      return f;
    }, `${githubData.ownedRepos.length} repos`);
  } else {
    filtered = await requireFile<FilterResult>(ckpt, "02-filter.json", "repo-filter");
    stream(`[pipeline] loaded filter (${filtered.deep.length} deep, ${filtered.light.length} light)\n`);
  }

  // ── 3. Inventory (parallel, per-repo checkpointed) ─────────
  const inventories: Record<string, StructuredInventory> = {};
  if (shouldRun(ckpt.currentPhase, "inventory")) {
    await withStage(
      "inventory",
      async () => {
        // Merge existing inventories if resuming
        const existingInv = await ckpt.loadFile<Record<string, StructuredInventory>>("03-inventories.json");
        if (existingInv) Object.assign(inventories, existingInv);

        const deepRepos = input.maxDeepRepos === null || input.maxDeepRepos === undefined
          ? filtered.deep
          : filtered.deep.slice(0, input.maxDeepRepos);

        const limit = pLimit(concurrency);
        await Promise.all(
          deepRepos.map((repo) =>
            limit(async () => {
              if (inventories[repo.fullName]) return;
              events({ kind: "worker-update", worker: repo.fullName, status: "running" });
              try {
                const inv = await cloneAndInventory({
                  fullName: repo.fullName,
                  handle: input.session.handle,
                  profileDir: ckpt.checkpointDir,
                  log: stream,
                });
                inventories[repo.fullName] = inv;
                ckpt.markInventoryComplete(repo.fullName);
                events({ kind: "worker-update", worker: repo.fullName, status: "done", detail: `${inv.stats.userCommits} commits` });
                // Incremental checkpoint
                await ckpt.saveFile("03-inventories.json", inventories);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                events({ kind: "worker-update", worker: repo.fullName, status: "failed", detail: msg.slice(0, 120) });
                ckpt.addError(`inventory ${repo.fullName}: ${msg.slice(0, 300)}`);
              }
            }),
          ),
        );

        await ckpt.saveInventories(inventories);
      },
      `${filtered.deep.length} deep repos`,
    );
  } else {
    const cached = await ckpt.loadFile<Record<string, StructuredInventory>>("03-inventories.json");
    if (cached) Object.assign(inventories, cached);
    stream(`[pipeline] loaded ${Object.keys(inventories).length} inventories from checkpoint\n`);
  }

  // ── 4. Normalize ───────────────────────────────────────────
  let normalized: NormalizeResult;
  if (shouldRun(ckpt.currentPhase, "normalize")) {
    normalized = await withStage(
      "normalize",
      async () => {
        const n = normalize({ github: githubData, inventories });
        await ckpt.saveNormalized(n);
        return n;
      },
      `artifact table`,
    );
  } else {
    normalized = await requireFile<NormalizeResult>(ckpt, "04-normalized.json", "normalize");
    stream(`[pipeline] loaded artifact table (${Object.keys(normalized.artifacts).length} artifacts)\n`);
  }

  // Mutable artifact dict — workers can add `web` artifacts via tools.
  const artifacts: Record<string, Artifact> = { ...normalized.artifacts };

  // ── 5. Discover ────────────────────────────────────────────
  let discover: DiscoverOutput;
  if (shouldRun(ckpt.currentPhase, "discover")) {
    discover = await withStage(
      "discover",
      async () => {
        const d = await runDiscover({
          session: input.session,
          usage,
          github: githubData,
          artifacts,
          indexes: normalized.indexes,
          onProgress: stream,
          emit: emitScoped,
          messageId,
        });
        await ckpt.saveDiscover(d);
        return d;
      },
    );
  } else {
    discover = await requireFile<DiscoverOutput>(ckpt, "05-discover.json", "discover");
    stream(`[pipeline] loaded discover\n`);
  }

  // ── 6. Parallel workers ────────────────────────────────────
  const WORKER_COUNT = 6; // cross-repo + temporal + content + signal + deep-dive + reviews
  let workerOutputs: WorkerOutput[] = [];
  if (shouldRun(ckpt.currentPhase, "workers")) {
    workerOutputs = await withStage(
      "workers",
      async () => {
        const artifactSink: Record<string, Artifact> = {};
        const deps = {
          session: input.session,
          usage,
          artifacts,
          indexes: normalized.indexes,
          discover,
          artifactSink,
          profileDir: ckpt.checkpointDir,
          onProgress: stream,
        };

        const workers = [
          { name: "cross-repo", run: runCrossRepoWorker },
          { name: "temporal",   run: runTemporalWorker },
          { name: "content",    run: runContentWorker },
          { name: "signal",     run: runSignalWorker },
          { name: "deep-dive",  run: runDeepDiveWorker },
          { name: "reviews",    run: runReviewsWorker },
        ] as const;

        const results = await Promise.all(
          workers.map(async (w) => {
            events({ kind: "worker-update", worker: w.name, status: "running" });
            try {
              const out = await w.run(deps);
              events({ kind: "worker-update", worker: w.name, status: "done", detail: `${out.claims.length} claims` });
              return out;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              events({ kind: "worker-update", worker: w.name, status: "failed", detail: msg.slice(0, 120) });
              ckpt.addError(`worker ${w.name}: ${msg.slice(0, 300)}`);
              return { worker: w.name, claims: [], new_artifacts: [], notes: `failed: ${msg.slice(0, 200)}` };
            }
          }),
        );

        // Merge any new artifacts discovered by workers (from sink + each result)
        for (const [id, a] of Object.entries(artifactSink)) {
          if (!artifacts[id]) artifacts[id] = a;
        }
        for (const r of results) {
          for (const a of r.new_artifacts ?? []) {
            if (!artifacts[a.id]) artifacts[a.id] = a;
          }
        }

        await ckpt.saveWorkers({ outputs: results, artifactsSnapshot: Object.keys(artifacts).length });
        // Persist updated artifact table (merged)
        await ckpt.saveFile("04-normalized.json", { artifacts, indexes: normalized.indexes });
        return results;
      },
      `${WORKER_COUNT} parallel`,
    );
  } else {
    const loaded = await ckpt.loadFile<{ outputs: WorkerOutput[] }>("06-workers.json");
    workerOutputs = loaded?.outputs ?? [];
    const reloaded = await ckpt.loadFile<NormalizeResult>("04-normalized.json");
    if (reloaded) Object.assign(artifacts, reloaded.artifacts);
    stream(`[pipeline] loaded ${workerOutputs.length} worker outputs\n`);
  }

  // ── 7. Hook loop (writer + critic, max 2 rounds) ──────────
  let hook: HookCandidate | null = null;
  // The angle selection lives outside the `hook` stage so the revise loop
  // can see it. It's deliberately NOT checkpointed separately here — it's
  // saved along with the hook itself in 07-hook.json.
  let hookAngle: import("./schemas.js").HookAngleSelection | null = null;

  if (shouldRun(ckpt.currentPhase, "hook")) {
    hook = await withStage("hook", async () => {
      // STEP 1 — angle selector picks the dominant framing
      hookAngle = await runAngleSelector({
        session: input.session,
        usage,
        discover,
        workerOutputs,
        onProgress: stream,
      });
      stream(`[pipeline] hook angle: ${hookAngle.angle} — ${hookAngle.reason}\n`);

      // STEP 2 — writer + critic loop under the fixed angle
      const MAX_ROUNDS = 2;
      let reviseInstruction: string | undefined;
      let last: { candidates: HookCandidate[]; critique: unknown } | null = null;
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const candidates = await runHookWriter({
          session: input.session,
          usage,
          discover,
          workerOutputs,
          artifacts,
          angle: hookAngle,
          reviseInstruction,
          onProgress: stream,
        });
        const critique = await runHookCritic({
          session: input.session,
          usage,
          candidates,
          discover,
          onProgress: stream,
        });
        last = { candidates: candidates.candidates, critique };
        if (critique.winner_index !== null) {
          const winner = candidates.candidates[critique.winner_index];
          await ckpt.saveHook({ round, angle: hookAngle, candidates: candidates.candidates, critique, winner });
          return winner;
        }
        reviseInstruction = critique.revise_instruction;
      }
      // Exhausted — take best-effort from last critic scores
      if (last) {
        const scored = (last.critique as { scores: Array<{ index: number; specific: number; verifiable: number; surprising: number; earned: number }> }).scores;
        const best = [...scored].sort((a, b) =>
          (b.specific + b.verifiable + b.surprising + b.earned) -
          (a.specific + a.verifiable + a.surprising + a.earned),
        )[0];
        const winner = last.candidates[best.index];
        await ckpt.saveHook({ round: MAX_ROUNDS, angle: hookAngle, candidates: last.candidates, critique: last.critique, winner, note: "forced best-of" });
        return winner;
      }
      return null;
    });
  } else {
    const loaded = await ckpt.loadFile<{ winner: HookCandidate; angle?: import("./schemas.js").HookAngleSelection }>("07-hook.json");
    hook = loaded?.winner ?? null;
    hookAngle = loaded?.angle ?? null;
    stream(`[pipeline] loaded hook${hookAngle ? ` (angle: ${hookAngle.angle})` : ""}\n`);
  }

  // ── 8. Numbers ─────────────────────────────────────────────
  let numbers: WorkerOutput;
  if (shouldRun(ckpt.currentPhase, "numbers")) {
    numbers = await withStage("numbers", async () => {
      const n = await runNumbersAgent({
        session: input.session,
        usage,
        discover,
        workerOutputs,
        artifacts,
        onProgress: stream,
      });
      await ckpt.saveNumbers(n);
      return n;
    });
  } else {
    numbers = await requireFile<WorkerOutput>(ckpt, "08-numbers.json", "numbers");
  }

  // ── 9. Disclosure ──────────────────────────────────────────
  let disclosure: WorkerOutput;
  if (shouldRun(ckpt.currentPhase, "disclosure")) {
    disclosure = await withStage("disclosure", async () => {
      const d = await runDisclosureAgent({
        session: input.session,
        usage,
        discover,
        workerOutputs,
        artifacts,
        onProgress: stream,
      });
      await ckpt.saveDisclosure(d);
      return d;
    });
  } else {
    disclosure = await requireFile<WorkerOutput>(ckpt, "09-disclosure.json", "disclosure");
  }

  // ── 10. Shipped ────────────────────────────────────────────
  let shipped: WorkerOutput;
  if (shouldRun(ckpt.currentPhase, "shipped")) {
    shipped = await withStage("shipped", async () => {
      const s = await runShippedAgent({
        session: input.session,
        usage,
        discover,
        workerOutputs,
        artifacts,
        onProgress: stream,
      });
      await ckpt.saveShipped(s);
      return s;
    });
  } else {
    shipped = await requireFile<WorkerOutput>(ckpt, "10-shipped.json", "shipped");
  }

  // ── 11. Assemble ───────────────────────────────────────────
  let profile: Profile;
  if (shouldRun(ckpt.currentPhase, "assemble")) {
    profile = await withStage("assemble", async () => {
      const meta: PipelineMeta = {
        pipeline_version: PIPELINE_VERSION,
        session: input.session,
        stage_timings: stageTimings,
        llm_calls: usage.llmCalls,
        web_calls: usage.webCalls,
        github_search_calls: usage.githubSearchCalls,
        total_tokens: usage.totalTokens,
        estimated_cost_usd: usage.estimatedCostUsd,
        errors: usage.errors,
      };
      const p = assembleProfile({
        session: input.session,
        discover,
        workerOutputs,
        hook,
        numbers,
        disclosure,
        shipped,
        artifacts,
        meta,
        pipelineVersion: PIPELINE_VERSION,
      });
      await ckpt.saveProfileDraft(p);
      return p;
    });

    // ── 11b. Copy-editor voice pass ──────────────────────────
    // Runs INSIDE the "assemble" phase — rewrites every claim's text
    // for human voice before the critic judges it. Preserves evidence
    // ids and numbers; only prose changes.
    // We keep 11-profile-draft.json as the PRE-EDIT snapshot so diffs
    // against 11b-copy-edited.json show exactly what the editor changed.
    try {
      const edited = await runCopyEditor({
        session: input.session,
        usage,
        profile,
        onProgress: stream,
      });
      profile = edited;
      await ckpt.saveFile("11b-copy-edited.json", profile);
      stream(`[pipeline] copy-editor: voice pass complete\n`);

      // ── 11c. Deterministic guardrails ────────────────────
      // Hedges placeholder-shaped low-confidence numbers ("999 features")
      // by pairing with the inventory denominator when available, else
      // rounding up to a measurement-style value ("~1,000 features").
      // Runs BEFORE the critic so the critic sees the safe form.
      const { profile: guarded, report: gr } = applyGuardrails(profile);
      profile = guarded;
      stream(`[pipeline] ${formatGuardrailReport(gr)}\n`);
      await ckpt.saveFile("11c-guardrail-report.json", gr);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stream(`[pipeline] WARNING: copy-editor failed, shipping unedited: ${msg.slice(0, 200)}\n`);
      ckpt.addError(`copy-editor: ${msg.slice(0, 300)}`);
    }
  } else {
    profile = await requireFile<Profile>(ckpt, "11-profile-draft.json", "assemble");
  }

  // ── 12. Profile critic ─────────────────────────────────────
  if (shouldRun(ckpt.currentPhase, "critic")) {
    await withStage("critic", async () => {
      const critique = await runProfileCritic({
        session: input.session,
        usage,
        discover,
        claims: profile.claims,
        artifacts: profile.artifacts,
        onProgress: stream,
      });
      await ckpt.saveCritic(critique);

      // Soft action: mark flagged claims with lower confidence in the profile
      const flagged = new Set(critique.flagged_claims.map((f) => f.claim_id));
      if (flagged.size > 0) {
        profile = {
          ...profile,
          claims: profile.claims.map((c) =>
            flagged.has(c.id)
              ? { ...c, confidence: "low", extra: { ...(c.extra ?? {}), critic_flag: critique.flagged_claims.find((f) => f.claim_id === c.id) } }
              : c,
          ),
        };
      }
    });
  } else {
    stream(`[pipeline] critic already ran\n`);
  }

  // ── 13. Bind evidence ──────────────────────────────────────
  const bindReport = await withStage("bind", async () => {
    const r = bindEvidence(profile);
    stream(`[pipeline] ${formatBindReport(r)}\n`);
    await ckpt.saveFile("bind-report.json", r);
    return r;
  });

  // Final profile with updated meta (finalize counters)
  profile = {
    ...profile,
    generated_at: new Date().toISOString(),
    meta: {
      ...profile.meta,
      llm_calls: usage.llmCalls,
      web_calls: usage.webCalls,
      github_search_calls: usage.githubSearchCalls,
      total_tokens: usage.totalTokens,
      estimated_cost_usd: usage.estimatedCostUsd,
      errors: usage.errors,
      stage_timings: stageTimings,
    },
  };

  await ckpt.saveProfile(profile);

  // Attach bind report to the profile's meta.errors list as warnings if any
  if (bindReport.claims_missing_evidence.length > 0 || bindReport.claims_with_orphan_refs.length > 0) {
    stream(`[pipeline] WARNING: evidence binding has ${bindReport.claims_missing_evidence.length + bindReport.claims_with_orphan_refs.length} issue(s) — see bind-report.json\n`);
  }

  // ── 13b. Senior hiring-manager revise LOOP ─────────────────
  // Strict six-axis evaluator that ACTS on its own verdict. On REVISE or
  // BLOCK, dispatches each top_three_fix to the affected agent (hook,
  // numbers, disclosure, copy-editor, or evidence downgrader) and
  // re-evaluates. Up to 2 revise rounds; exits early on PASS.
  //
  // When the loop finishes, `hiringReview` is the LAST verdict — either
  // PASS (we got there) or whatever state remained after max rounds.
  let hiringReview: import("./schemas.js").HiringManagerOutput | undefined;
  let reviseRounds = 0;
  try {
    const loopResult = await runHiringReviseLoop({
      session: input.session,
      usage,
      discover,
      workerOutputs,
      profile,
      hookAngle,
      onProgress: stream,
      saveRound: async (round, payload) => {
        await ckpt.saveFile(`13c-revise-round-${round}.json`, payload);
      },
    });
    profile = loopResult.profile;
    hiringReview = loopResult.finalReview;
    reviseRounds = loopResult.rounds;

    await ckpt.saveFile("13b-hiring-review.json", hiringReview);
    stream(
      `[pipeline] hiring-manager: ${hiringReview.verdict} (${hiringReview.overall_score}/100) ` +
        `after ${reviseRounds} revise round${reviseRounds === 1 ? "" : "s"} — ` +
        `forwardable=${hiringReview.forwarding_test.would_a_senior_eng_forward_this}\n`,
    );
    if (hiringReview.block_triggers.length > 0) {
      for (const t of hiringReview.block_triggers.slice(0, 5)) {
        stream(`[pipeline] BLOCK TRIGGER: ${t}\n`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stream(`[pipeline] WARNING: hiring-manager loop failed: ${msg.slice(0, 200)}\n`);
    ckpt.addError(`hiring-manager: ${msg.slice(0, 300)}`);
  }

  // ── 14a-pre. Hook stability check (always on — accuracy > cost) ──
  // Runs a second hook-writer+critic pass under the SAME angle and measures
  // how similar the winners are. Using the same angle means we measure pure
  // writer variance, not angle-selector variance (which would double-count).
  let hookStability: import("./agents/hook/stability-check.js").StabilityReport | undefined;
  if (hook && hookAngle) {
    try {
      hookStability = await runHookStabilityCheck({
        session: input.session,
        usage,
        discover,
        workerOutputs,
        artifacts,
        canonicalWinner: hook,
        angle: hookAngle,
        onProgress: stream,
      });
      stream(`[pipeline] hook stability: ${hookStability.verdict} (sim=${hookStability.similarity}) — ${hookStability.note}\n`);
      await ckpt.saveFile("14a0-hook-stability.json", hookStability);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stream(`[pipeline] WARNING: stability check failed: ${msg.slice(0, 200)}\n`);
    }
  }

  // ── 14a. Timeline agent (chart data) ─────────────────────
  let timelineEntries: import("./schemas.js").TimelineChartEntry[] = [];
  try {
    const timelineOut = await runTimelineAgent({
      session: input.session,
      usage,
      discover,
      workerOutputs,
      shippedClaims: profile.claims
        .filter((c) => c.beat === "shipped-line")
        .map((c) => ({ text: c.text, label: c.label, sublabel: c.sublabel })),
      onProgress: stream,
    });
    timelineEntries = timelineOut.entries;
    await ckpt.saveFile("14a-timeline.json", timelineOut);
    stream(`[pipeline] timeline: ${timelineEntries.length} entries\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stream(`[pipeline] WARNING: timeline agent failed: ${msg.slice(0, 200)}\n`);
    ckpt.addError(`timeline: ${msg.slice(0, 300)}`);
  }

  // ── 14b. Emit slim frontend card ─────────────────────────
  const critic = await ckpt.loadFile<import("./schemas.js").ProfileCriticOutput>("12-critic.json");
  const card = emitCard({
    profile,
    critic: critic ?? undefined,
    primary_shape: discover.primary_shape,
    timeline: timelineEntries,
    stability: hookStability
      ? {
          hook_similarity: hookStability.similarity,
          verdict: hookStability.verdict,
          note: hookStability.note,
        }
      : undefined,
    hiringReview,
  });
  await ckpt.saveFile("14-card.json", card);
  stream(`[pipeline] card: ${(JSON.stringify(card).length / 1024).toFixed(1)} KB → profiles/${input.session.handle}/14-card.json\n`);

  await ckpt.markComplete();

  return profile;
}

// Re-export phase order for CLI label rendering
export { phaseIndex, shouldRun, type ScanPhase } from "./checkpoint.js";
