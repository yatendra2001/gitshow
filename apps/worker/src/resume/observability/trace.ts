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
  | "stage.resource"
  | "tinyfish.search"
  | "tinyfish.fetch"
  | "linkedin.fetch"
  | "linkedin.tier.attempt"
  | "linkedin.facts.emitted"
  | "fetcher.start"
  | "fetcher.facts"
  | "fetcher.error"
  | "fetcher.end"
  | "github.api.call"
  | "inventory.clone"
  | "judge.verdict"
  | "kg.merger.deterministic"
  | "kg.merger.llm"
  | "kg.edge.resolved"
  | "kg.evaluator"
  | "media.download"
  | "media.banner.generated"
  | "render.select"
  | "render.hero-prose.call"
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
export interface StageResourceEvent extends TraceEventBase {
  kind: "stage.resource";
  label: string;
  memoryMB?: number;
  heapUsedMB?: number;
  diskMB?: number;
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
export interface LinkedInTierAttemptEvent extends TraceEventBase {
  kind: "linkedin.tier.attempt";
  /**
   * 0 = ProxyCurl/EnrichLayer (paid API, canonical JSON)
   * 1 = TinyFish (proxy-rotating headless)
   * 2 = Jina Reader (markdown of public page)
   * 3 = (retired — was Playwright Googlebot UA)
   * 4 = uploaded PDF salvage
   */
  tier: 0 | 1 | 2 | 3 | 4;
  method: "proxycurl" | "tinyfish" | "jina" | "pdf";
  ok: boolean;
  durationMs: number;
  reason?: string;
}
export interface LinkedInFactsEmittedEvent extends TraceEventBase {
  kind: "linkedin.facts.emitted";
  tier: number;
  positions: number;
  educations: number;
  skills: number;
}

export interface FetcherStartEvent extends TraceEventBase {
  kind: "fetcher.start";
  label: string;
  input?: Record<string, unknown>;
}
export interface FetcherFactsEvent extends TraceEventBase {
  kind: "fetcher.facts";
  label: string;
  /** Edge type or "PERSON" — what kind of fact landed. */
  entityType: string;
  count: number;
  /** Up to 5 fact previews, JSON-stringified + truncated. */
  preview?: string;
}
export interface FetcherErrorEvent extends TraceEventBase {
  kind: "fetcher.error";
  label: string;
  error: string;
  stack?: string;
  retryable: boolean;
}
export interface FetcherEndEvent extends TraceEventBase {
  kind: "fetcher.end";
  label: string;
  durationMs: number;
  factsEmitted: number;
  status: "ok" | "empty" | "error";
}

export interface GithubApiCallEvent extends TraceEventBase {
  kind: "github.api.call";
  endpoint: string;
  status: number;
  rateLimitRemaining?: number;
  durationMs: number;
}
export interface InventoryCloneEvent extends TraceEventBase {
  kind: "inventory.clone";
  repo: string;
  sizeBytes?: number;
  durationMs: number;
  filesDiscovered?: number;
  ok: boolean;
  error?: string;
}

export interface JudgeVerdictEvent extends TraceEventBase {
  kind: "judge.verdict";
  repo: string;
  judgeKind: string; // ProjectKind
  shouldFeature: boolean;
  reason: string;
  filesRead: number;
}

export interface KgMergerDeterministicEvent extends TraceEventBase {
  kind: "kg.merger.deterministic";
  mergedPairs: number;
  retainedPairs: number;
}
export interface KgMergerLlmEvent extends TraceEventBase {
  kind: "kg.merger.llm";
  pairCount: number;
  decisions: Array<{ a: string; b: string; decision: string; rationale: string }>;
}
export interface KgEdgeResolvedEvent extends TraceEventBase {
  kind: "kg.edge.resolved";
  edgeId: string;
  edgeType: string;
  sourceCount: number;
  band: string;
}
export interface KgEvaluatorEvent extends TraceEventBase {
  kind: "kg.evaluator";
  blockingErrors: number;
  warnings: number;
  details: Array<{ section: string; severity: string; message: string }>;
}

export interface MediaDownloadEvent extends TraceEventBase {
  kind: "media.download";
  /** "project-hero" | "company-logo" | "school-logo" — kept generic */
  mediaKind: string;
  url: string;
  ok: boolean;
  r2Key?: string;
  bytes?: number;
  origin?: string;
  durationMs: number;
  error?: string;
}
export interface MediaBannerGeneratedEvent extends TraceEventBase {
  kind: "media.banner.generated";
  projectId: string;
  model: string;
  ok: boolean;
  durationMs: number;
  r2Key?: string;
  costUsd?: number;
  rejectionReason?: string;
}

export interface RenderSelectEvent extends TraceEventBase {
  kind: "render.select";
  section: string;
  entityCount: number;
  filter?: string;
}
export interface RenderHeroProseCallEvent extends TraceEventBase {
  kind: "render.hero-prose.call";
  model: string;
  durationMs: number;
  linksEmbedded: number;
  ok: boolean;
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
  | StageResourceEvent
  | TinyFishSearchEvent
  | TinyFishFetchEvent
  | LinkedInFetchEvent
  | LinkedInTierAttemptEvent
  | LinkedInFactsEmittedEvent
  | FetcherStartEvent
  | FetcherFactsEvent
  | FetcherErrorEvent
  | FetcherEndEvent
  | GithubApiCallEvent
  | InventoryCloneEvent
  | JudgeVerdictEvent
  | KgMergerDeterministicEvent
  | KgMergerLlmEvent
  | KgEdgeResolvedEvent
  | KgEvaluatorEvent
  | MediaDownloadEvent
  | MediaBannerGeneratedEvent
  | RenderSelectEvent
  | RenderHeroProseCallEvent
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
    hackathons: number;
    publications: number;
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
    fetcherFactsTotal: number;
    fetcherErrors: number;
    judgeVerdicts: number;
    judgeFeatured: number;
    mediaDownloadsOk: number;
    mediaDownloadsFail: number;
    bannersGenerated: number;
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

