"use client";

import * as React from "react";
import type { ScanEventEnvelope } from "@gitshow/shared/events";
import { PIPELINE_PHASES, type PipelinePhase } from "@gitshow/shared/events";
import {
  estimateRemainingMs,
  formatDuration,
  progressPercent,
} from "@gitshow/shared/eta";
import { Plan } from "@/components/ai-elements/plan";
import { Task, TaskItem } from "@/components/ai-elements/task";
import { Terminal } from "@/components/ai-elements/terminal";
import { TestResults, type TestStatus } from "@/components/ai-elements/test-results";
import { CostPill, EtaPill, HudPill } from "@/components/ai-elements/context";
import { Artifact, ArtifactContent, ArtifactHeader, ArtifactTitle } from "@/components/ai-elements/artifact";
import { ProfileCardView } from "@/components/scan/profile-card";
import {
  projectPhases,
  currentPhase,
  latestUsage,
  latestEvalAxes,
} from "@/lib/use-scan-stream";
import type { ScanRow } from "@/lib/scans";
import type { ProfileCard, CardClaim } from "@gitshow/shared/schemas";
import { Activity, Terminal as TerminalIcon, Sparkles } from "lucide-react";

/**
 * Right pane. Renders one of four states depending on scan status:
 *
 *   1. queued / running → Plan at top, Task stack in middle, Terminal
 *      collapsed at bottom, Artifact (live card preview) at the very
 *      bottom when any claims exist yet.
 *   2. succeeded        → Artifact full-height, Plan + Tasks collapsed
 *      into a "scan history" drawer.
 *   3. failed           → Tasks stack with the failing phase red,
 *      error banner at top.
 *   4. (special) revise in flight → Plan morphs into "Reframing hook"
 *      (handled by parent passing a revisePending prop).
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
  /** Partial card synthesized from incremental claims during a running scan. */
  partialCard: ProfileCard | null;
  /** Final card from R2 once succeeded. */
  card: ProfileCard | null;
  highlightClaimId?: string | null;
  onClaimClick?: (claimId: string, beat: CardClaim["beat"]) => void;
  revisePending?: { title: string; etaMs?: number } | null;
}) {
  const phases = React.useMemo(
    () => projectPhases(envelopes, PIPELINE_PHASES),
    [envelopes],
  );
  const cur = currentPhase(phases);
  const lastCompleted = React.useMemo(() => {
    const done = phases.filter((p) => p.status === "done");
    return (done[done.length - 1]?.phase ?? null) as PipelinePhase | null;
  }, [phases]);
  const remaining = estimateRemainingMs(
    lastCompleted,
    (cur?.phase ?? null) as PipelinePhase | null,
  );
  const progress = progressPercent(
    lastCompleted,
    (cur?.phase ?? null) as PipelinePhase | null,
  );

  const usage = latestUsage(envelopes);
  const evalAxes = latestEvalAxes(envelopes);

  const [terminalOpen, setTerminalOpen] = React.useState(false);

  const finalCard = card ?? partialCard;
  const isRunning = scan.status === "running" || scan.status === "queued";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* HUD */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 overflow-x-auto">
        {isRunning && cur && (
          <HudPill
            icon={<Sparkles />}
            label="phase"
            value={cur.phase}
          />
        )}
        <CostPill
          costCents={usage?.cost_cents ?? scan.cost_cents}
          llmCalls={usage?.llm_calls ?? scan.llm_calls}
        />
        {isRunning && <EtaPill etaMs={remaining} />}
        {scan.hiring_verdict && (
          <HudPill
            icon={<Activity />}
            label="verdict"
            value={`${scan.hiring_verdict} ${scan.hiring_score ?? "—"}/100`}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Plan card */}
        {revisePending ? (
          <Plan
            title={revisePending.title}
            description="The pipeline is running a single-beat regenerator. The artifact will update when it lands."
            eta={revisePending.etaMs ? formatDuration(revisePending.etaMs) : undefined}
            isStreaming
          />
        ) : isRunning ? (
          <Plan
            title={
              cur
                ? `Running · ${cur.phase}`
                : scan.status === "queued"
                  ? "Queued — spinning up machine"
                  : "Starting pipeline"
            }
            description={`About ${formatDuration(remaining)} remaining · ${progress}% complete`}
            eta={formatDuration(remaining)}
            isStreaming
          />
        ) : scan.status === "succeeded" ? (
          <Plan
            title="Scan complete"
            description={`${usage?.llm_calls ?? scan.llm_calls} LLM calls · $${((usage?.cost_cents ?? scan.cost_cents) / 100).toFixed(2)} · click any claim in the artifact to revise`}
          />
        ) : (
          <Plan
            title="Scan failed"
            description={scan.error ?? "The pipeline failed. Review the phase log below."}
          />
        )}

        {/* Task list */}
        {isRunning && (
          <section className="space-y-2">
            {phases.map((p) => (
              <Task
                key={p.phase}
                status={p.status}
                title={p.phase}
                subtitle={p.detail}
                defaultOpen={p.status === "running" || p.status === "warn" || p.status === "failed"}
                rightSlot={
                  p.duration_ms ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatDuration(p.duration_ms)}
                    </span>
                  ) : null
                }
              >
                {p.workers.length > 0 && (
                  <div className="space-y-0.5">
                    {p.workers.map((w) => (
                      <TaskItem
                        key={w.name}
                        status={
                          w.status === "running"
                            ? "running"
                            : w.status === "done"
                              ? "done"
                              : "failed"
                        }
                      >
                        <span className="text-foreground/80">{w.name}</span>
                        {w.detail && (
                          <span className="ml-2 text-muted-foreground">· {w.detail}</span>
                        )}
                      </TaskItem>
                    ))}
                  </div>
                )}
                {p.warnings.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {p.warnings.map((w, i) => (
                      <TaskItem key={i} status="warn">
                        {w}
                      </TaskItem>
                    ))}
                  </div>
                )}
              </Task>
            ))}
          </section>
        )}

        {/* Evaluator TestResults */}
        {evalAxes && (
          <TestResults
            title={`Hiring-manager eval · round ${evalAxes.round}`}
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

        {/* Terminal drawer */}
        {isRunning && (
          <div>
            <button
              type="button"
              onClick={() => setTerminalOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <TerminalIcon className="size-3" />
              {terminalOpen ? "hide log" : "show raw log"}
            </button>
            {terminalOpen && (
              <div className="mt-2">
                <Terminal lines={terminalLines} />
              </div>
            )}
          </div>
        )}

        {/* Artifact — live or final */}
        {finalCard && (
          <Artifact className="min-h-[60vh]">
            <ArtifactHeader>
              <ArtifactTitle>
                profile · @{finalCard.handle}
              </ArtifactTitle>
              {card && (
                <a
                  href={`/p/${finalCard.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  open ↗
                </a>
              )}
            </ArtifactHeader>
            <ArtifactContent className="bg-[var(--color-background)]">
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
