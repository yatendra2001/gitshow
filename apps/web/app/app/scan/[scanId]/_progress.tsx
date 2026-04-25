"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, AlertTriangle, Circle } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Reasoning } from "@/components/ai-elements/reasoning";
import { Tool, type ToolStatus } from "@/components/ai-elements/tool";
import {
  AccessStateCard,
  type AccessState,
  type DataSources,
} from "@/components/scan/access-state-card";
import { cn } from "@/lib/utils";

/**
 * Live scan progress viewer.
 *
 * Polls `/api/scan/status/{scanId}` every 2s while the scan is running.
 * The body is a vertical phase timeline: each phase is a row with its
 * own status dot + copy. The running phase shimmers; done phases tick
 * with a duration; pending phases sit muted with an empty circle.
 * `fetchers` expands to the parallel sub-fetchers nested
 * underneath.
 */

interface ScanState {
  id: string;
  handle: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  current_phase: string | null;
  last_completed_phase: string | null;
  error: string | null;
  cost_usd: number;
  llm_calls: number;
  last_heartbeat: number | null;
  created_at: number;
  completed_at: number | null;
  access_state: AccessState | null;
  data_sources: DataSources | null;
}

interface EventRow {
  id: number;
  kind: string;
  stage: string | null;
  /** Agent label for reasoning/tool events: "judge:owner/repo", "kg:pair-resolve", etc. */
  worker: string | null;
  status: string | null;
  duration_ms: number | null;
  message: string | null;
  data_json: string | null;
  parent_id: string | null;
  message_id: string | null;
  at: number;
}

/** One streaming reasoning block emitted by an agent. */
interface ReasoningTrace {
  reasoningId: string;
  text: string;
  startedAt: number;
  endedAt: number | null;
}

/** One tool invocation emitted by an agent. */
interface ToolTrace {
  toolId: string;
  toolName: string;
  displayLabel: string;
  status: ToolStatus;
  startedAt: number;
  durationMs: number | null;
  inputPreview?: string;
  outputPreview?: string;
  errorMessage?: string;
}

/** One agent run inside a phase — collects all reasoning + tool calls. */
interface AgentRun {
  agent: string;
  reasonings: ReasoningTrace[];
  tools: ToolTrace[];
  hasActivity: boolean;
}

const POLL_MS = 2000;

const PHASE_COPY: Record<string, string> = {
  "github-fetch": "Reading your GitHub",
  "repo-filter": "Picking which repos matter",
  inventory: "Studying your top repos",
  "repo-judge": "Spotting what's distinctive",
  fetchers: "Gathering context from across the web",
  merge: "Organising the pieces",
  media: "Finding cover images",
  "persist-kg": "Saving the picture",
  "evaluate-kg": "Double-checking everything",
  "hero-prose": "Writing your hero + about",
  render: "Crafting your portfolio sections",
  "persist-resume": "Saving your draft",
  "persist-trace": "Wrapping up",
  // Sub-phases under fetchers — shown as children of that row.
  "fetch:linkedin": "Reading your LinkedIn",
  "fetch:personal-site": "Reading your personal site",
  "fetch:twitter": "Reading your Twitter bio",
  "fetch:hn": "Checking Hacker News",
  "fetch:devto": "Checking dev.to",
  "fetch:medium": "Checking Medium",
  "fetch:orcid": "Looking up your ORCID",
  "fetch:semantic-scholar": "Searching Semantic Scholar",
  "fetch:arxiv": "Searching arXiv",
  "fetch:stackoverflow": "Reading your Stack Overflow",
  "blog-import": "Importing your blog posts",
};

/**
 * Ordered top-level phases. `fetchers` is a bucket for the parallel
 * sub-fetchers (linkedin, hn, devto, blog-import, etc.) which we render
 * as children rather than as their own rows in the outer timeline.
 */
const PHASE_ORDER = [
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
];

