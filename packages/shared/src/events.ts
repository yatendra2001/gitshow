/**
 * Unified pipeline event types. Emitted by the Fly worker via the
 * dual-sink pattern: written to D1 (durable history) and published to the
 * ScanLiveDO (realtime fan-out) in parallel.
 *
 * Structured events (everything except `stream`) land in both sinks.
 * `stream` is DO-only — free-form pino-style log lines feeding the
 * Terminal component in the web UI. Too noisy for D1.
 *
 * ─── Schema evolution rules ────────────────────────────────────────
 *  1. Additive only — never remove a kind, never change a required
 *     field's shape. Unknown events render as a quiet fallback.
 *  2. All new fields are optional on existing types.
 *  3. `parent_id` on events attributes them to a reasoning/message
 *     scope — it's how the UI groups streaming tokens, tool cards,
 *     and sources together.
 *  4. `message_id` bounds a user-initiated turn (scan, revise, answer).
 *     Events emitted by that turn carry it; the UI renders them
 *     inline under the matching bubble.
 */

/**
 * All phase names the pipeline emits as stage-start / stage-end.
 * Source of truth: apps/worker/src/resume/pipeline.ts. The fetchers
 * stage is a parent that emits sub-phases (fetch:linkedin, fetch:hn,
 * blog-import, etc.) — the UI groups those underneath this row.
 */
export const PIPELINE_PHASES = [
  "github-fetch",
  "repo-filter",
  "inventory",
  "repo-judge",
  "fetchers",
  "merge",
  "media",
  "persist-kg",
  "evaluate-kg",
  "hero-prose",
  "render",
  "persist-resume",
  "persist-trace",
] as const;

export type PipelinePhase = (typeof PIPELINE_PHASES)[number];

// ─── Stage boundaries ─────────────────────────────────────────────

/** Stage boundary — phase began. */
export interface StageStartEvent {
  kind: "stage-start";
  stage: string;
  detail?: string;
  /** Attached to a user-initiated turn (scan, revise). */
  message_id?: string;
}

/** Stage boundary — phase ended successfully. */
export interface StageEndEvent {
  kind: "stage-end";
  stage: string;
  duration_ms: number;
  detail?: string;
  message_id?: string;
}

/** Non-fatal warning emitted mid-stage. */
export interface StageWarnEvent {
  kind: "stage-warn";
  stage: string;
  message: string;
  message_id?: string;
}

/** One sub-worker (parallel-stage task) transitioning state. */
export interface WorkerUpdateEvent {
  kind: "worker-update";
  worker: string;
  status: "running" | "done" | "failed";
  detail?: string;
  message_id?: string;
}

/** Fatal error inside the pipeline — scan will be marked failed. */
export interface PipelineErrorEvent {
  kind: "error";
  stage?: string;
  message: string;
  message_id?: string;
}

// ─── Reasoning / chain-of-thought ─────────────────────────────────

/**
 * One-line summary of what an agent is thinking. Kept for backward
 * compatibility — the richer streaming path uses reasoning-delta +
 * reasoning-end below.
 */
export interface ReasoningEvent {
  kind: "reasoning";
  agent: string;
  text: string;
  message_id?: string;
  /** Ties this reasoning to its parent stage / message. */
  parent_id?: string;
}

/**
 * A chunk of streaming reasoning text. Emitter coalesces raw tokens
 * into ~50-100ms windows so rate stays sane.
 *
 * Consumers append `text_delta` to the reasoning block identified by
 * `reasoning_id` (which also acts as parent_id for tool-start and
 * source-added events emitted during the same thought).
 */
export interface ReasoningDeltaEvent {
  kind: "reasoning-delta";
  agent: string;
  reasoning_id: string;
  text_delta: string;
  message_id?: string;
  /** Optional: a short human-readable intent set at the start.
   * "Thinking — cross-repo patterns". */
  title?: string;
}

/**
 * Reasoning block finished. Carries total duration + optional
 * summary that replaces the live shimmer with a collapsed
 * "Thought for Xs — <summary>".
 */
export interface ReasoningEndEvent {
  kind: "reasoning-end";
  agent: string;
  reasoning_id: string;
  duration_ms: number;
  summary?: string;
  message_id?: string;
}

// ─── Tool calls ───────────────────────────────────────────────────

