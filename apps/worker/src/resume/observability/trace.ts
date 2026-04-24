/**
 * ScanTrace — per-scan forensic packet.
 *
 * Philosophy: when a scan's output disappoints, the ONLY way to know
 * why is to replay exactly what each stage saw and emitted. This
 * module captures that as a single JSON blob per scan, persisted to
 * R2 at `debug/{scanId}/trace.json`.
 *
 * Design principles:
 *   - Zero dependencies. Just an in-memory accumulator.
 *   - Every instrumented call pushes one TraceEvent. Latency + outcome
 *     + a bounded snapshot of the I/O lives in the event.
 *   - Lossy by design — we truncate long strings (prompts, fetched
 *     HTML) so the packet stays readable. Untruncated artifacts go to
 *     their own R2 keys if we need them.
 *   - No LLM-call PII. We store prompts verbatim because they're
 *     about the user we're scanning, and the user is who'll read
 *     the trace. No secret keys ever.
 *   - Graceful: if R2 env isn't set, the trace is still collected
 *     in memory and returned; persist is a no-op.
 *
 * How to read a trace:
 *   bun apps/worker/scripts/audit-trace.ts <scanId>
 */

import type { Resume } from "@gitshow/shared/resume";

// ─── Event taxonomy ──────────────────────────────────────────────────

export type TraceEventKind =
  | "stage.start"
  | "stage.end"
  | "tinyfish.search"
  | "tinyfish.fetch"
  | "linkedin.fetch"
  | "llm.call"
  | "note"
  | "evaluator";

/**
 * Bounded string — anything longer gets truncated with a marker.
 * Truncation is loud (ends with `…[N bytes truncated]`) so humans
 * reading the trace never confuse thin output with truncated output.
 */