const SECTION_AGENT_CHILDREN = [
  "fetch:linkedin",
  "fetch:personal-site",
  "fetch:twitter",
  "fetch:hn",
  "fetch:devto",
  "fetch:medium",
  "fetch:orcid",
  "fetch:semantic-scholar",
  "fetch:arxiv",
  "fetch:stackoverflow",
  "blog-import",
];

type NodeStatus = "pending" | "running" | "done" | "failed";

interface PhaseNode {
  id: string;
  title: string;
  status: NodeStatus;
  startedAt: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  children?: PhaseNode[];
  /** Agent runs that landed in this phase (Judge per repo, hero-prose, etc.). */
  agents?: AgentRun[];
}

/**
 * Map an agent label (events.worker) to the phase it runs under.
 * Anything not matched here floats up to the closest containing phase
 * via the catch-all in agentToPhase().
 */
const AGENT_TO_PHASE: Array<{ match: (a: string) => boolean; phase: string }> = [
  { match: (a) => a.startsWith("judge:"), phase: "repo-judge" },
  { match: (a) => a === "kg:pair-resolve", phase: "merge" },
  { match: (a) => a.startsWith("render:hero-prose"), phase: "hero-prose" },
  { match: (a) => a === "resume:blog-import" || a.startsWith("resume:blog-import:"), phase: "blog-import" },
];

function agentToPhase(agent: string): string | null {
  for (const m of AGENT_TO_PHASE) if (m.match(agent)) return m.phase;
  return null;
}

/**
 * Build per-phase agent activity from raw events. We bucket by
 * `worker` (agent label) and reconstruct reasoning blocks (one per
 * reasoning_id) and tool calls (one per tool_id). The output is a
 * flat list of AgentRun per phase that the UI renders below the
 * phase title.
 */
function buildAgentActivity(events: EventRow[], now: number): Map<string, AgentRun[]> {
  const byAgent = new Map<string, AgentRun>();

  const safeJson = (raw: string | null): Record<string, unknown> | null => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  for (const ev of events) {
    const agent = ev.worker;
    if (!agent) continue;
    let run = byAgent.get(agent);
    if (!run) {
      run = { agent, reasonings: [], tools: [], hasActivity: false };
      byAgent.set(agent, run);
    }
    if (ev.kind === "reasoning-delta") {
      const rid = ev.parent_id ?? `rsn:${ev.id}`;
      let block = run.reasonings.find((b) => b.reasoningId === rid);
      if (!block) {
        block = { reasoningId: rid, text: "", startedAt: ev.at, endedAt: null };
        run.reasonings.push(block);
      }
      if (ev.message) block.text += ev.message;
      run.hasActivity = true;
    } else if (ev.kind === "reasoning-end") {
      const rid = ev.parent_id ?? "";
      const block = run.reasonings.find((b) => b.reasoningId === rid);
      if (block) {
        block.endedAt = ev.at;
      }
    } else if (ev.kind === "tool-start") {
      const data = safeJson(ev.data_json);
      const toolId = (data?.tool_id as string | undefined) ?? `t:${ev.id}`;
      const toolName = (data?.tool_name as string | undefined) ?? "tool";
      const inputPreview = (data?.input_preview as string | undefined) ?? undefined;
      run.tools.push({
        toolId,
        toolName,
        displayLabel: ev.message ?? toolName,
        status: "running",
        startedAt: ev.at,
        durationMs: null,
        inputPreview,
      });
      run.hasActivity = true;
    } else if (ev.kind === "tool-end") {
      const data = safeJson(ev.data_json);
      const toolId = (data?.tool_id as string | undefined) ?? "";
      const tool = run.tools.find((t) => t.toolId === toolId);
      const outputPreview = (data?.output_preview as string | undefined) ?? undefined;
      if (tool) {
        tool.status = ev.status === "ok" ? "completed" : ev.status === "err" ? "error" : "completed";
        tool.durationMs = ev.duration_ms ?? null;
        tool.outputPreview = outputPreview;
        if (ev.status === "err") tool.errorMessage = ev.message ?? "Tool failed";
      }
    }
  }

  // Stamp running durations on still-open tool calls so the UI can show elapsed.
  for (const run of byAgent.values()) {
    for (const t of run.tools) {
      if (t.status === "running" && t.durationMs == null) {
        t.durationMs = Math.max(0, now - t.startedAt);
      }
    }
  }

  // Group runs by phase, keeping insertion order so the UI renders
  // judge:repo-A above judge:repo-B as they arrive.
  const byPhase = new Map<string, AgentRun[]>();
  for (const run of byAgent.values()) {
    const phase = agentToPhase(run.agent);
    if (!phase) continue;
    if (!run.hasActivity) continue;
    const list = byPhase.get(phase) ?? [];
    list.push(run);
    byPhase.set(phase, list);
  }
  return byPhase;
}

