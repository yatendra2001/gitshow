/**
 * Unified pipeline event types. Emitted by the Fly worker via the
 * dual-sink pattern: written to D1 (durable history) and published to the
 * ScanLiveDO (realtime fan-out) in parallel.
 *
 * Structured events (everything except `stream`) land in both sinks.
 * `stream` is DO-only — free-form pino-style log lines feeding the
 * Terminal component in the web UI. Too noisy for D1.
 */

/**
 * All phase names the pipeline emits as stage-start / stage-end.
 * Source of truth: apps/worker/src/checkpoint.ts ScanPhase.
 */
export const PIPELINE_PHASES = [
  "github-fetch",
  "repo-filter",
  "inventory",
  "normalize",
  "discover",
  "workers",
  "hook",
  "numbers",
  "disclosure",
  "shipped",
  "assemble",
  "critic",
  "bind",
] as const;

export type PipelinePhase = (typeof PIPELINE_PHASES)[number];

/** Stage boundary — phase began. */
export interface StageStartEvent {
  kind: "stage-start";
  stage: string;
  detail?: string;
}

/** Stage boundary — phase ended successfully. */
export interface StageEndEvent {
  kind: "stage-end";
  stage: string;
  duration_ms: number;
  detail?: string;
}

/** Non-fatal warning emitted mid-stage. */
export interface StageWarnEvent {
  kind: "stage-warn";
  stage: string;
  message: string;
}

/** One sub-worker (parallel-stage task) transitioning state. */
export interface WorkerUpdateEvent {
  kind: "worker-update";
  worker: string;
  status: "running" | "done" | "failed";
  detail?: string;
}

/** Fatal error inside the pipeline — scan will be marked failed. */
export interface PipelineErrorEvent {
  kind: "error";
  stage?: string;
  message: string;
}

/**
 * One-line summary of what an agent is thinking. Drives the AI-Elements
 * Reasoning component — auto-closes on completion, Claude-style.
 */
export interface ReasoningEvent {
  kind: "reasoning";
  agent: string;
  text: string;
}

/**
 * A deterministic test outcome. Drives the TestResults component.
 * Examples:
 *   - bind-evidence report (each claim: pass/fail for having evidence)
 *   - hook stability check (pass if similarity > threshold)
 */
export interface TestResultEvent {
  kind: "test-result";
  agent: string;
  name: string;
  status: "pass" | "fail" | "warn";
  detail?: string;
}

/**
 * The hiring-manager evaluator's six-axis verdict. Each axis has score +
 * issues + suggestions; top-level has verdict + top_three_fixes.
 * One event per eval round.
 */
export interface EvalAxesEvent {
  kind: "eval-axes";
  round: number;
  verdict: "PASS" | "REVISE" | "BLOCK";
  overall_score: number;
  axes: Array<{
    name: string;
    score: number;
    issues: string[];
    suggestions: string[];
  }>;
  top_three_fixes: Array<{
    axis: string;
    claim_id?: string;
    fix: string;
  }>;
  would_forward?: boolean;
  why?: string;
}

/**
 * Running usage counter. Emitted every N LLM calls. Drives the live
 * cost/tokens HUD in the scan view's header.
 */
export interface UsageEvent {
  kind: "usage";
  llm_calls: number;
  total_tokens: number;
  cost_cents: number;
}

/**
 * A "what will happen next" announcement, e.g. "Reframing hook — ~3 min".
 * Drives the AI-Elements Plan card at the top of the right pane.
 */
export interface PlanEvent {
  kind: "plan";
  title: string;
  description?: string;
  eta_ms?: number;
}

/**
 * Free-form log line for the Terminal component. DO-only, NOT written to D1.
 */
export interface StreamEvent {
  kind: "stream";
  text: string;
}

export type PipelineEvent =
  | StageStartEvent
  | StageEndEvent
  | StageWarnEvent
  | WorkerUpdateEvent
  | PipelineErrorEvent
  | ReasoningEvent
  | TestResultEvent
  | EvalAxesEvent
  | UsageEvent
  | PlanEvent
  | StreamEvent;

/** The kinds that D1 actually persists (everything except stream). */
export type PersistedEventKind = Exclude<PipelineEvent["kind"], "stream">;

export const PERSISTED_KINDS: ReadonlyArray<PersistedEventKind> = [
  "stage-start",
  "stage-end",
  "stage-warn",
  "worker-update",
  "error",
  "reasoning",
  "test-result",
  "eval-axes",
  "usage",
  "plan",
];

export function isPersistedEvent(
  ev: PipelineEvent,
): ev is Exclude<PipelineEvent, StreamEvent> {
  return ev.kind !== "stream";
}

/**
 * Serializable envelope that travels between D1 rows and DO broadcasts.
 * Carries the sequence id so reconnecting clients can pick up where they
 * left off without missing events.
 */
export interface ScanEventEnvelope {
  id: number;
  scan_id: string;
  at: number;
  event: PipelineEvent;
}
