/**
 * PostHog observability client — wraps posthog-node for the AI pipeline.
 *
 * Two surfaces:
 *
 *   captureEvent({ name, properties }) — standard events. Use for
 *     stage start/end, fetcher facts, judge verdicts, KG merger
 *     decisions. Anything you'd put on a live timeline.
 *
 *   captureLlm({ ... }) — `$ai_generation` events for PostHog's LLM
 *     analytics product. One per LLM call. Captures prompt, response,
 *     tokens, latency, cost, error state. Drives the LLM analytics
 *     dashboard ("which model is slowest?", "why did this scan cost
 *     $1.20?").
 *
 * Singleton + env-gated: if POSTHOG_PROJECT_API_KEY is missing the
 * client is a no-op. The pipeline runs without PostHog; you just
 * lose the dashboard.
 *
 * The client must be `flush()`ed at scan end so events from
 * short-lived Fly Machines actually leave the box.
 */

import { PostHog } from "posthog-node";
import { categoryForModel, costForCall, displayNameForModel } from "./pricing.js";

const DEFAULT_HOST = "https://us.i.posthog.com";

let client: PostHog | null = null;
let initAttempted = false;
let activeScanId: string | null = null;
let activeHandle: string | null = null;
let activeAggregator: ScanCostAggregator | null = null;

function getClient(): PostHog | null {
  if (initAttempted) return client;
  initAttempted = true;
  const apiKey = process.env.POSTHOG_PROJECT_API_KEY;
  if (!apiKey) return null;
  client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST ?? DEFAULT_HOST,
    flushAt: 20,
    flushInterval: 5_000,
  });
  return client;
}

/**
 * Bind the current scan context. Subsequent capture calls use these
 * as the default distinctId + scan_id property unless overridden.
 * Call once near the top of `runResumePipeline`. Also resets the
 * per-scan cost aggregator.
 */
export function bindScanContext(args: { scanId: string; handle: string }): void {
  activeScanId = args.scanId;
  activeHandle = args.handle;
  activeAggregator = new ScanCostAggregator(args.scanId, args.handle);
}

export function clearScanContext(): void {
  activeScanId = null;
  activeHandle = null;
  activeAggregator = null;
}

/** Read the running scan's accumulated cost summary (for trace.json). */
export function getScanCostSummary(): ScanCostSummary | null {
  return activeAggregator ? activeAggregator.summary() : null;
}

export interface CaptureEventInput {
  /** Event name. Use object-verb naming: "stage started", "judge verdict". */
  name: string;
  properties?: Record<string, unknown>;
  /** Override distinct id (defaults to bound handle). */
  distinctId?: string;
}

export function captureEvent(input: CaptureEventInput): void {
  const c = getClient();
  if (!c) return;
  const distinctId = input.distinctId ?? activeHandle ?? "anonymous-scan";
  c.capture({
    distinctId,
    event: input.name,
    properties: {
      ...input.properties,
      scan_id: activeScanId,
      handle: activeHandle,
    },
  });
}

export interface CaptureLlmInput {
  /** Trace id — group related calls (e.g. all calls in one stage). */
  traceId?: string;
  /** Span id within a trace. */
  spanId?: string;
  /** Human-readable span label (e.g. "judge:owner/repo"). */
  spanName?: string;
  /** Logical parent (e.g. trace id). */
  parentId?: string;
  /** Provider slug (e.g. "openrouter", "openrouter:gemini", "anthropic"). */
  provider: string;
  /** Model identifier sent to the provider. */
  model: string;
  /** Stringified or structured chat input. */
  input: unknown;
  /** Stringified or structured chat output. */
  output: unknown;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  isError?: boolean;
  error?: string;
  httpStatus?: number;
  baseUrl?: string;
  /** Override distinct id (defaults to bound handle). */
  distinctId?: string;
}

/**
 * Send a `$ai_generation` event in the PostHog LLM analytics shape.
 * One event per LLM call. Computes cost from our static pricing
 * table so the LLM-analytics dashboard shows $/scan and $/model
 * out of the box, and feeds the per-scan aggregator that emits
 * `scan cost summary` at the end of the run.
 */
export function captureLlm(input: CaptureLlmInput): void {
  const cost = costForCall({
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  });

  // Always feed the aggregator (even when PostHog isn't configured)
  // so the trace.json packet still carries the cost summary.
  activeAggregator?.record({
    model: input.model,
    spanName: input.spanName,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    latencyMs: input.latencyMs,
    cost,
    isError: !!input.isError,
  });

  const c = getClient();
  if (!c) return;
  const distinctId = input.distinctId ?? activeHandle ?? "anonymous-scan";
  c.capture({
    distinctId,
    event: "$ai_generation",
    properties: {
      $ai_trace_id: input.traceId ?? activeScanId,
      $ai_span_id: input.spanId,
      $ai_span_name: input.spanName,
      $ai_parent_id: input.parentId,
      $ai_provider: input.provider,
      $ai_model: input.model,
      $ai_input: input.input,
      $ai_output_choices: input.output,
      $ai_input_tokens: input.inputTokens ?? 0,
      $ai_output_tokens: input.outputTokens ?? 0,
      $ai_input_cost_usd: cost.inputUsd,
      $ai_output_cost_usd: cost.outputUsd,
      $ai_total_cost_usd: cost.totalUsd,
      $ai_latency: input.latencyMs / 1000,
      $ai_is_error: input.isError ?? false,
      ...(input.error ? { $ai_error: input.error } : {}),
      ...(input.httpStatus ? { $ai_http_status: input.httpStatus } : {}),
      ...(input.baseUrl ? { $ai_base_url: input.baseUrl } : {}),
      // Custom properties — surface in PostHog filters / breakdowns.
      model_display_name: displayNameForModel(input.model),
      model_category: categoryForModel(input.model),
      stage: stageFromSpan(input.spanName),
      per_call_surcharge_usd: cost.perCallUsd,
      scan_id: activeScanId,
      handle: activeHandle,
    },
  });
}