function phaseLabel(phase: string | null | undefined): string {
  if (!phase) return "Getting set up";
  if (PHASE_COPY[phase]) return PHASE_COPY[phase]!;
  const parts = phase.split(":");
  return parts[parts.length - 1]!.replace(/[-_]/g, " ");
}

function progressPercent(scan: ScanState): number {
  if (scan.status === "succeeded") return 100;
  if (scan.status === "failed" || scan.status === "cancelled") return 0;
  const current = scan.current_phase ?? scan.last_completed_phase;
  const idx = current ? PHASE_ORDER.indexOf(current) : -1;
  if (idx < 0) {
    // The fetchers stage emits its children as current_phase (fetch:linkedin,
    // fetch:hn, blog-import, etc.) — credit the parent row so the bar
    // doesn't stall during the long parallel block.
    if (SECTION_AGENT_CHILDREN.includes(current ?? "")) {
      const parentIdx = PHASE_ORDER.indexOf("fetchers");
      return Math.min(99, Math.round(((parentIdx + 0.5) / PHASE_ORDER.length) * 100));
    }
    return 4;
  }
  const step = scan.current_phase ? idx + 0.5 : idx + 1;
  return Math.min(99, Math.round((step / PHASE_ORDER.length) * 100));
}

export function ScanProgress({
  scanId,
  initial,
}: {
  scanId: string;
  initial: ScanState;
}) {
  const [scan, setScan] = useState<ScanState>(initial);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [now, setNow] = useState<number>(Date.now());
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const terminal =
    scan.status === "succeeded" ||
    scan.status === "failed" ||
    scan.status === "cancelled";

  const poll = useCallback(async () => {
    try {
      const resp = await fetch(
        `/api/scan/status/${encodeURIComponent(scanId)}`,
        { cache: "no-store" },
      );
      if (!resp.ok) return;
      const data = (await resp.json()) as {
        scan: ScanState;
        events: EventRow[];
      };
      setScan(data.scan);
      setEvents(data.events);
    } catch {
      // Transient — try again next tick.
    }
  }, [scanId]);

  useEffect(() => {
    void poll();
    const tickClock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tickClock);
  }, [poll]);

  useEffect(() => {
    if (terminal) return;
    timerRef.current = setTimeout(() => void poll(), POLL_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [terminal, poll, scan]);

  const elapsedMs = Math.max(
    0,
    (scan.completed_at ?? now) - scan.created_at,
  );
  const elapsed = formatElapsed(elapsedMs);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 py-10 flex flex-col gap-8">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/app"
          className="inline-flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors border border-border/40 rounded-lg pl-1 pr-2 py-1"
          aria-label="Back to dashboard"
        >
          <LogoMark size={18} />
          <span>← /app</span>
        </Link>
        <StatusPill status={scan.status} />
      </header>

      <section className="flex flex-col gap-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
          {scan.status === "running" || scan.status === "queued"
            ? "Working on it"
            : scan.status === "succeeded"
              ? "Done"
              : scan.status === "failed"
                ? "Didn't finish"
                : "Cancelled"}
        </div>
        <h1 className="font-[var(--font-serif)] text-[32px] leading-tight">
          {scan.status === "running" || scan.status === "queued" ? (
            <Shimmer>{titleForStatus(scan)}</Shimmer>
          ) : (
            titleForStatus(scan)
          )}
        </h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
          <span className="font-mono text-foreground">@{scan.handle}</span>
          <span>
            Elapsed <span className="text-foreground font-mono">{elapsed}</span>
          </span>
        </div>
        {scan.status === "running" || scan.status === "queued" ? (
          <ProgressBar percent={progressPercent(scan)} />
        ) : null}
      </section>

      {scan.status === "succeeded" ? (
        <CompletedCta onRefresh={() => router.refresh()} />
      ) : null}

      {scan.status === "failed" ? <FailedCard error={scan.error} /> : null}

      {scan.status === "cancelled" ? <CancelledCard /> : null}

      {scan.access_state || scan.data_sources ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[14px] font-semibold">What we&apos;re reading</h2>
          <AccessStateCard
            accessState={scan.access_state}
            dataSources={scan.data_sources}
          />
        </section>
      ) : null}

      <PhaseTimeline scan={scan} events={events} now={now} />
    </div>
  );
}