function bound(s: string | undefined | null, max = 2000): string | undefined {
  if (s == null) return undefined;
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[${s.length - max} bytes truncated]`;
}

// ─── Concrete event shapes ───────────────────────────────────────────

export interface TraceEventBase {
  /** epoch ms */
  t: number;
  kind: TraceEventKind;
  /** Monotonically-increasing sequence for stable ordering */
  seq: number;
  /** Human label, usually the stage or tool name */
  label?: string;
}

export interface StageStartEvent extends TraceEventBase {
  kind: "stage.start";
  label: string;
}
export interface StageEndEvent extends TraceEventBase {
  kind: "stage.end";
  label: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}
export interface TinyFishSearchEvent extends TraceEventBase {
  kind: "tinyfish.search";
  query: string;
  location?: string;
  language?: string;
  ok: boolean;
  resultCount: number;
  durationMs: number;
  status?: number;
  error?: string;
  /** Top 3 results (title + url + snippet) so we can see what surfaced. */
  topResults?: Array<{ title: string; url: string; snippet?: string }>;
}
export interface TinyFishFetchEvent extends TraceEventBase {
  kind: "tinyfish.fetch";
  urls: string[];
  ok: boolean;
  durationMs: number;
  /** Per-URL outcome so we can see exactly which fetches walled / failed. */
  perUrl: Array<{
    url: string;
    finalUrl?: string;
    title?: string;
    textChars: number;
    language?: string;
    error?: string;
  }>;
  requestError?: string;
}
export interface LinkedInFetchEvent extends TraceEventBase {
  kind: "linkedin.fetch";
  url: string;
  tier: "tinyfish" | "jina" | "skipped";
  ok: boolean;
  textChars?: number;
  title?: string;
  reason?: string;
  durationMs: number;
}
export interface LLMCallEvent extends TraceEventBase {
  kind: "llm.call";
  /** Agent/stage label: "resume:work", "dev-evidence:plan", etc. */
  label: string;
  model: string;
  /** System prompt (truncated). */
  systemPrompt?: string;
  /** User input (truncated). */
  input?: string;
  /** What the model submitted (truncated JSON string). */
  output?: string;
  ok: boolean;
  error?: string;
  /** Total elapsed wall clock. */
  durationMs: number;
  /** From OpenRouter usage tracking. */
  inputTokens?: number;
  outputTokens?: number;
  /** USD. */
  cost?: number;
  toolCalls?: number;
}
export interface NoteEvent extends TraceEventBase {
  kind: "note";
  label: string;
  message: string;
  /** Arbitrary structured payload for one-off diagnostics. */
  data?: Record<string, unknown>;
}
export interface EvaluatorEvent extends TraceEventBase {
  kind: "evaluator";
  pass: boolean;
  issueCount: number;
  issues: Array<{
    section: string;
    severity: string;
    message: string;
  }>;
}

export type TraceEvent =
  | StageStartEvent
  | StageEndEvent
  | TinyFishSearchEvent
  | TinyFishFetchEvent
  | LinkedInFetchEvent
  | LLMCallEvent
  | NoteEvent
  | EvaluatorEvent;

// ─── The accumulator ─────────────────────────────────────────────────

export interface ScanTraceMeta {
  scanId: string;
  handle: string;
  model: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  /** Pipeline version / git SHA (for "was this scan run on the fixed code?"). */
  worker: { version: string; sha?: string };
}

export interface FinalizedTrace {
  meta: ScanTraceMeta;
  resume?: {
    work: number;
    education: number;
    projects: number;
    skills: number;
    buildLog: number;
    blog: number;
    personSummaryLen: number;
  };
  /** Rolled-up totals for at-a-glance triage. */
  summary: {
    tinyfishSearches: number;
    tinyfishSearchesOk: number;
    tinyfishFetches: number;
    tinyfishFetchesOk: number;
    llmCalls: number;
    totalLlmCostUsd: number;
    stages: Array<{ label: string; durationMs: number; ok: boolean }>;
  };
  events: TraceEvent[];
}

export class ScanTrace {
  private _events: TraceEvent[] = [];
  private _seq = 0;
  private _meta: ScanTraceMeta;

  constructor(meta: Omit<ScanTraceMeta, "startedAt"> & Partial<Pick<ScanTraceMeta, "startedAt">>) {
    this._meta = {
      ...meta,
      startedAt: meta.startedAt ?? Date.now(),
    };
  }

  get scanId(): string {
    return this._meta.scanId;
  }

  /** Low-level: takes a fully-typed variant and stamps on seq + t. */
  private push<T extends TraceEvent>(e: Omit<T, "seq" | "t">): void {
    this._events.push({ ...e, t: Date.now(), seq: this._seq++ } as T);
  }

  stageStart(label: string): void {
    this.push<StageStartEvent>({ kind: "stage.start", label });
  }

  stageEnd(label: string, durationMs: number, ok: boolean, error?: string): void {
    this.push<StageEndEvent>({ kind: "stage.end", label, durationMs, ok, error });
  }

  tinyfishSearch(e: Omit<TinyFishSearchEvent, "kind" | "seq" | "t">): void {
    this.push<TinyFishSearchEvent>({ kind: "tinyfish.search", ...e });
  }

  tinyfishFetch(e: Omit<TinyFishFetchEvent, "kind" | "seq" | "t">): void {
    this.push<TinyFishFetchEvent>({ kind: "tinyfish.fetch", ...e });
  }

  linkedInFetch(e: Omit<LinkedInFetchEvent, "kind" | "seq" | "t">): void {
    this.push<LinkedInFetchEvent>({ kind: "linkedin.fetch", ...e });
  }

  llmCall(e: Omit<LLMCallEvent, "kind" | "seq" | "t">): void {
    // Truncate long strings so the trace stays readable.
    this.push<LLMCallEvent>({
      kind: "llm.call",
      ...e,
      systemPrompt: bound(e.systemPrompt, 4000),
      input: bound(e.input, 6000),
      output: bound(e.output, 4000),
    });
  }

  note(label: string, message: string, data?: Record<string, unknown>): void {
    this.push<NoteEvent>({ kind: "note", label, message, data });
  }

  evaluator(e: Omit<EvaluatorEvent, "kind" | "seq" | "t">): void {
    this.push<EvaluatorEvent>({ kind: "evaluator", ...e });
  }

  /** Call once at the end to produce the persisted shape. */
  finalize(resume?: Resume): FinalizedTrace {
    const finishedAt = Date.now();
    this._meta.finishedAt = finishedAt;
    this._meta.durationMs = finishedAt - this._meta.startedAt;

    let searches = 0, searchesOk = 0, fetches = 0, fetchesOk = 0;
    let llmCalls = 0, totalLlmCostUsd = 0;
    const stages: Array<{ label: string; durationMs: number; ok: boolean }> = [];
    for (const e of this._events) {
      if (e.kind === "tinyfish.search") {
        searches++;
        if (e.ok) searchesOk++;
      } else if (e.kind === "tinyfish.fetch") {
        fetches += e.urls.length;
        fetchesOk += e.perUrl.filter((p) => !p.error && p.textChars > 0).length;
      } else if (e.kind === "llm.call") {
        llmCalls++;
        if (e.cost) totalLlmCostUsd += e.cost;
      } else if (e.kind === "stage.end") {
        stages.push({ label: e.label, durationMs: e.durationMs, ok: e.ok });
      }
    }

    return {
      meta: this._meta,
      resume: resume
        ? {
            work: resume.work.length,
            education: resume.education.length,
            projects: resume.projects.length,
            skills: resume.skills.length,
            buildLog: resume.buildLog.length,
            blog: resume.blog.length,
            personSummaryLen: resume.person?.summary?.length ?? 0,
          }
        : undefined,
      summary: {
        tinyfishSearches: searches,
        tinyfishSearchesOk: searchesOk,
        tinyfishFetches: fetches,
        tinyfishFetchesOk: fetchesOk,
        llmCalls,
        totalLlmCostUsd: Number(totalLlmCostUsd.toFixed(4)),
        stages,
      },
      events: this._events,
    };
  }
}

/**
 * R2 key convention for debug packets.
 */
export function traceR2Key(scanId: string): string {
  return `debug/${scanId}/trace.json`;
}
