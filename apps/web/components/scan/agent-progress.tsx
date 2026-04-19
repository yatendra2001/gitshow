"use client";

/**
 * Agent progress stack — the Plan / Chain of Thought / Reasoning /
 * Queue / Tools / Sources / Terminal stack used by the right pane
 * during the initial scan AND by the chat pane during a revise.
 *
 * Keeping it as one component so both surfaces render the same
 * primitives with the same event stream, just filtered to the window
 * that matters for each surface.
 */

import * as React from "react";
import type { ScanEventEnvelope } from "@gitshow/shared/events";
import { Plan } from "@/components/ai-elements/plan";
import { Terminal } from "@/components/ai-elements/terminal";
import { Queue, type QueueRow } from "@/components/ai-elements/queue";
import { Reasoning } from "@/components/ai-elements/reasoning";
import {
  ChainOfThought,
  type CoTStep,
} from "@/components/ai-elements/chain-of-thought";
import { Sources, type SourceItem } from "@/components/ai-elements/sources";
import { Tool, type ToolStatus } from "@/components/ai-elements/tool";
import { Task } from "@/components/ai-elements/task";
import {
  projectPhases,
  currentPhase,
  type PhaseState,
} from "@/lib/use-scan-stream";
import { PHASE_COPY, PHASE_ORDER, humanizeWorker } from "@/lib/phase-copy";

export interface AgentProgressProps {
  /** Full envelope stream — we slice to the visible window internally. */
  envelopes: ScanEventEnvelope[];
  /** Raw DO stream text lines. */
  terminalLines: string[];
  /** Set to an `at` millis cursor to only render events at/after it.
   *  Used by the chat-pane inline progress to scope to the current
   *  revise, rather than the whole scan history. */
  sinceAt?: number;
  /** Leading card copy. When absent we infer from the current phase. */
  planTitle?: string;
  planDescription?: string;
  planStreaming?: boolean;
  /** Compact mode drops the PLAN card (the chat renders its own
   *  "Rewriting…" message already) and tightens spacing. */
  compact?: boolean;
  /** Hide the Terminal block. Useful inline in chat where vertical
   *  space is precious. */
  hideTerminal?: boolean;
  className?: string;
}

export function AgentProgress({
  envelopes,
  terminalLines,
  sinceAt,
  planTitle,
  planDescription,
  planStreaming,
  compact = false,
  hideTerminal = false,
  className,
}: AgentProgressProps) {
  const scoped = React.useMemo(() => {
    if (!sinceAt) return envelopes;
    return envelopes.filter((e) => e.at >= sinceAt);
  }, [envelopes, sinceAt]);

  const phases = React.useMemo(
    () => projectPhases(scoped, PHASE_ORDER),
    [scoped],
  );
  const cur = currentPhase(phases);

  const cotSteps = React.useMemo(() => buildCoTSteps(scoped), [scoped]);
  const reasoning = React.useMemo(
    () => buildReasoningBlock(scoped),
    [scoped],
  );
  const sources = React.useMemo(() => buildSources(scoped), [scoped]);
  const queue = React.useMemo(() => buildQueue(phases), [phases]);
  const tools = React.useMemo(() => buildTools(scoped), [scoped]);
  const effectiveLog = React.useMemo(
    () => [...synthLogLines(scoped), ...terminalLines],
    [scoped, terminalLines],
  );

  // When no card-specific title is given, infer one from the
  // most-recent running phase. Handy for the right pane's default.
  const inferredTitle = cur && cur.phase in PHASE_COPY
    ? PHASE_COPY[cur.phase as keyof typeof PHASE_COPY].title
    : null;
  const inferredDesc =
    cur && cur.phase in PHASE_COPY
      ? PHASE_COPY[cur.phase as keyof typeof PHASE_COPY].activity
      : null;

  return (
    <div className={className}>
      <div className={compact ? "space-y-2" : "space-y-4"}>
        {!compact && (planTitle ?? inferredTitle) && (
          <Plan
            title={planTitle ?? inferredTitle ?? "Working on it"}
            description={planDescription ?? inferredDesc ?? undefined}
            isStreaming={planStreaming ?? true}
          />
        )}

        {cotSteps.length > 0 && (
          <ChainOfThought steps={cotSteps} streaming={planStreaming ?? true} />
        )}

        {reasoning.text.length > 0 && (
          <Reasoning
            text={reasoning.text}
            streaming={(planStreaming ?? true) && !reasoning.done}
            label={reasoning.label}
          />
        )}

        {(queue.running.length > 0 || queue.upNext.length > 0 || queue.done.length > 0) && (
          <Queue
            running={queue.running}
            upNext={queue.upNext}
            done={queue.done}
          />
        )}

        {tools.length > 0 && (
          <Task
            title="Tools"
            subtitle={`${tools.length} call${tools.length === 1 ? "" : "s"}`}
            status="running"
            defaultOpen={!compact}
          >
            <div className="space-y-1.5">
              {tools.map((t) => (
                <Tool
                  key={t.id}
                  name={t.name}
                  status={t.status}
                  subtitle={t.subtitle}
                  output={t.output}
                  error={t.error}
                />
              ))}
            </div>
          </Task>
        )}

        {sources.length > 0 && <Sources items={sources} />}

        {!hideTerminal && effectiveLog.length > 0 && (
          <Terminal
            lines={effectiveLog}
            title={compact ? "What the agent is doing" : "Live log"}
          />
        )}
      </div>
    </div>
  );
}