/** Stage prefix from span label (e.g. "judge:owner/repo" → "judge"). */
function stageFromSpan(spanName?: string): string {
  if (!spanName) return "unknown";
  const idx = spanName.indexOf(":");
  return idx === -1 ? spanName : spanName.slice(0, idx);
}

// ─── Per-scan cost aggregator + summary event ────────────────────

interface ModelStats {
  model: string;
  display_name: string;
  category: string;
  calls: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  total_latency_ms: number;
  cost_usd: number;
}

interface StageStats {
  stage: string;
  calls: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  total_latency_ms: number;
}

export interface ScanCostSummary {
  scan_id: string;
  handle: string;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_calls: number;
  total_errors: number;
  total_latency_ms: number;
  by_model: Array<ModelStats & { avg_latency_ms: number; error_rate: number }>;
  by_stage: Array<StageStats & { avg_cost_per_call_usd: number }>;
  /** USD-cost of the most-expensive single call (canary for runaway prompts). */
  max_single_call_cost_usd: number;
  /** Wall-clock between bind and emit. Useful for "$/minute" sanity checks. */
  duration_ms: number;
}

class ScanCostAggregator {
  private byModel = new Map<string, ModelStats>();
  private byStage = new Map<string, StageStats>();
  private maxSingleCallCost = 0;
  private startedAt = Date.now();

  constructor(
    private readonly scanId: string,
    private readonly handle: string,
  ) {}

  record(call: {
    model: string;
    spanName?: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    cost: ReturnType<typeof costForCall>;
    isError: boolean;
  }): void {
    if (call.cost.totalUsd > this.maxSingleCallCost) {
      this.maxSingleCallCost = call.cost.totalUsd;
    }

    const m = this.byModel.get(call.model) ?? {
      model: call.model,
      display_name: displayNameForModel(call.model),
      category: categoryForModel(call.model),
      calls: 0,
      errors: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_latency_ms: 0,
      cost_usd: 0,
    };
    m.calls += 1;
    if (call.isError) m.errors += 1;
    m.input_tokens += call.inputTokens;
    m.output_tokens += call.outputTokens;
    m.total_latency_ms += call.latencyMs;
    m.cost_usd += call.cost.totalUsd;
    this.byModel.set(call.model, m);

    const stage = stageFromSpan(call.spanName);
    const s = this.byStage.get(stage) ?? {
      stage,
      calls: 0,
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_latency_ms: 0,
    };
    s.calls += 1;
    s.cost_usd += call.cost.totalUsd;
    s.input_tokens += call.inputTokens;
    s.output_tokens += call.outputTokens;
    s.total_latency_ms += call.latencyMs;
    this.byStage.set(stage, s);
  }

  summary(): ScanCostSummary {
    const byModelEntries = Array.from(this.byModel.values()).map((m) => ({
      ...m,
      avg_latency_ms: m.calls > 0 ? Math.round(m.total_latency_ms / m.calls) : 0,
      error_rate: m.calls > 0 ? m.errors / m.calls : 0,
    }));
    byModelEntries.sort((a, b) => b.cost_usd - a.cost_usd);

    const byStageEntries = Array.from(this.byStage.values()).map((s) => ({
      ...s,
      avg_cost_per_call_usd: s.calls > 0 ? s.cost_usd / s.calls : 0,
    }));
    byStageEntries.sort((a, b) => b.cost_usd - a.cost_usd);

    const totals = byModelEntries.reduce(
      (acc, m) => {
        acc.total_cost_usd += m.cost_usd;
        acc.total_input_tokens += m.input_tokens;
        acc.total_output_tokens += m.output_tokens;
        acc.total_calls += m.calls;
        acc.total_errors += m.errors;
        acc.total_latency_ms += m.total_latency_ms;
        return acc;
      },
      {
        total_cost_usd: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_calls: 0,
        total_errors: 0,
        total_latency_ms: 0,
      },
    );

    return {
      scan_id: this.scanId,
      handle: this.handle,
      ...totals,
      by_model: byModelEntries,
      by_stage: byStageEntries,
      max_single_call_cost_usd: this.maxSingleCallCost,
      duration_ms: Date.now() - this.startedAt,
    };
  }
}

/**
 * Emit the per-scan cost summary as a `scan cost summary` event.
 * Called from the pipeline's finally block before flushPostHog.
 * Returns the summary object so it can also be embedded in the
 * persisted trace.json packet.
 */
export function emitScanCostSummary(): ScanCostSummary | null {
  if (!activeAggregator) return null;
  const summary = activeAggregator.summary();
  const c = getClient();
  if (c) {
    const distinctId = activeHandle ?? "anonymous-scan";
    c.capture({
      distinctId,
      event: "scan cost summary",
      properties: {
        ...summary,
        // Round helpers for cleaner dashboard tooltips.
        total_cost_usd_rounded: Math.round(summary.total_cost_usd * 10000) / 10000,
        avg_call_latency_ms:
          summary.total_calls > 0
            ? Math.round(summary.total_latency_ms / summary.total_calls)
            : 0,
        error_rate:
          summary.total_calls > 0 ? summary.total_errors / summary.total_calls : 0,
      },
    });
  }
  return summary;
}

/**
 * Flush queued events. Call before the worker exits so anything still
 * batched leaves the box. Safe to call when the client isn't
 * configured (no-op).
 */
export async function flushPostHog(): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.shutdown();
  } catch {
    // Best-effort flush — never let observability take down the worker.
  }
}
