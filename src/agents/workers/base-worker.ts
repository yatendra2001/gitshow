/**
 * Shared worker harness.
 *
 * Each worker has one narrow job (temporal, cross-repo, content, signal).
 * They all consume the discover paragraph + the artifact table, run with
 * the 4 worker tools (browse_web, search_web, search_github, query_artifacts),
 * and submit a WorkerOutput with evidence-bound claims.
 *
 * The shared harness enforces the evidence contract, retry behavior, and
 * per-worker budget. Individual worker modules just provide a name, a
 * system prompt, and an input formatter.
 */

import { runAgentWithSubmit } from "../base.js";
import {
  WorkerOutputSchema,
  type WorkerOutput,
  type Artifact,
  type ScanSession,
  type DiscoverOutput,
} from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ArtifactIndexes } from "../../normalize.js";
import { createWorkerTools } from "../../tools/web.js";
import { nanoid } from "nanoid";

export interface WorkerDeps {
  session: ScanSession;
  usage: SessionUsage;
  artifacts: Record<string, Artifact>;
  indexes: ArtifactIndexes;
  discover: DiscoverOutput;
  /** Where to stage new `web` artifacts found by tools. */
  artifactSink: Record<string, Artifact>;
  /** Cache dir for web fetches. */
  profileDir: string;
  onProgress?: (text: string) => void;
}

export interface RunWorkerInput extends WorkerDeps {
  name: string;
  systemPrompt: string;
  /** Renders the "here is the slice of data for you" message. */
  buildInput: (deps: WorkerDeps) => string;
  webBudget?: number;
  githubSearchBudget?: number;
  /**
   * Grant code-reading tools (list_tree, read_file, git_log, git_show)
   * so the worker can inspect actual source code, not just metadata.
   */
  includeCodeTools?: boolean;
}

export async function runWorker(input: RunWorkerInput): Promise<WorkerOutput> {
  const tools = createWorkerTools({
    session: input.session,
    usage: input.usage,
    artifacts: input.artifacts,
    artifactSink: input.artifactSink,
    profileDir: input.profileDir,
    // Unlimited by default. Workers decide when they have enough evidence.
    webBudget: input.webBudget ?? Number.POSITIVE_INFINITY,
    githubSearchBudget: input.githubSearchBudget ?? Number.POSITIVE_INFINITY,
    log: input.onProgress,
    handle: input.session.handle,
    includeCodeTools: input.includeCodeTools,
  });

  const userMessage = input.buildInput(input);

  const { result } = await runAgentWithSubmit({
    model: input.session.model,
    systemPrompt: input.systemPrompt,
    input: userMessage,
    extraTools: tools,
    submitToolName: "submit_worker_output",
    submitToolDescription:
      "Submit your claims + any new artifacts you discovered via tools. " +
      "Every claim MUST have >=1 evidence_id that resolves to an artifact " +
      "(either from the pre-fetched table or from your tool calls). Call exactly once.",
    submitSchema: WorkerOutputSchema,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: input.name,
    onProgress: input.onProgress,
  });

  // Post-process: assign claim IDs if not set, tag worker
  const stamped: WorkerOutput = {
    worker: result.worker || input.name,
    claims: result.claims.map((c) => ({
      ...c,
      id: c.id && c.id.length > 0 ? c.id : `${input.name}:${nanoid(6)}`,
    })),
    new_artifacts: result.new_artifacts ?? [],
    notes: result.notes,
  };

  return stamped;
}

// Re-export the shared helpers so existing worker files keep importing
// them from this module. Single source of truth lives in prompt-helpers.
export { renderDiscoverHeader, CLAIM_RULES_BLOCK } from "../prompt-helpers.js";