// ─── Event projections (moved here from progress-pane) ─────────────

function buildCoTSteps(envelopes: ScanEventEnvelope[]): CoTStep[] {
  const byStage = new Map<
    string,
    {
      title: string;
      chips: { id: string; label: string; url?: string }[];
      done: boolean;
    }
  >();
  const stageOrder: string[] = [];

  for (const env of envelopes) {
    const e = env.event;
    if (e.kind === "stage-start" && e.stage) {
      const copy = (
        PHASE_COPY as Record<
          string,
          { activity: string; done: string; title: string }
        >
      )[e.stage];
      if (!byStage.has(e.stage)) {
        stageOrder.push(e.stage);
        byStage.set(e.stage, {
          title: copy?.activity ?? e.stage,
          chips: [],
          done: false,
        });
      }
    }
    if (e.kind === "stage-end" && e.stage && byStage.has(e.stage)) {
      const row = byStage.get(e.stage)!;
      row.done = true;
      const copy = (
        PHASE_COPY as Record<
          string,
          { activity: string; done: string; title: string }
        >
      )[e.stage];
      if (copy) row.title = copy.done;
    }
    if (e.kind === "worker-update" && e.worker) {
      const last = stageOrder[stageOrder.length - 1];
      if (!last) continue;
      const row = byStage.get(last);
      if (!row) continue;
      if (e.detail) {
        const urls = e.detail.match(/https?:\/\/[^\s)]+/g) ?? [];
        for (const u of urls) {
          if (!row.chips.find((c) => c.url === u)) {
            row.chips.push({
              id: `${env.id}-${row.chips.length}`,
              label: safeHost(u),
              url: u,
            });
          }
        }
      }
      const name = humanizeWorker(e.worker);
      if (!row.chips.find((c) => c.label === name)) {
        row.chips.push({
          id: `${env.id}-w${row.chips.length}`,
          label: name,
        });
      }
    }
  }

  return stageOrder.map<CoTStep>((phase) => {
    const row = byStage.get(phase)!;
    return {
      id: phase,
      title: row.title,
      chips: row.chips.slice(0, 6),
      done: row.done,
    };
  });
}

function buildReasoningBlock(envelopes: ScanEventEnvelope[]): {
  text: string;
  label: string;
  done: boolean;
} {
  const parts: string[] = [];
  let label = "Thinking";
  let mostRecentAt = 0;
  for (const env of envelopes) {
    if (env.event.kind === "reasoning") {
      parts.push(env.event.text);
      label = humanizeAgent(env.event.agent);
      mostRecentAt = env.at;
    }
  }
  const done = mostRecentAt > 0 && Date.now() - mostRecentAt > 4000;
  return { text: parts.join("\n\n"), label, done };
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
    default:
      return agent.replace(/[-_]/g, " ");
  }
}

function buildSources(envelopes: ScanEventEnvelope[]): SourceItem[] {
  const seen = new Set<string>();
  const out: SourceItem[] = [];
  for (const env of envelopes) {
    const e = env.event;
    const detail =
      e.kind === "worker-update"
        ? e.detail
        : e.kind === "stage-end"
          ? e.detail
          : undefined;
    if (!detail) continue;
    const urls = detail.match(/https?:\/\/[^\s)]+/g) ?? [];
    for (const u of urls) {
      if (seen.has(u)) continue;
      seen.add(u);
      out.push({ id: `${env.id}-${seen.size}`, url: u });
    }
  }
  return out;
}