// ─── Phase timeline ─────────────────────────────────────────────────

function PhaseTimeline({
  scan,
  events,
  now,
}: {
  scan: ScanState;
  events: EventRow[];
  now: number;
}) {
  const nodes = useMemo(
    () => buildPhaseTree(scan, events, now),
    [scan, events, now],
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">Timeline</h2>
      </div>
      <ol className="relative flex flex-col gap-2">
        {nodes.map((n, i) => (
          <PhaseRow
            key={n.id}
            node={n}
            isLast={i === nodes.length - 1}
            now={now}
          />
        ))}
      </ol>
    </section>
  );
}

function buildPhaseTree(
  scan: ScanState,
  events: EventRow[],
  now: number,
): PhaseNode[] {
  const byStage = new Map<
    string,
    { start?: EventRow; end?: EventRow; error?: EventRow }
  >();
  for (const ev of events) {
    const key = ev.stage;
    if (!key) continue;
    const entry = byStage.get(key) ?? {};
    if (ev.kind === "stage-start") entry.start = ev;
    else if (ev.kind === "stage-end") entry.end = ev;
    else if (ev.kind === "error") entry.error = ev;
    byStage.set(key, entry);
  }

  const activityByPhase = buildAgentActivity(events, now);

  // Anything strictly BEFORE the current phase in the canonical order
  // is implicitly done — even if we don't have its stage-end event in
  // the response (the worker writes them but the API may have trimmed
  // older rows). Without this, the early phases stay grey forever
  // when the rich-event firehose pushes their stage-end out of the
  // window. The pipeline runs sequentially, so this is safe.
  const sectionAgentChildSet = new Set(SECTION_AGENT_CHILDREN);
  const currentIdx = (() => {
    if (!scan.current_phase) return -1;
    if (sectionAgentChildSet.has(scan.current_phase)) {
      return PHASE_ORDER.indexOf("fetchers");
    }
    return PHASE_ORDER.indexOf(scan.current_phase);
  })();

  const resolve = (id: string, considerCurrent: boolean): PhaseNode => {
    const bucket = byStage.get(id);
    const isCurrent = considerCurrent && scan.current_phase === id;
    const isCompletedInScanRow = scan.last_completed_phase === id;
    // If the pipeline has advanced past this phase, it's done — even
    // if we don't have its stage-end row in the response (trimmed by
    // the rich-event firehose during a long phase like repo-judge).
    const phaseIdx = PHASE_ORDER.indexOf(id);
    const isPriorToCurrent =
      considerCurrent &&
      currentIdx > 0 &&
      phaseIdx >= 0 &&
      phaseIdx < currentIdx;

    let status: NodeStatus;
    if (bucket?.error) status = "failed";
    else if (bucket?.end) status = "done";
    else if (bucket?.start || isCurrent) status = "running";
    else if (isCompletedInScanRow) status = "done";
    else if (isPriorToCurrent) status = "done";
    else status = "pending";

    // Once the whole scan is succeeded, any phase that didn't emit its own
    // stage-end (early runs before the reporter was wired, or events
    // trimmed by the 50-row limit) should still display as done.
    if (scan.status === "succeeded") status = "done";

    // Failed at the top of the whole scan — bubble the error onto whichever
    // phase owns it.
    if (
      scan.status === "failed" &&
      scan.current_phase === id &&
      !bucket?.error
    ) {
      status = "failed";
    }

    const startedAt = bucket?.start?.at ?? null;
    let durationMs: number | null = null;
    if (bucket?.end?.duration_ms) durationMs = bucket.end.duration_ms;
    else if (status === "running" && startedAt) durationMs = now - startedAt;

    return {
      id,
      title: phaseLabel(id),
      status,
      startedAt,
      durationMs,
      errorMessage: bucket?.error?.message ?? null,
      children: undefined,
      agents: activityByPhase.get(id),
    };
  };

  return PHASE_ORDER.map((id) => {
    if (id !== "fetchers") return resolve(id, true);

    const children = SECTION_AGENT_CHILDREN.map((cid) => resolve(cid, true));
    const anyChildRunning = children.some((c) => c.status === "running");
    const allChildrenDone =
      children.length > 0 && children.every((c) => c.status === "done");
    const anyChildFailed = children.some((c) => c.status === "failed");

    const bucket = byStage.get("fetchers");
    let status: NodeStatus;
    if (anyChildFailed || bucket?.error) status = "failed";
    else if (bucket?.end || allChildrenDone) status = "done";
    else if (bucket?.start || anyChildRunning || scan.current_phase === "fetchers")
      status = "running";
    else status = "pending";

    const startedAt = bucket?.start?.at ?? null;
    let durationMs: number | null = null;
    if (bucket?.end?.duration_ms) durationMs = bucket.end.duration_ms;
    else if (status === "running" && startedAt) durationMs = now - startedAt;

    return {
      id,
      title: phaseLabel(id),
      status,
      startedAt,
      durationMs,
      errorMessage: bucket?.error?.message ?? null,
      children,
      agents: activityByPhase.get(id),
    };
  });
}

