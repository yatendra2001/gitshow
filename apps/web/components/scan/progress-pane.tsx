"use client";

import * as React from "react";
import type { ScanEventEnvelope } from "@gitshow/shared/events";
import { Plan } from "@/components/ai-elements/plan";
import { Terminal } from "@/components/ai-elements/terminal";
import {
  TestResults,
  type TestStatus,
} from "@/components/ai-elements/test-results";
import { HudPill } from "@/components/ai-elements/context";
import {
  Artifact,
  ArtifactContent,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { Queue, type QueueRow } from "@/components/ai-elements/queue";
import { Reasoning } from "@/components/ai-elements/reasoning";
import {
  ChainOfThought,
  type CoTStep,
} from "@/components/ai-elements/chain-of-thought";
import { Sources, type SourceItem } from "@/components/ai-elements/sources";
import { Tool, type ToolStatus } from "@/components/ai-elements/tool";
import { Task } from "@/components/ai-elements/task";
import { ProfileCardView } from "@/components/scan/profile-card";
import {
  projectPhases,
  currentPhase,
  latestUsage,
  latestEvalAxes,
} from "@/lib/use-scan-stream";
import { PHASE_COPY, PHASE_ORDER, humanizeWorker } from "@/lib/phase-copy";
import type { ScanRow } from "@/lib/scans";
import type { ProfileCard, CardClaim } from "@gitshow/shared/schemas";
import { Activity as ActivityIcon, Sparkles } from "lucide-react";

/**
 * Right pane. The full agent-UI stack, always showing what the model is
 * doing — no ETA, no percent, just live signal:
 *
 *   1. HUD (plan headline, cost, verdict once it lands)
 *   2. Chain of Thought — narrative of the active phase with source chips
 *   3. Reasoning — streaming monologue from the active agent
 *   4. Queue — Running + Done, AI-Elements style
 *   5. Tool calls — per-worker invocations with status badges
 *   6. Sources — accumulating citations
 *   7. Terminal — always visible raw log tail
 *   8. TestResults — hiring-manager axes when they land
 *   9. Artifact — profile card once the scan succeeds
 */
export function ProgressPane({
  scan,
  envelopes,
  terminalLines,
  partialCard,
  card,
  highlightClaimId,
  onClaimClick,
  revisePending,
}: {
  scan: ScanRow;
  envelopes: ScanEventEnvelope[];
  terminalLines: string[];
  partialCard: ProfileCard | null;
  card: ProfileCard | null;
  highlightClaimId?: string | null;
  onClaimClick?: (claimId: string, beat: CardClaim["beat"]) => void;
  revisePending?: { title: string } | null;
}) {
  const phases = React.useMemo(
    () => projectPhases(envelopes, PHASE_ORDER),
    [envelopes],
  );
  const cur = currentPhase(phases);
  const usage = latestUsage(envelopes);
  const evalAxes = latestEvalAxes(envelopes);

  const cotSteps = React.useMemo(() => buildCoTSteps(envelopes), [envelopes]);
  const reasoning = React.useMemo(
    () => buildReasoningBlock(envelopes),
    [envelopes],
  );
  const sources = React.useMemo(() => buildSources(envelopes), [envelopes]);
  const queue = React.useMemo(() => buildQueue(phases), [phases]);
  const tools = React.useMemo(() => buildTools(envelopes), [envelopes]);
  // Terminal content: synthesize log lines from structured events so the
  // log panel is never empty, then append any real stream lines we've
  // received over WS. If streams are flowing we get both granularities;
  // if the realtime endpoint isn't reachable we still have narration.
  const effectiveLog = React.useMemo(
    () => [...synthLogLines(envelopes), ...terminalLines],
    [envelopes, terminalLines],
  );

  const finalCard = card ?? partialCard;
  const isRunning = scan.status === "running" || scan.status === "queued";
  const isDone = scan.status === "succeeded";

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <span className="gs-noise" aria-hidden />

      {/* HUD — just the current phase + reviewer verdict (no cost noise) */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border/80 px-5 py-2.5 backdrop-blur-sm">
        {isRunning && cur && cur.phase in PHASE_COPY ? (
          <HudPill
            icon={<Sparkles />}
            label="now"
            value={PHASE_COPY[cur.phase as keyof typeof PHASE_COPY].title}
          />
        ) : isDone ? (
          <HudPill icon={<Sparkles />} label="status" value="Ready" />
        ) : null}
        {scan.hiring_verdict && (
          <HudPill
            icon={<ActivityIcon />}
            label="reviewer"
            value={`${scan.hiring_verdict} ${scan.hiring_score ?? "—"}/100`}
          />
        )}
      </div>

      <div className="gs-pane-scroll relative flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {/* PLAN */}
        {revisePending ? (
          <Plan
            title={revisePending.title}
            description="Just the piece you pinned is being rewritten. The rest of your profile stays put."
            isStreaming
          />
        ) : isRunning ? (
          <Plan
            title={
              cur && cur.phase in PHASE_COPY
                ? PHASE_COPY[cur.phase as keyof typeof PHASE_COPY].title
                : scan.status === "queued"
                  ? "Waking things up"
                  : "Getting started"
            }
            description={
              cur && cur.phase in PHASE_COPY
                ? PHASE_COPY[cur.phase as keyof typeof PHASE_COPY].activity
                : "Reading everything public about your GitHub handle."
            }
            isStreaming
          />
        ) : isDone ? (
          <Plan
            title="Your profile is ready"
            description="Click any piece on the right to tweak it — open the chat and tell gitshow what to change."
          />
        ) : (
          <Plan
            title="Something went sideways"
            description={
              scan.error ?? "The pipeline failed. Try again from your dashboard."
            }
          />
        )}

        {/* CHAIN OF THOUGHT */}
        {cotSteps.length > 0 && (
          <ChainOfThought steps={cotSteps} streaming={isRunning} />
        )}

        {/* REASONING */}
        {reasoning.text.length > 0 && (
          <Reasoning
            text={reasoning.text}
            streaming={isRunning && !reasoning.done}
            label={reasoning.label}
          />
        )}

        {/* QUEUE */}
        {(isRunning || queue.done.length > 0) && (
          <Queue
            running={queue.running}
            upNext={queue.upNext}
            done={queue.done}
          />
        )}

        {/* TOOL CALLS */}
        {tools.length > 0 && (
          <Task
            title="Tools"
            subtitle={`${tools.length} call${tools.length === 1 ? "" : "s"}`}
            status={isRunning ? "running" : "done"}
            defaultOpen
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

        {/* SOURCES */}
        {sources.length > 0 && <Sources items={sources} />}

        {/* TEST RESULTS — hiring-manager axes */}
        {evalAxes && (
          <TestResults
            title="Reviewer feedback"
            verdict={evalAxes.verdict}
            overallScore={evalAxes.overall_score}
            tests={evalAxes.axes.map((a) => ({
              name: a.name,
              status: axisStatus(a.score),
              score: a.score,
              maxScore: 10,
              message: a.issues?.[0] ?? a.suggestions?.[0],
            }))}
          />
        )}

        {/* TERMINAL — always visible during a run, even when the DO isn't
            delivering raw stream lines. effectiveLog falls back to a
            narrated log built from structured events. */}
        {(isRunning || effectiveLog.length > 0) && (
          <Terminal lines={effectiveLog} title="Live log" />
        )}

        {/* ARTIFACT */}
        {finalCard && (
          <Artifact className="min-h-[60vh]">
            <ArtifactHeader>
              <ArtifactTitle>your profile · @{finalCard.handle}</ArtifactTitle>
              {card && (
                <a
                  href={`/p/${finalCard.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  open public view ↗
                </a>
              )}
            </ArtifactHeader>
            <ArtifactContent className="bg-[#FAFAF7]">
              <ProfileCardView
                card={finalCard}
                chrome={false}
                onClaimClick={onClaimClick}
                highlightClaimId={highlightClaimId}
              />
            </ArtifactContent>
          </Artifact>
        )}
      </div>
    </div>
  );
}

function axisStatus(score: number): TestStatus {
  if (score >= 8) return "pass";
  if (score >= 5) return "warn";
  return "fail";
}

// ─── Event projections ─────────────────────────────────────────────

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
    if (e.kind === "stage-start" && e.stage && e.stage in PHASE_COPY) {
      if (!byStage.has(e.stage)) {
        stageOrder.push(e.stage);
        byStage.set(e.stage, {
          title: PHASE_COPY[e.stage as keyof typeof PHASE_COPY].activity,
          chips: [],
          done: false,
        });
      }
    }
    if (e.kind === "stage-end" && e.stage && byStage.has(e.stage)) {
      const row = byStage.get(e.stage)!;
      row.done = true;
      row.title = PHASE_COPY[e.stage as keyof typeof PHASE_COPY].done;
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
            const host = safeHost(u);
            row.chips.push({
              id: `${env.id}-${row.chips.length}`,
              label: host,
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

function buildReasoningBlock(
  envelopes: ScanEventEnvelope[],
): { text: string; label: string; done: boolean } {
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
  return {
    text: parts.join("\n\n"),
    label,
    done,
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
    const prior =
      byWorker.get(e.worker) ?? {
        status: "pending" as ToolStatus,
      };
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

function buildQueue(
  phases: ReturnType<typeof projectPhases>,
): {
  running: QueueRow[];
  upNext: QueueRow[];
  done: QueueRow[];
} {
  const running: QueueRow[] = [];
  const upNext: QueueRow[] = [];
  const done: QueueRow[] = [];

  for (const p of phases) {
    const copy = (PHASE_COPY as Record<
      string,
      { title: string; activity: string; done: string }
    >)[p.phase];
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
  return {
    running,
    upNext: upNext.slice(0, 4),
    done: done.reverse(),
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Build narrated log lines from the structured event stream so the
 * Live log panel is never empty, even when the realtime DO can't
 * deliver raw pipeline output (publisher misconfig, mobile proxy,
 * etc.). Timestamps are derived from `env.at`, formatted HH:mm:ss.
 */
function synthLogLines(envelopes: ScanEventEnvelope[]): string[] {
  const out: string[] = [];
  for (const env of envelopes) {
    const t = fmtTime(env.at);
    const e = env.event;
    if (e.kind === "stage-start" && e.stage) {
      const copy = (PHASE_COPY as Record<string, { activity: string; done: string; title: string }>)[e.stage];
      out.push(`[${t}] info  ${copy?.title ?? e.stage} starting…`);
      if (copy?.activity) out.push(`[${t}]         ${copy.activity}`);
    } else if (e.kind === "stage-end" && e.stage) {
      const copy = (PHASE_COPY as Record<string, { activity: string; done: string; title: string }>)[e.stage];
      const dur = e.duration_ms ? ` ${Math.round(e.duration_ms / 100) / 10}s` : "";
      out.push(`[${t}] ok    ${copy?.done ?? e.stage} done${dur}${e.detail ? ` · ${e.detail}` : ""}`);
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
      // Truncate long reasoning bodies so the terminal stays skimmable.
      const txt = e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text;
      out.push(`[${t}] think  ${humanizeAgent(e.agent)}: ${txt}`);
    } else if (e.kind === "error") {
      out.push(`[${t}] error  ${e.stage ? `${e.stage}: ` : ""}${e.message}`);
    } else if (e.kind === "usage") {
      out.push(
        `[${t}] usage  ${e.llm_calls} calls · ${(e.total_tokens).toLocaleString()} tokens`,
      );
    } else if (e.kind === "plan") {
      out.push(`[${t}] plan   ${e.title}${e.description ? ` — ${e.description}` : ""}`);
    } else if (e.kind === "test-result") {
      const s = e.status === "pass" ? "ok" : e.status === "fail" ? "error" : "warn";
      out.push(`[${t}] ${s.padEnd(6)} ${e.agent} · ${e.name}${e.detail ? ` — ${e.detail}` : ""}`);
    }
  }
  return out;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