/** Tool invocation began. Renders as a collapsed card with pending badge. */
export interface ToolStartEvent {
  kind: "tool-start";
  tool_id: string;
  tool_name: string;
  /** Human-readable label (ux-copy): "Reading commits in caddy-plugin". */
  display_label: string;
  /** First ~200 chars of stringified input JSON, for the expanded view. */
  input_preview?: string;
  agent: string;
  /** Ties this tool call to the active reasoning block. */
  parent_id?: string;
  message_id?: string;
}

/** Tool invocation returned (ok, error, or denied). */
export interface ToolEndEvent {
  kind: "tool-end";
  tool_id: string;
  status: "ok" | "err" | "denied";
  /** First ~500 chars of stringified output, for the expanded view. */
  output_preview?: string;
  duration_ms: number;
  error_message?: string;
  parent_id?: string;
  message_id?: string;
}

// ─── Sources (artifacts cited) ────────────────────────────────────

/**
 * An artifact (commit, PR, review, repo, web page) was cited by an
 * agent mid-thought. Renders as a chip under the reasoning block.
 * Chip hover shows `preview`; chip click opens the evidence drawer.
 */
export interface SourceAddedEvent {
  kind: "source-added";
  source_id: string;
  source_kind: "commit" | "pr" | "review" | "repo" | "web" | "file";
  /** One-line preview: commit msg, PR title, review comment, etc. */
  preview: string;
  agent: string;
  parent_id?: string;
  message_id?: string;
}

// ─── KPI live assembly ────────────────────────────────────────────

/**
 * One of the three KPIs resolved (numbers agent emits these as each
 * metric finishes). Enables the "tiles populate live" effect.
 */
export interface KpiPreviewEvent {
  kind: "kpi-preview";
  metric: "durability" | "adaptability" | "ownership";
  value: number;
  percentile?: number;
  confidence: "high" | "medium" | "low";
  evidence_ids?: string[];
  message_id?: string;
}

// ─── Agent questions (two-way conversation) ───────────────────────

/**
 * Model asks the user a clarifying question. Triggers:
 *   1. inline UI card under the current stage
 *   2. email + desktop push (mid-scan only; intake uses inline)
 *   3. in-app inbox entry
 *
 * User POSTs the answer to /api/scan/:id/answer. If no answer within
 * `timeout_ms`, worker proceeds with `default_answer`.
 */
export interface AgentQuestionEvent {
  kind: "agent-question";
  question_id: string;
  question: string;
  /** Optional pre-canned answers; otherwise free-form text. */
  options?: Array<{ value: string; label: string }>;
  timeout_ms: number;
  default_answer?: string;
  /** Where did the question come from — intake, mid-scan, revise. */
  stage:
    | "intake"
    | "discover"
    | "workers"
    | "hook"
    | "numbers"
    | "disclosure"
    | "shipped"
    | "critic"
    | "revise";
  message_id?: string;
}

/** User answered (or agent timed out and defaulted). For audit trail. */
export interface AgentAnswerEvent {
  kind: "agent-answer";
  question_id: string;
  answer: string | null;
  source: "user" | "timeout-default";
  message_id?: string;
}

// ─── Alternates (show the roads not taken) ────────────────────────

/**
 * Surface rejected/alternative choices so the user can pick
 * differently. Used by hook (5 candidates), numbers (shortlist),
 * and shipped (projects considered but dropped).
 */
export interface AlternateSurfacedEvent {
  kind: "alternate-surfaced";
  alternate_kind: "hook" | "kpi" | "disclosure" | "shipped";
  alternates: Array<{
    id: string;
    text: string;
    score?: number;
    reason?: string;
    confidence?: "high" | "medium" | "low";
  }>;
  /** Which one the pipeline picked (so the UI can highlight it). */
  selected_id?: string;
  message_id?: string;
}

// ─── Control plane (user stops / skips mid-flight) ────────────────

/**
 * Worker acknowledges a user-initiated control signal (stop, skip).
 * Emitted after the worker reads `scan_controls` in D1.
 */
export interface ControlAckEvent {
  kind: "control-ack";
  action: "stop" | "skip-stage";
  note?: string;
  message_id?: string;
}

// ─── Revise lifecycle ─────────────────────────────────────────────

/**
 * A revise job finished and wrote back to the profile. UI replaces
 * the live progress under the user message with a collapsed
 * "Applied · durability 8.4 → 7.2" summary row.
 */
