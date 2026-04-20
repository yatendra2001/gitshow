"use client";

import * as React from "react";
import type { ScanEventEnvelope } from "@gitshow/shared/events";
import { HudPill } from "@/components/ai-elements/context";
import {
  Artifact,
  ArtifactContent,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { AgentProgress } from "@/components/scan/agent-progress";
import { ProfileCardView } from "@/components/scan/profile-card";
import type { ScanRow } from "@/lib/scans";
import type { ProfileCard, CardClaim } from "@gitshow/shared/schemas";
import { Activity as ActivityIcon, Sparkles, AlertCircle } from "lucide-react";

/**
 * Right pane. Three hard states, picked off scan.status:
 *
 *   running / queued → full agent-progress stack, no artifact yet
 *   succeeded        → artifact only (profile card). Revise progress
 *                      lives inline in the chat pane — it doesn't
 *                      belong on the right once the user is iterating.
 *   failed           → a single error card, retry link to the dashboard
 *
 * This keeps each state's right-pane job obvious: the first build is a
 * spectacle, the finished profile is a document, the failure is a
 * cul-de-sac.
 */
export function ProgressPane({
  scan,
  envelopes,
  terminalLines,
  partialCard,
  card,
  highlightClaimId,
  onClaimClick,
  connection = "idle",
  isDone = false,
}: {
  scan: ScanRow;
  envelopes: ScanEventEnvelope[];
  terminalLines: string[];
  partialCard: ProfileCard | null;
  card: ProfileCard | null;
  highlightClaimId?: string | null;
  onClaimClick?: (claimId: string, beat: CardClaim["beat"]) => void;
  connection?: import("@/lib/use-scan-stream").StreamConnection;
  isDone?: boolean;
}) {
  const finalCard = card ?? partialCard;

  if (scan.status === "running" || scan.status === "queued") {
    return (
      <RunningView
        scan={scan}
        envelopes={envelopes}
        terminalLines={terminalLines}
        connection={connection}
        isDone={isDone}
      />
    );
  }

  if (scan.status === "succeeded" && finalCard) {
    return (
      <SucceededView
        scan={scan}
        card={finalCard}
        isLive={!!card}
        highlightClaimId={highlightClaimId}
        onClaimClick={onClaimClick}
        envelopes={envelopes}
        terminalLines={terminalLines}
      />
    );
  }

  if (scan.status === "failed") {
    return <FailedView scan={scan} />;
  }

  // Succeeded but card hasn't loaded yet — show a soft loading state.
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading your profile…
    </div>
  );
}

// ─── Running state — the show ───────────────────────────────────────

function RunningView({
  scan,
  envelopes,
  terminalLines,
  connection,
  isDone,
}: {
  scan: ScanRow;
  envelopes: ScanEventEnvelope[];
  terminalLines: string[];
  connection: import("@/lib/use-scan-stream").StreamConnection;
  isDone: boolean;
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <span className="gs-noise" aria-hidden />

      <div className="flex items-center gap-2 overflow-x-auto border-b border-border/80 px-5 py-2.5 backdrop-blur-sm">
        <HudPill
          icon={<Sparkles />}
          label="status"
          value={scan.status === "queued" ? "Warming up" : "Building your profile"}
        />
        <ConnectionPill connection={connection} isDone={isDone} />
        <LiveTicker envelopes={envelopes} connection={connection} />
      </div>

      <div className="gs-pane-scroll relative flex-1 overflow-y-auto px-5 py-5">
        <AgentProgress
          envelopes={envelopes}
          terminalLines={terminalLines}
          planStreaming
        />
      </div>
    </div>
  );
}

/**
 * Small visible indicator that the WS is (or isn't) delivering events.
 * Silent during healthy `live`; shouts during `reconnecting` / `lost`.
 */