function PhaseRow({
  node,
  isLast,
  now,
}: {
  node: PhaseNode;
  isLast: boolean;
  now: number;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const showChildren =
    hasChildren && (node.status === "running" || node.status === "done" || node.status === "failed");
  const showAgents =
    !!node.agents && node.agents.length > 0 &&
    (node.status === "running" || node.status === "done" || node.status === "failed");

  return (
    <li className="gs-enter relative flex gap-3">
      {!isLast ? (
        <span
          aria-hidden
          className={cn(
            "absolute left-[11px] top-7 bottom-0 w-px",
            node.status === "done"
              ? "bg-emerald-500/30"
              : node.status === "running"
                ? "bg-[var(--primary)]/30"
                : "bg-border/40",
          )}
        />
      ) : null}
      <PhaseDot status={node.status} />
      <div className="flex-1 min-w-0 pb-1">
        <PhaseHeader node={node} now={now} />
        {node.errorMessage ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--destructive)]/90 font-mono bg-[var(--destructive)]/5 border border-[var(--destructive)]/20 rounded-lg p-3 whitespace-pre-wrap break-words">
            {node.errorMessage.slice(0, 800)}
          </p>
        ) : null}
        {showChildren && node.children ? (
          <ol className="mt-3 flex flex-col gap-1.5">
            {node.children.map((c) => (
              <SubPhaseRow key={c.id} node={c} />
            ))}
          </ol>
        ) : null}
        {showAgents && node.agents ? (
          <AgentActivity agents={node.agents} parentRunning={node.status === "running"} />
        ) : null}
      </div>
    </li>
  );
}

/**
 * The per-phase agent panel: streaming reasoning blocks + tool cards.
 * Shows up to two open reasonings at once; older ones collapse but
 * remain visible. For repo-judge we may have 30 runs — render them
 * all but cap each one's text height via the Reasoning component.
 */
