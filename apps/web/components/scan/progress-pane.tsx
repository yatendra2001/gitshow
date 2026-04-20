"use client";

import * as React from "react";
import type { ScanEventEnvelope } from "@gitshow/shared/events";
import { PIPELINE_PHASES } from "@gitshow/shared/events";
import { PHASE_COPY } from "@/lib/phase-copy";
import { AgentProgress } from "@/components/scan/agent-progress";
import { ProfileCardView } from "@/components/scan/profile-card";
import type { ScanRow } from "@/lib/scans";
import type { ProfileCard, CardClaim } from "@gitshow/shared/schemas";
import { Sparkles, AlertCircle, Pencil, ExternalLink, Check } from "lucide-react";

/**
 * Right pane. Three hard states, picked off scan.status:
 *
 *   running / queued → full agent-progress stack, no artifact yet
 *   succeeded        → profile card with inline-edit claims + Publish
 *                      button (top-right). Scan history is hidden
 *                      behind a collapsed "developer" toggle.
 *   failed           → a single error card, retry link to the dashboard
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
  editable = false,
  onClaimEdited,
  onClaimRemoved,
  isPublished = false,
  onPublishedChange,
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
  editable?: boolean;
  onClaimEdited?: (claimId: string, nextText: string) => void;
  onClaimRemoved?: (claimId: string) => void;
  isPublished?: boolean;
  onPublishedChange?: (next: boolean) => void;
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
        highlightClaimId={highlightClaimId}
        onClaimClick={onClaimClick}
        envelopes={envelopes}
        terminalLines={terminalLines}
        editable={editable}
        onClaimEdited={onClaimEdited}
        onClaimRemoved={onClaimRemoved}
        isPublished={isPublished}
        onPublishedChange={onPublishedChange}
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
  const totalPhases = PIPELINE_PHASES.length;
  // Done-phase count from envelopes (stage-end); falls back to the
  // seeded last_completed_phase so the bar paints before events arrive.
  const doneFromEvents = envelopes.filter(
    (e) => e.event.kind === "stage-end" && "stage" in e.event,
  ).length;
  const seedDoneIdx = scan.last_completed_phase
    ? PIPELINE_PHASES.indexOf(
        scan.last_completed_phase as (typeof PIPELINE_PHASES)[number],
      ) + 1
    : 0;
  const doneCount = Math.max(doneFromEvents, seedDoneIdx);
  const percent = Math.min(99, Math.round((doneCount / totalPhases) * 100));

  const currentLabel =
    scan.current_phase && (PHASE_COPY as Record<string, { title: string }>)[scan.current_phase]
      ? (PHASE_COPY as Record<string, { title: string }>)[scan.current_phase]!.title
      : scan.status === "queued"
        ? "Warming up"
        : "Building your profile";

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <span className="gs-noise" aria-hidden />

      {/* Sticky header — gradient avatar, live status line, connection pills */}
      <div className="sticky top-0 z-20 border-b border-border/50 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[920px] items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card text-foreground">
              <Sparkles className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-sans text-[14px] font-semibold text-foreground">
                Building @{scan.handle}'s profile
              </span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {currentLabel} · {percent}%
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ConnectionPill connection={connection} isDone={isDone} />
            <LiveTicker envelopes={envelopes} connection={connection} />
          </div>
        </div>
        {/* Thin progress bar across the whole header. Accent-colored so
            it's clearly a loading indicator even on white/cream. A
            shimmer sweep on top of the filled portion sells "live"
            without adding a gradient to the base color. */}
        <div className="relative h-[3px] w-full overflow-hidden bg-border/30">
          <div
            className="absolute inset-y-0 left-0 bg-[var(--chart-1)] transition-[width] duration-700 ease-out"
            style={{ width: `${percent}%` }}
          >
            <span className="gs-progress-shimmer absolute inset-0" aria-hidden />
          </div>
        </div>
      </div>

      <div className="gs-pane-scroll relative flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[920px] px-6 py-6">
          <AgentProgress
            envelopes={envelopes}
            terminalLines={terminalLines}
            planStreaming
            phaseSeed={{
              currentPhase: scan.current_phase,
              lastCompletedPhase: scan.last_completed_phase,
            }}
          />
        </div>
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
  highlightClaimId,
  onClaimClick,
  editable,
  onClaimEdited,
  onClaimRemoved,
  isPublished,
  onPublishedChange,
}: {
  scan: ScanRow;
  card: ProfileCard;
  highlightClaimId?: string | null;
  onClaimClick?: (claimId: string, beat: CardClaim["beat"]) => void;
  envelopes: ScanEventEnvelope[];
  terminalLines: string[];
  editable?: boolean;
  onClaimEdited?: (claimId: string, nextText: string) => void;
  onClaimRemoved?: (claimId: string) => void;
  isPublished?: boolean;
  onPublishedChange?: (next: boolean) => void;
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#FAFAF7]">
      {/* Header bar — sticky, above the artifact */}
      <div className="sticky top-0 z-30 border-b border-slate-200/80 bg-[#FAFAF7]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[920px] items-center justify-between gap-3 px-6 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 font-mono text-[11px] font-bold text-white">
              {card.handle.slice(0, 2).toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-sans text-[13.5px] font-semibold text-slate-900">
                @{card.handle}'s profile
              </span>
              <div className="flex items-center gap-2 font-mono text-[10px] text-slate-500">
                {scan.hiring_verdict && (
                  <span className="uppercase tracking-wider">
                    reviewer · {scan.hiring_verdict} {scan.hiring_score ?? "—"}/100
                  </span>
                )}
                {editable && (
                  <>
                    {scan.hiring_verdict && <span className="text-slate-300">·</span>}
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <Pencil className="size-2.5" /> click anything to edit
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <PublishControl
            scanId={scan.id}
            handle={card.handle}
            isPublished={isPublished ?? false}
            onPublishedChange={onPublishedChange}
          />
        </div>
      </div>

      {/* Card scroll container — scan history intentionally removed
          from the finished profile. The rendered profile should read
          as a final document; process details live on /app under
          "See scan details" for anyone who wants them. */}
      <div className="flex-1 overflow-y-auto">
        <ProfileCardView
          card={card}
          chrome={false}
          onClaimClick={onClaimClick}
          highlightClaimId={highlightClaimId}
          editable={editable}
          onClaimEdited={onClaimEdited}
          onClaimRemoved={onClaimRemoved}
        />
      </div>
    </div>
  );
}

/**
 * Publish / Unpublish button in the top-right. Starts from the SSR
 * snapshot of `isPublished`; toggles via POST/DELETE /api/profile/publish.
 *
 * States:
 *   - draft    → primary "Publish" button
 *   - published → "Published · gitshow.io/<handle> ↗" + tiny "Unpublish"
 */
function PublishControl({
  scanId,
  handle,
  isPublished,
  onPublishedChange,
}: {
  scanId: string;
  handle: string;
  isPublished: boolean;
  onPublishedChange?: (next: boolean) => void;
}) {
  const [busy, setBusy] = React.useState(false);

  const publish = async () => {
    setBusy(true);
    try {
      const resp = await fetch("/api/profile/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body.slice(0, 200));
      }
      onPublishedChange?.(true);
    } catch (err) {
      alert(`Publish failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    if (!confirm("Unpublish? Your public page at gitshow.io/" + handle + " will 404.")) {
      return;
    }
    setBusy(true);
    try {
      const resp = await fetch("/api/profile/publish", { method: "DELETE" });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body.slice(0, 200));
      }
      onPublishedChange?.(false);
    } catch (err) {
      alert(`Unpublish failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  };

  if (!isPublished) {
    return (
      <button
        type="button"
        onClick={publish}
        disabled={busy}
        className="group inline-flex shrink-0 items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 font-sans text-[13px] font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-px hover:bg-slate-800 hover:shadow-md active:translate-y-0 disabled:opacity-60 disabled:hover:translate-y-0"
      >
        {busy ? (
          <>
            <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span>Publishing…</span>
          </>
        ) : (
          <>
            <Sparkles className="size-3.5 transition-transform group-hover:rotate-12" />
            <span>Publish</span>
          </>
        )}
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <a
        href={`/${handle}`}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-[11px] font-medium text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-100"
      >
        <Check className="size-3.5 text-emerald-600" />
        <span>
          gitshow.io/<span className="font-semibold">{handle}</span>
        </span>
        <ExternalLink className="size-3 text-emerald-600/70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </a>
      <button
        type="button"
        onClick={unpublish}
        disabled={busy}
        className="font-mono text-[10px] text-slate-500 underline-offset-2 transition-colors hover:text-slate-900 hover:underline disabled:opacity-60"
      >
        {busy ? "…" : "Unpublish"}
      </button>
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