  stageResource(e: Omit<StageResourceEvent, "kind" | "seq" | "t">): void {
    this.push<StageResourceEvent>({ kind: "stage.resource", ...e });
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

  linkedInTierAttempt(e: Omit<LinkedInTierAttemptEvent, "kind" | "seq" | "t">): void {
    this.push<LinkedInTierAttemptEvent>({ kind: "linkedin.tier.attempt", ...e });
  }

  linkedInFactsEmitted(e: Omit<LinkedInFactsEmittedEvent, "kind" | "seq" | "t">): void {
    this.push<LinkedInFactsEmittedEvent>({ kind: "linkedin.facts.emitted", ...e });
  }

  fetcherStart(e: Omit<FetcherStartEvent, "kind" | "seq" | "t">): void {
    this.push<FetcherStartEvent>({ kind: "fetcher.start", ...e });
  }
  fetcherFacts(e: Omit<FetcherFactsEvent, "kind" | "seq" | "t">): void {
    this.push<FetcherFactsEvent>({
      kind: "fetcher.facts",
      ...e,
      preview: bound(e.preview, 1500),
    });
  }
  fetcherError(e: Omit<FetcherErrorEvent, "kind" | "seq" | "t">): void {
    this.push<FetcherErrorEvent>({
      kind: "fetcher.error",
      ...e,
      stack: bound(e.stack, 4000),
    });
  }
  fetcherEnd(e: Omit<FetcherEndEvent, "kind" | "seq" | "t">): void {
    this.push<FetcherEndEvent>({ kind: "fetcher.end", ...e });
  }

  githubApiCall(e: Omit<GithubApiCallEvent, "kind" | "seq" | "t">): void {
    this.push<GithubApiCallEvent>({ kind: "github.api.call", ...e });
  }
  inventoryClone(e: Omit<InventoryCloneEvent, "kind" | "seq" | "t">): void {
    this.push<InventoryCloneEvent>({ kind: "inventory.clone", ...e });
  }

  judgeVerdict(e: Omit<JudgeVerdictEvent, "kind" | "seq" | "t">): void {
    this.push<JudgeVerdictEvent>({ kind: "judge.verdict", ...e });
  }

  kgMergerDeterministic(e: Omit<KgMergerDeterministicEvent, "kind" | "seq" | "t">): void {
    this.push<KgMergerDeterministicEvent>({ kind: "kg.merger.deterministic", ...e });
  }
  kgMergerLlm(e: Omit<KgMergerLlmEvent, "kind" | "seq" | "t">): void {
    this.push<KgMergerLlmEvent>({ kind: "kg.merger.llm", ...e });
  }
  kgEdgeResolved(e: Omit<KgEdgeResolvedEvent, "kind" | "seq" | "t">): void {
    this.push<KgEdgeResolvedEvent>({ kind: "kg.edge.resolved", ...e });
  }
  kgEvaluator(e: Omit<KgEvaluatorEvent, "kind" | "seq" | "t">): void {
    this.push<KgEvaluatorEvent>({ kind: "kg.evaluator", ...e });
  }

  mediaDownload(e: Omit<MediaDownloadEvent, "kind" | "seq" | "t">): void {
    this.push<MediaDownloadEvent>({ kind: "media.download", ...e });
  }
  mediaBannerGenerated(e: Omit<MediaBannerGeneratedEvent, "kind" | "seq" | "t">): void {
    this.push<MediaBannerGeneratedEvent>({ kind: "media.banner.generated", ...e });
  }

  renderSelect(e: Omit<RenderSelectEvent, "kind" | "seq" | "t">): void {
    this.push<RenderSelectEvent>({ kind: "render.select", ...e });
  }
  renderHeroProseCall(e: Omit<RenderHeroProseCallEvent, "kind" | "seq" | "t">): void {
    this.push<RenderHeroProseCallEvent>({ kind: "render.hero-prose.call", ...e });
  }

  llmCall(e: Omit<LLMCallEvent, "kind" | "seq" | "t">): void {
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

    let searches = 0,
      searchesOk = 0,
      fetches = 0,
      fetchesOk = 0;
    let llmCalls = 0,
      totalLlmCostUsd = 0;
    let fetcherFactsTotal = 0,
      fetcherErrors = 0,
      judgeVerdicts = 0,
      judgeFeatured = 0;
    let mediaDownloadsOk = 0,
      mediaDownloadsFail = 0,
      bannersGenerated = 0;
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
      } else if (e.kind === "fetcher.facts") {
        fetcherFactsTotal += e.count;
      } else if (e.kind === "fetcher.error") {
        fetcherErrors++;
      } else if (e.kind === "judge.verdict") {
        judgeVerdicts++;
        if (e.shouldFeature) judgeFeatured++;
      } else if (e.kind === "media.download") {
        if (e.ok) mediaDownloadsOk++;
        else mediaDownloadsFail++;
      } else if (e.kind === "media.banner.generated") {
        if (e.ok) bannersGenerated++;
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
            hackathons: resume.hackathons?.length ?? 0,
            publications: resume.publications?.length ?? 0,
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
        fetcherFactsTotal,
        fetcherErrors,
        judgeVerdicts,
        judgeFeatured,
        mediaDownloadsOk,
        mediaDownloadsFail,
        bannersGenerated,
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