function AgentActivity({
  agents,
  parentRunning,
}: {
  agents: AgentRun[];
  parentRunning: boolean;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {agents.map((run) => (
        <AgentRunBlock key={run.agent} run={run} parentRunning={parentRunning} />
      ))}
    </div>
  );
}

function AgentRunBlock({
  run,
  parentRunning,
}: {
  run: AgentRun;
  parentRunning: boolean;
}) {
  const lastReasoning = run.reasonings[run.reasonings.length - 1];
  const stillStreaming = parentRunning && lastReasoning?.endedAt == null;
  const friendly = friendlyAgentLabel(run.agent);
  return (
    <div className="gs-enter flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono text-foreground/80">{friendly}</span>
      </div>
      {lastReasoning && lastReasoning.text.trim().length > 0 ? (
        <Reasoning
          text={lastReasoning.text}
          streaming={stillStreaming}
          elapsedMs={
            lastReasoning.endedAt
              ? lastReasoning.endedAt - lastReasoning.startedAt
              : undefined
          }
          label={friendly}
        />
      ) : null}
      {run.tools.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {run.tools.map((t) => (
            <Tool
              key={t.toolId}
              name={t.toolName}
              status={t.status}
              subtitle={t.displayLabel !== t.toolName ? t.displayLabel : undefined}
              input={t.inputPreview}
              output={t.outputPreview}
              error={t.errorMessage}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function friendlyAgentLabel(agent: string): string {
  if (agent.startsWith("judge:")) {
    return `Judging ${agent.slice("judge:".length)}`;
  }
  if (agent === "kg:pair-resolve") return "Reconciling duplicate companies + schools";
  if (agent.startsWith("render:hero-prose")) return "Writing your About paragraph";
  if (agent === "resume:blog-import" || agent.startsWith("resume:blog-import:"))
    return "Importing a blog post";
  return agent;
}

function PhaseHeader({ node, now }: { node: PhaseNode; now: number }) {
  // Keep the running elapsed lively without re-triggering memo.
  const live =
    node.status === "running" && node.startedAt
      ? now - node.startedAt
      : node.durationMs;

  return (
    <div className="flex items-baseline gap-2">
      <span
        className={cn(
          "text-[14px] font-medium leading-snug",
          node.status === "pending" && "text-muted-foreground/60",
          node.status === "failed" && "text-[var(--destructive)]",
        )}
      >
        {node.status === "running" ? (
          <Shimmer>{node.title}</Shimmer>
        ) : (
          node.title
        )}
      </span>
      {live && live > 100 ? (
        <span
          className={cn(
            "font-mono tabular-nums text-[11px]",
            node.status === "done"
              ? "text-emerald-500/80"
              : node.status === "running"
                ? "text-[var(--primary)]/80"
                : "text-muted-foreground/70",
          )}
        >
          {formatDuration(live)}
        </span>
      ) : null}
    </div>
  );
}

function PhaseDot({ status }: { status: NodeStatus }) {
  if (status === "running") {
    return (
      <span className="relative flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/40">
        <span className="absolute inline-flex size-2 animate-ping rounded-full bg-[var(--primary)] opacity-70" />
        <span className="relative inline-flex size-2 rounded-full bg-[var(--primary)]" />
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-emerald-500/90 text-white">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--destructive)]/90 text-white">
        <AlertTriangle className="size-3" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className="flex size-[22px] shrink-0 items-center justify-center">
      <Circle
        className="size-[14px] text-muted-foreground/30"
        strokeWidth={1.5}
      />
    </span>
  );
}

function SubPhaseRow({ node }: { node: PhaseNode }) {
  return (
    <li className="gs-enter flex items-baseline gap-2.5 pl-1">
      <SubDot status={node.status} />
      <span
        className={cn(
          "text-[12.5px] leading-snug",
          node.status === "pending" && "text-muted-foreground/60",
          node.status === "done" && "text-muted-foreground",
          node.status === "running" && "text-foreground",
          node.status === "failed" && "text-[var(--destructive)]",
        )}
      >
        {node.status === "running" ? (
          <Shimmer>{node.title}</Shimmer>
        ) : (
          node.title
        )}
      </span>
      {node.durationMs && node.durationMs > 100 ? (
        <span
          className={cn(
            "font-mono tabular-nums text-[10.5px]",
            node.status === "done"
              ? "text-muted-foreground/60"
              : "text-[var(--primary)]/70",
          )}
        >
          {formatDuration(node.durationMs)}
        </span>
      ) : null}
    </li>
  );
}

function SubDot({ status }: { status: NodeStatus }) {
  if (status === "running") {
    return (
      <span className="relative flex size-3 shrink-0 items-center justify-center">
        <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-[var(--primary)] opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-[var(--primary)]" />
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="flex size-3 shrink-0 items-center justify-center rounded-full bg-emerald-500/90">
        <Check className="size-2 text-white" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex size-3 shrink-0 items-center justify-center rounded-full bg-[var(--destructive)]/90">
        <AlertTriangle className="size-2 text-white" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className="flex size-3 shrink-0 items-center justify-center">
      <Circle
        className="size-2 text-muted-foreground/30"
        strokeWidth={1.5}
      />
    </span>
  );
}

// ─── Header bits ────────────────────────────────────────────────────

function titleForStatus(scan: ScanState): string {
  if (scan.status === "succeeded") return "Your portfolio is ready";
  if (scan.status === "failed") return "The pipeline hit a snag";
  if (scan.status === "cancelled") return "Scan cancelled";
  return phaseLabel(scan.current_phase ?? scan.last_completed_phase);
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border/40"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full bg-[var(--primary)] transition-[width] duration-700 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function StatusPill({ status }: { status: ScanState["status"] }) {
  const color =
    status === "running" || status === "queued"
      ? "bg-[var(--primary)]"
      : status === "succeeded"
        ? "bg-emerald-500"
        : status === "failed"
          ? "bg-[var(--destructive)]"
          : "bg-muted-foreground";
  const label =
    status === "queued"
      ? "Queued"
      : status === "running"
        ? "Running"
        : status === "succeeded"
          ? "Succeeded"
          : status === "failed"
            ? "Failed"
            : "Cancelled";
  const animate = status === "queued" || status === "running";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-card/40 px-3 py-1 text-[11px] text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", color, animate && "gs-pulse")} />
      {label}
    </span>
  );
}

// ─── Terminal-state cards ───────────────────────────────────────────

function CompletedCta({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="gs-enter rounded-2xl border border-border/40 bg-card/40 p-5 flex flex-col gap-3">
      <div className="text-[13px]">
        Draft ready. Review it, tune anything in the editor, then publish.
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/app/preview"
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-10"
        >
          Preview draft →
        </Link>
        <Link
          href="/app/edit"
          className="inline-flex items-center rounded-xl border border-border/60 bg-card/30 px-4 py-2 text-[13px] font-medium hover:bg-card/50 transition-colors min-h-10"
        >
          Edit
        </Link>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center rounded-xl border border-border/40 bg-card/30 px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground transition-colors min-h-10"
        >
          Refresh state
        </button>
      </div>
    </div>
  );
}

function FailedCard({ error }: { error: string | null }) {
  return (
    <div className="gs-enter rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/[0.04] p-5 flex flex-col gap-3">
      <div className="text-[13px] font-medium">The pipeline hit a snag.</div>
      {error ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground font-mono bg-card/60 rounded-lg p-3 whitespace-pre-wrap break-words">
          {error.slice(0, 1200)}
        </p>
      ) : null}
      <Link
        href="/app"
        className="self-start inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-10"
      >
        Back to dashboard
      </Link>
    </div>
  );
}

function CancelledCard() {
  return (
    <div className="gs-enter rounded-2xl border border-border/40 bg-card/30 p-5 text-[13px] text-muted-foreground">
      Scan was cancelled.
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}