function buildTools(
  envelopes: ScanEventEnvelope[],
): Array<{
  id: string;
  name: string;
  subtitle?: string;
  status: ToolStatus;
  output?: string;
  error?: string;
}> {
  const byWorker = new Map<
    string,
    {
      status: ToolStatus;
      subtitle?: string;
      output?: string;
      error?: string;
    }
  >();
  for (const env of envelopes) {
    const e = env.event;
    if (e.kind !== "worker-update" || !e.worker) continue;
    const prior = byWorker.get(e.worker) ?? { status: "pending" as ToolStatus };
    if (e.status === "running") prior.status = "running";
    else if (e.status === "done") prior.status = "completed";
    else if (e.status === "failed") prior.status = "error";
    if (e.detail) {
      if (e.status === "done") prior.output = e.detail;
      else if (e.status === "failed") prior.error = e.detail;
      else prior.subtitle = e.detail;
    }
    byWorker.set(e.worker, prior);
  }
  return Array.from(byWorker.entries()).map(([name, state]) => ({
    id: name,
    name: humanizeWorker(name),
    subtitle: state.subtitle,
    status: state.status,
    output: state.output,
    error: state.error,
  }));
}

function buildQueue(phases: PhaseState[]): {
  running: QueueRow[];
  upNext: QueueRow[];
  done: QueueRow[];
} {
  const running: QueueRow[] = [];
  const upNext: QueueRow[] = [];
  const done: QueueRow[] = [];

  for (const p of phases) {
    const copy = (
      PHASE_COPY as Record<
        string,
        { title: string; activity: string; done: string }
      >
    )[p.phase];
    if (!copy) continue;
    if (p.status === "running" || p.status === "warn") {
      running.push({
        id: p.phase,
        title: copy.title,
        subtitle: copy.activity,
      });
    } else if (p.status === "done") {
      done.push({ id: p.phase, title: copy.done });
    } else if (p.status === "failed") {
      running.push({
        id: p.phase,
        title: `${copy.title} — hit a snag`,
        subtitle: p.warnings?.[0] ?? "Continuing with what worked.",
      });
    } else {
      upNext.push({ id: p.phase, title: copy.title });
    }
  }
  return { running, upNext: upNext.slice(0, 4), done: done.reverse() };
}

function synthLogLines(envelopes: ScanEventEnvelope[]): string[] {
  const out: string[] = [];
  for (const env of envelopes) {
    const t = fmtTime(env.at);
    const e = env.event;
    if (e.kind === "stage-start" && e.stage) {
      const copy = (
        PHASE_COPY as Record<
          string,
          { activity: string; done: string; title: string }
        >
      )[e.stage];
      out.push(
        `[${t}] info  ${copy?.title ?? e.stage} starting…`,
      );
      if (copy?.activity) out.push(`[${t}]         ${copy.activity}`);
    } else if (e.kind === "stage-end" && e.stage) {
      const copy = (
        PHASE_COPY as Record<
          string,
          { activity: string; done: string; title: string }
        >
      )[e.stage];
      const dur = e.duration_ms
        ? ` ${Math.round(e.duration_ms / 100) / 10}s`
        : "";
      out.push(
        `[${t}] ok    ${copy?.done ?? e.stage} done${dur}${e.detail ? ` · ${e.detail}` : ""}`,
      );
    } else if (e.kind === "stage-warn") {
      out.push(`[${t}] warn  ${e.stage ? `${e.stage}: ` : ""}${e.message}`);
    } else if (e.kind === "worker-update" && e.worker) {
      const name = humanizeWorker(e.worker);
      if (e.status === "running") {
        out.push(`[${t}] running ${name}…`);
      } else if (e.status === "done") {
        out.push(`[${t}] ok     ${name}${e.detail ? ` · ${e.detail}` : ""}`);
      } else if (e.status === "failed") {
        out.push(`[${t}] error  ${name}${e.detail ? ` · ${e.detail}` : ""}`);
      }
    } else if (e.kind === "reasoning") {
      const txt = e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text;
      out.push(`[${t}] think  ${humanizeAgent(e.agent)}: ${txt}`);
    } else if (e.kind === "error") {
      out.push(`[${t}] error  ${e.stage ? `${e.stage}: ` : ""}${e.message}`);
    }
  }
  return out;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