export interface ReviseAppliedEvent {
  kind: "revise-applied";
  /** The user's revise message_id — scopes this event to that bubble. */
  message_id: string;
  diff: Array<{
    beat: string;
    claim_id?: string;
    before: string;
    after: string;
  }>;
  /** R2 snapshot key for undo. */
  undo_snapshot?: string;
}

// ─── Message lifecycle ────────────────────────────────────────────

/**
 * Bounds a user-initiated turn. Every scan, revise, and answer gets
 * one of these at start and end. Lets the UI know when to render
 * a new bubble and when to collapse it.
 */
export interface MessageStartEvent {
  kind: "message-start";
  message_id: string;
  turn_kind: "scan" | "revise" | "answer" | "intake";
  /** Links a revise/answer back to the scan or question that prompted it. */
  parent_id?: string;
  /** Free-form preview of what the turn is about. */
  preview?: string;
}

export interface MessageEndEvent {
  kind: "message-end";
  message_id: string;
  duration_ms: number;
  status: "ok" | "err" | "cancelled";
}

// ─── Existing: test-result, eval-axes, usage, plan, stream ────────

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
  message_id?: string;
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
  message_id?: string;
}

/**
 * Running usage counter. Kept for internal telemetry. The UI MUST
 * NOT surface `cost_cents` — cost is abstracted from users by design.
 */
export interface UsageEvent {
  kind: "usage";
  llm_calls: number;
  total_tokens: number;
  cost_cents: number;
  message_id?: string;
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
  message_id?: string;
}

/**
 * Free-form log line for the Terminal component. DO-only, NOT written to D1.
 */
export interface StreamEvent {
  kind: "stream";
  text: string;
}

// ─── Discriminated union + helpers ────────────────────────────────

export type PipelineEvent =
  | StageStartEvent
  | StageEndEvent
  | StageWarnEvent
  | WorkerUpdateEvent
  | PipelineErrorEvent
  | ReasoningEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | SourceAddedEvent
  | KpiPreviewEvent
  | AgentQuestionEvent
  | AgentAnswerEvent
  | AlternateSurfacedEvent
  | ControlAckEvent
  | ReviseAppliedEvent
  | MessageStartEvent
  | MessageEndEvent
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
  "reasoning-delta",
  "reasoning-end",
  "tool-start",
  "tool-end",
  "source-added",
  "kpi-preview",
  "agent-question",
  "agent-answer",
  "alternate-surfaced",
  "control-ack",
  "revise-applied",
  "message-start",
  "message-end",
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
  /** Optional — propagates through pipeline → event sinks for tracing. */
  trace_id?: string;
}

// ─── WS control frames (client ↔ DO) ─────────────────────────────
//
// These live on the wire but are NOT PipelineEvent — they're the
// handshake layer between a browser and ScanLiveDO. Kept here so both
// sides import the same definitions.

/** Server → client on WS open or after a client subscribe. */
export interface ServerHelloFrame {
  kind: "hello";
  scan_id: string | null;
  /** The highest sequence id the DO currently has. */
  seq: number;
  /** Events replayed for the client. */
  backlog: ScanEventEnvelope[];
}

/**
 * Server → client when the client's `since` is older than the DO's
 * ring buffer floor. Client must do a one-shot D1 fetch for
 * [since, gap.oldest_seq - 1] then rely on live WS for the rest.
 */
export interface ServerGapFrame {
  kind: "gap";
  oldest_seq: number;
}

/** Server → client keepalive. Client MUST reply with `pong`. */
export interface ServerPingFrame {
  kind: "ping";
  ts: number;
}

/** Server → client when the scan has finished — client may tear down. */
export interface ServerDoneFrame {
  kind: "done";
  final_seq: number;
  status: "succeeded" | "failed" | "cancelled";
}

export type ServerFrame =
  | ServerHelloFrame
  | ServerGapFrame
  | ServerPingFrame
  | ServerDoneFrame
  | ScanEventEnvelope;

/** Client → server on (re)connect: "catch me up from this seq". */
export interface ClientSubscribeFrame {
  kind: "subscribe";
  since: number;
}

/** Client → server in response to a server ping. */
export interface ClientPongFrame {
  kind: "pong";
  ts: number;
}

export type ClientFrame = ClientSubscribeFrame | ClientPongFrame;