function ConnectionPill({
  connection,
  isDone,
}: {
  connection: import("@/lib/use-scan-stream").StreamConnection;
  isDone: boolean;
}) {
  if (isDone) return null;
  if (connection === "live" || connection === "idle") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-[var(--chart-3)] gs-pulse" />
        live
      </span>
    );
  }
  if (connection === "reconnecting") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--chart-4)]/40 bg-[var(--chart-4)]/[0.05] px-2 py-0.5 font-mono text-[10px] text-[var(--chart-4)]">
        <span className="size-1.5 rounded-full bg-[var(--chart-4)] gs-pulse" />
        reconnecting
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--destructive)]/40 bg-[var(--destructive)]/[0.05] px-2 py-0.5 font-mono text-[10px] text-[var(--destructive)]">
      <span className="size-1.5 rounded-full bg-[var(--destructive)]" />
      connection lost
    </span>
  );
}

/**
 * Renders "last event Xs ago" so users can see events ARE flowing even
 * during a long LLM reasoning chunk where the phase list looks static.
 * Ticks every second; resets on any new envelope.
 */
function LiveTicker({
  envelopes,
  connection,
}: {
  envelopes: ScanEventEnvelope[];
  connection: import("@/lib/use-scan-stream").StreamConnection;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const lastAt = envelopes.length > 0
    ? Math.max(...envelopes.map((e) => e.at))
    : 0;
  if (lastAt === 0) return null;
  const ago = Math.max(0, Math.floor((now - lastAt) / 1000));
  const stale = connection === "live" && ago > 30;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] ${
        stale
          ? "border-[var(--chart-4)]/30 bg-[var(--chart-4)]/[0.04] text-[var(--chart-4)]"
          : "border-border/50 bg-background/40 text-muted-foreground"
      }`}
    >
      last event {ago < 1 ? "just now" : `${ago}s ago`}
    </span>
  );
}

// ─── Succeeded state — the document ────────────────────────────────

function SucceededView({
  scan,
  card,
  isLive,
  highlightClaimId,
  onClaimClick,
  envelopes,
  terminalLines,
}: {
  scan: ScanRow;
  card: ProfileCard;
  isLive: boolean;
  highlightClaimId?: string | null;
  onClaimClick?: (claimId: string, beat: CardClaim["beat"]) => void;
  envelopes: ScanEventEnvelope[];
  terminalLines: string[];
}) {
  const [showProgress, setShowProgress] = React.useState(false);
  const hasProgress = envelopes.length > 0;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <Artifact className="flex-1 rounded-none border-0">
        <ArtifactHeader>
          <ArtifactTitle>your profile · @{card.handle}</ArtifactTitle>
          <div className="flex items-center gap-3">
            {scan.hiring_verdict && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                reviewer · {scan.hiring_verdict} {scan.hiring_score ?? "—"}/100
              </span>
            )}
            {isLive && (
              <a
                href={`/${card.handle}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                open public view ↗
              </a>
            )}
          </div>
        </ArtifactHeader>
        <ArtifactContent className="bg-[#FAFAF7]">
          <ProfileCardView
            card={card}
            chrome={false}
            onClaimClick={onClaimClick}
            highlightClaimId={highlightClaimId}
          />
          {hasProgress ? (
            <div className="mt-10 border-t border-border/30 pt-6">
              <button
                type="button"
                onClick={() => setShowProgress((v) => !v)}
                className="group flex w-full items-center gap-2 text-left"
                aria-expanded={showProgress}
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80 group-hover:text-foreground transition-colors">
                  {showProgress ? "Hide" : "Show"} scan history
                </span>
                <span className="text-[11px] text-muted-foreground/60">
                  · {envelopes.length} events
                </span>
                <span
                  className={`ml-auto font-mono text-[11px] text-muted-foreground/60 transition-transform duration-200 ${
                    showProgress ? "rotate-90" : ""
                  }`}
                >
                  ▸
                </span>
              </button>
              {showProgress ? (
                <div className="mt-4">
                  <AgentProgress
                    envelopes={envelopes}
                    terminalLines={terminalLines}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </ArtifactContent>
      </Artifact>
    </div>
  );
}

// ─── Failed state ──────────────────────────────────────────────────

function FailedView({ scan }: { scan: ScanRow }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertCircle className="mx-auto mb-3 size-6 text-destructive" />
        <h2 className="mb-2 text-lg font-semibold text-foreground">
          This build didn't land
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          {scan.error ?? "Something went wrong inside the pipeline."}
        </p>
        <a
          href="/dashboard"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/30"
        >
          Back to your scans
        </a>
      </div>
    </div>
  );
}
