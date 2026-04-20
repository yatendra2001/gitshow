"use client";

/**
 * Agent progress — per-phase nested rendering of the M1 structured
 * event stream.
 *
 * Structure:
 *   [Phase card]            (one per pipeline phase)
 *     header                (humanized title + status + duration)
 *     └ current-stage body  (only for the running phase)
 *         └ Reasoning       (one block per reasoning_id; streams tokens
 *                            and auto-collapses to "Thought for Xs" on
 *                            reasoning-end)
 *         └ Tool cards      (one per tool_id; live status badge)
 *         └ Sources chips   (chip per source-added)
 *
 * Done phases collapse to a one-line summary. Pending phases render
 * as dim rows. The UX intentionally mirrors chatbot's Reasoning/Tool
 * primitives — same auto-open-while-streaming + collapse-to-"Thought
 * for Xs" pattern.
 *
 * Raw stream events are piped to a hidden developer terminal behind
 * a toggle, not spilled into the main view. The text-dump the user
 * was seeing was the OpenRouter agent's onProgress callback getting
 * dumped into the Terminal — the Reasoning block was being fed the
 * same tokens via reasoning-delta, but the Terminal's verbosity
 * drowned it out.
 */

import * as React from "react";
import type {
  ScanEventEnvelope,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  ToolStartEvent,
  ToolEndEvent,
  SourceAddedEvent,
  StageStartEvent,
  StageEndEvent,
} from "@gitshow/shared/events";
import { Reasoning } from "@/components/ai-elements/reasoning";
import { Tool, type ToolStatus } from "@/components/ai-elements/tool";
import { Sources, type SourceItem } from "@/components/ai-elements/sources";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Terminal } from "@/components/ai-elements/terminal";
import { PHASE_COPY, PHASE_ORDER, humanizeWorker } from "@/lib/phase-copy";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  CheckCircle2,
  Circle,
  CircleDashed,
  AlertCircle,
  Sparkles,
  Terminal as TerminalIcon,
} from "lucide-react";

export interface AgentProgressProps {
  envelopes: ScanEventEnvelope[];
  terminalLines: string[];
  sinceAt?: number;
  planTitle?: string;
  planDescription?: string;
  planStreaming?: boolean;
  compact?: boolean;
  hideTerminal?: boolean;
  className?: string;
}

export function AgentProgress({
  envelopes,
  terminalLines,
  sinceAt,
  compact = false,
  hideTerminal = false,
  className,
}: AgentProgressProps) {
  const scoped = React.useMemo(() => {
    if (!sinceAt) return envelopes;
    return envelopes.filter((e) => e.at >= sinceAt);
  }, [envelopes, sinceAt]);

  const { phases, unattached } = React.useMemo(
    () => buildPhaseTree(scoped),
    [scoped],
  );

  const runningPhase = phases.find((p) => p.status === "running");

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {phases.map((phase) => (
        <PhaseCard
          key={phase.id}
          phase={phase}
          autoOpen={phase.id === runningPhase?.id || phase.status === "running"}
          compact={compact}
        />
      ))}

      {/* Post-bind events that aren't wrapped in a stage — show them
          as a "Finalizing" free-form block so they don't disappear. */}
      {unattached && unattached.hasAny ? (
        <PhaseCard
          phase={unattached}
          autoOpen={!runningPhase}
          compact={compact}
        />
      ) : null}

      {!hideTerminal && terminalLines.length > 0 ? (
        <DevTerminal lines={terminalLines} />
      ) : null}
    </div>
  );
}

// ─── Phase card ─────────────────────────────────────────────────────

interface PhaseData {
  id: string;
  title: string;
  subtitle?: string;
  status: "pending" | "running" | "done" | "warn" | "failed";
  duration_ms?: number;
  reasonings: ReasoningBlock[];
  tools: ToolCall[];
  sources: SourceRow[];
  /** For the synthetic "unattached" bucket. */
  hasAny?: boolean;
}

interface ReasoningBlock {
  id: string;
  agent: string;
  label: string;
  text: string;
  done: boolean;
  started_at: number;
  ended_at?: number;
}

interface ToolCall {
  id: string;
  name: string;
  label: string;
  input_preview?: string;
  output_preview?: string;
  status: ToolStatus;
  error?: string;
}

interface SourceRow {
  id: string;
  kind: string;
  preview: string;
}

function PhaseCard({
  phase,
  autoOpen,
  compact,
}: {
  phase: PhaseData;
  autoOpen: boolean;
  compact: boolean;
}) {
  const [open, setOpen] = React.useState(autoOpen);
  React.useEffect(() => {
    setOpen(autoOpen);
  }, [autoOpen]);

  const hasBody =
    phase.reasonings.length > 0 ||
    phase.tools.length > 0 ||
    phase.sources.length > 0;

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors duration-200",
        phase.status === "running"
          ? "border-[var(--chart-1)]/40 bg-[var(--chart-1)]/[0.03]"
          : phase.status === "done"
            ? "border-border/30 bg-card/40"
            : phase.status === "failed" || phase.status === "warn"
              ? "border-[var(--destructive)]/30 bg-[var(--destructive)]/[0.04]"
              : "border-border/20 bg-card/20 opacity-70",
      )}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        disabled={!hasBody}
        className={cn(
          "flex w-full items-center gap-3 px-3.5 py-2.5 text-left",
          hasBody && "cursor-pointer hover:bg-muted/20",
        )}
        aria-expanded={open}
      >
        <PhaseStatusIcon status={phase.status} />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span
            className={cn(
              "truncate text-[14px] font-medium",
              phase.status === "pending" && "text-muted-foreground",
            )}
          >
            {phase.title}
          </span>
          {phase.status === "running" && phase.subtitle ? (
            <Shimmer
              className="hidden text-[12px] text-muted-foreground/80 sm:inline"
              duration={2.5}
            >
              {phase.subtitle}
            </Shimmer>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
          {phase.duration_ms !== undefined ? (
            <span>
              {phase.duration_ms < 1000
                ? `${phase.duration_ms}ms`
                : `${(phase.duration_ms / 1000).toFixed(1)}s`}
            </span>
          ) : null}
          {phase.tools.length > 0 ? (
            <span className="hidden sm:inline">
              {phase.tools.length} tool{phase.tools.length === 1 ? "" : "s"}
            </span>
          ) : null}
          {hasBody ? (
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-200",
                open && "rotate-90",
              )}
            />
          ) : null}
        </div>
      </button>

      {open && hasBody ? (
        <div className="border-t border-border/20 px-3.5 py-3 space-y-3">
          {phase.reasonings.map((r) => (
            <Reasoning
              key={r.id}
              text={r.text}
              label={r.label}
              streaming={!r.done}
              elapsedMs={
                r.ended_at && r.started_at
                  ? r.ended_at - r.started_at
                  : undefined
              }
            />
          ))}
          {phase.tools.length > 0 ? (
            <div className="space-y-1.5">
              {phase.tools.map((t) => (
                <Tool
                  key={t.id}
                  name={t.label}
                  status={t.status}
                  subtitle={t.name !== t.label ? t.name : undefined}
                  input={t.input_preview}
                  output={t.output_preview}
                  error={t.error}
                  defaultOpen={false}
                />
              ))}
            </div>
          ) : null}
          {phase.sources.length > 0 ? (
            <Sources
              items={phase.sources.map<SourceItem>((s) => ({
                id: s.id,
                url: "",
                label: `${s.kind} · ${s.preview}`,
              }))}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PhaseStatusIcon({ status }: { status: PhaseData["status"] }) {
  if (status === "running") {
    return (
      <div className="relative size-4 shrink-0">
        <span className="absolute inset-0 rounded-full bg-[var(--chart-1)]/50 animate-ping" />
        <span className="absolute inset-1 rounded-full bg-[var(--chart-1)]" />
      </div>
    );
  }
  if (status === "done") {
    return <CheckCircle2 className="size-4 shrink-0 text-[var(--chart-3)]" />;
  }
  if (status === "failed") {
    return <AlertCircle className="size-4 shrink-0 text-[var(--destructive)]" />;
  }
  if (status === "warn") {
    return <AlertCircle className="size-4 shrink-0 text-[var(--chart-4)]" />;
  }
  return <Circle className="size-4 shrink-0 text-muted-foreground/40" />;
}

// ─── Dev terminal (raw log, collapsed by default) ──────────────────

function DevTerminal({ lines }: { lines: string[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-xl border border-border/20 bg-card/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3.5 py-2 text-left hover:bg-muted/20"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <TerminalIcon className="size-3.5" />
          Developer log
          <span className="font-mono text-[11px] text-muted-foreground/70">
            ({lines.length} line{lines.length === 1 ? "" : "s"})
          </span>
        </span>
        <ChevronRight
          className={cn(
            "size-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <div className="border-t border-border/20 p-0">
          <Terminal lines={lines} title="" />
        </div>
      ) : null}
    </div>
  );
}

// ─── Event → phase-tree projection ─────────────────────────────────

function buildPhaseTree(envelopes: ScanEventEnvelope[]): {
  phases: PhaseData[];
  unattached?: PhaseData;
} {
  // Initialize ordered phases from the canonical pipeline order so
  // pending ones appear in the queue even before their events arrive.
  const phaseMap = new Map<string, PhaseData>();
  for (const id of PHASE_ORDER) {
    const copy = (PHASE_COPY as Record<string, { title: string; activity: string; done: string }>)[id];
    if (!copy) continue;
    phaseMap.set(id, {
      id,
      title: copy.title,
      subtitle: copy.activity,
      status: "pending",
      reasonings: [],
      tools: [],
      sources: [],
    });
  }

  // Track current phase as we walk events. `lastCurrent` remembers the
  // previous active phase so stray events that arrive in the tiny
  // window between `stage-end` and the next `stage-start` still pin to
  // a real phase instead of falsely lighting up "Finalizing".
  //
  // Why: the Fly worker publishes to the realtime DO fire-and-forget
  // (apps/worker/scripts/run-scan.ts). A late `worker-update` from
  // inventory can arrive at the DO *after* normalize's stage-start has
  // been sequenced, so the client sees events outside their logical
  // stage boundary. Pinning to `lastCurrent` keeps the UI faithful.
  let current: string | null = null;
  let lastCurrent: string | null = null;
  const unattached: PhaseData = {
    id: "__finalizing__",
    title: "Finalizing",
    subtitle: "Reviewing, polishing, writing the card…",
    status: "running",
    reasonings: [],
    tools: [],
    sources: [],
    hasAny: false,
  };

  const lastPhaseId = PHASE_ORDER[PHASE_ORDER.length - 1];

  // Track partial reasoning blocks by id so we can attribute tool/source
  // events to the right phase even if reasoning spans phase boundaries.
  const reasoningPhase = new Map<string, string | null>();

  const getBucket = (): PhaseData => {
    if (current && phaseMap.has(current)) return phaseMap.get(current)!;
    // No active stage. Before the final pipeline phase (`bind`) has
    // ended, treat the gap as "still inside the previous phase" — this
    // is the fire-and-forget ordering case. Only after `bind` is done
    // do we flip to the synthetic Finalizing bucket.
    const bindDone = phaseMap.get(lastPhaseId)?.status === "done";
    if (!bindDone && lastCurrent && phaseMap.has(lastCurrent)) {
      return phaseMap.get(lastCurrent)!;
    }
    unattached.hasAny = true;
    return unattached;
  };

  for (const env of envelopes) {
    const e = env.event;

    if (e.kind === "stage-start") {
      const s = e as StageStartEvent;
      current = s.stage;
      let p = phaseMap.get(s.stage);
      if (!p) {
        p = {
          id: s.stage,
          title: s.stage,
          subtitle: s.detail,
          status: "running",
          reasonings: [],
          tools: [],
          sources: [],
        };
        phaseMap.set(s.stage, p);
      }
      p.status = "running";
      if (s.detail) p.subtitle = s.detail;
      continue;
    }

    if (e.kind === "stage-end") {
      const s = e as StageEndEvent;
      const p = phaseMap.get(s.stage);
      if (p) {
        p.status = "done";
        p.duration_ms = s.duration_ms;
      }
      // Remember the phase that just ended so stray inter-stage events
      // still pin to it (see `getBucket`). Only once `bind` has ended
      // do post-pipeline events legitimately route to Finalizing.
      lastCurrent = s.stage;
      current = null;
      continue;
    }

    if (e.kind === "stage-warn") {
      const p = phaseMap.get(e.stage);
      if (p && p.status === "running") p.status = "warn";
      continue;
    }

    if (e.kind === "error") {
      const p = e.stage ? phaseMap.get(e.stage) : null;
      if (p) p.status = "failed";
      continue;
    }

    if (e.kind === "reasoning-delta") {
      const d = e as ReasoningDeltaEvent;
      const bucket = getBucket();
      reasoningPhase.set(d.reasoning_id, bucket.id);
      let rb = bucket.reasonings.find((r) => r.id === d.reasoning_id);
      if (!rb) {
        rb = {
          id: d.reasoning_id,
          agent: d.agent,
          label: d.title ?? humanizeAgent(d.agent),
          text: "",
          done: false,
          started_at: env.at,
        };
        bucket.reasonings.push(rb);
      }
      rb.text += d.text_delta;
      continue;
    }

    if (e.kind === "reasoning-end") {
      const r = e as ReasoningEndEvent;
      const phaseId = reasoningPhase.get(r.reasoning_id);
      const bucket = phaseId
        ? phaseMap.get(phaseId) ?? unattached
        : getBucket();
      const rb = bucket.reasonings.find((x) => x.id === r.reasoning_id);
      if (rb) {
        rb.done = true;
        rb.ended_at = env.at;
      }
      continue;
    }

    if (e.kind === "reasoning") {
      // Legacy single-shot reasoning — append as one "done" block.
      const bucket = getBucket();
      const id = `leg_${env.id}`;
      bucket.reasonings.push({
        id,
        agent: e.agent,
        label: humanizeAgent(e.agent),
        text: e.text,
        done: true,
        started_at: env.at,
        ended_at: env.at,
      });
      continue;
    }

    if (e.kind === "tool-start") {
      const t = e as ToolStartEvent;
      const bucket = getBucket();
      if (!bucket.tools.find((x) => x.id === t.tool_id)) {
        bucket.tools.push({
          id: t.tool_id,
          name: t.tool_name,
          label: t.display_label,
          input_preview: t.input_preview,
          status: "running",
        });
      }
      continue;
    }

    if (e.kind === "tool-end") {
      const t = e as ToolEndEvent;
      // Find the phase that holds this tool (may be any phase — tools
      // can outlive the phase they started in if events arrive OOO).
      for (const p of phaseMap.values()) {
        const tc = p.tools.find((x) => x.id === t.tool_id);
        if (tc) {
          tc.status =
            t.status === "ok"
              ? "completed"
              : t.status === "err"
                ? "error"
                : "denied";
          tc.output_preview = t.output_preview;
          if (t.error_message) tc.error = t.error_message;
          break;
        }
      }
      // Check unattached too.
      const tc = unattached.tools.find((x) => x.id === t.tool_id);
      if (tc) {
        tc.status =
          t.status === "ok"
            ? "completed"
            : t.status === "err"
              ? "error"
              : "denied";
        tc.output_preview = t.output_preview;
        if (t.error_message) tc.error = t.error_message;
      }
      continue;
    }

    if (e.kind === "source-added") {
      const s = e as SourceAddedEvent;
      const bucket = getBucket();
      if (!bucket.sources.find((x) => x.id === s.source_id)) {
        bucket.sources.push({
          id: s.source_id,
          kind: s.source_kind,
          preview: s.preview,
        });
      }
      continue;
    }

    if (e.kind === "worker-update") {
      // Attach parallel-worker state to the current phase's tools list
      // as a synthetic tool so users see "cross-repo / temporal / …"
      // progressing during the workers stage.
      const bucket = getBucket();
      const id = `worker:${e.worker}`;
      let tool = bucket.tools.find((x) => x.id === id);
      if (!tool) {
        tool = {
          id,
          name: e.worker,
          label: humanizeWorker(e.worker),
          status: "running",
        };
        bucket.tools.push(tool);
      }
      tool.status =
        e.status === "done"
          ? "completed"
          : e.status === "failed"
            ? "error"
            : "running";
      if (e.detail) tool.input_preview = e.detail;
      continue;
    }
  }

  return {
    phases: Array.from(phaseMap.values()),
    unattached: unattached.hasAny ? unattached : undefined,
  };
}

function humanizeAgent(agent: string): string {
  switch (agent) {
    case "discover":
      return "Looking for what's distinctive";
    case "hook-writer":
      return "Writing your opening line";
    case "hook-critic":
      return "Picking the strongest candidate";
    case "angle-selector":
      return "Picking the angle";
    case "numbers":
      return "Choosing your three numbers";
    case "disclosure":
      return "Writing the honest flaw";
    case "shipped":
      return "Cataloging what you've shipped";
    case "copy-editor":
      return "Copy-editing for voice";
    case "profile-critic":
      return "Double-checking every claim";
    case "hiring-manager":
      return "Reviewer reading your profile";
    case "timeline":
      return "Laying out your timeline";
    case "intake":
      return "Picking your intake questions";
    default:
      return agent.replace(/[-_]/g, " ");
  }
}
