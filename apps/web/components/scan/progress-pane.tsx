"use client";

import * as React from "react";
import type { ScanEventEnvelope } from "@gitshow/shared/events";
import { HudPill } from "@/components/ai-elements/context";
import { AgentProgress } from "@/components/scan/agent-progress";
import { ProfileCardView } from "@/components/scan/profile-card";
import type { ScanRow } from "@/lib/scans";
import type { ProfileCard, CardClaim } from "@gitshow/shared/schemas";
import { Sparkles, AlertCircle } from "lucide-react";

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
          phaseSeed={{
            currentPhase: scan.current_phase,
            lastCompletedPhase: scan.last_completed_phase,
          }}
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
  highlightClaimId,
  onClaimClick,
  envelopes,
  terminalLines,
  editable,
  onClaimEdited,
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
  isPublished?: boolean;
  onPublishedChange?: (next: boolean) => void;
}) {
  const [showProgress, setShowProgress] = React.useState(false);
  const hasProgress = envelopes.length > 0;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#FAFAF7]">
      {/* Header bar — sticky, above the artifact */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/40 bg-[#FAFAF7]/90 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="font-sans text-[13px] font-semibold text-foreground">
            your profile · @{card.handle}
          </span>
          {scan.hiring_verdict && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
              reviewer · {scan.hiring_verdict} {scan.hiring_score ?? "—"}/100
            </span>
          )}
          {editable && (
            <span className="font-mono text-[10px] text-slate-500">
              · click anything to edit
            </span>
          )}
        </div>
        <PublishControl
          scanId={scan.id}
          handle={card.handle}
          isPublished={isPublished ?? false}
          onPublishedChange={onPublishedChange}
        />
      </div>

      {/* Card scroll container */}
      <div className="flex-1 overflow-y-auto">
        <ProfileCardView
          card={card}
          chrome={false}
          onClaimClick={onClaimClick}
          highlightClaimId={highlightClaimId}
          editable={editable}
          onClaimEdited={onClaimEdited}
        />
        {hasProgress ? (
          <div className="mx-auto max-w-[880px] px-7 pb-24">
            <div className="mt-4 rounded-xl border border-slate-200 bg-white/60 p-4">
              <button
                type="button"
                onClick={() => setShowProgress((v) => !v)}
                className="group flex w-full items-center gap-2 text-left"
                aria-expanded={showProgress}
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-700 group-hover:text-slate-900">
                  {showProgress ? "Hide" : "Show"} scan history
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  · {envelopes.length} events
                </span>
                <span
                  className={`ml-auto font-mono text-[11px] text-slate-500 transition-transform duration-200 ${
                    showProgress ? "rotate-90" : ""
                  }`}
                >
                  ▸
                </span>
              </button>
              {showProgress ? (
                <div className="mt-4 rounded-lg bg-[#0F172A] p-4 text-slate-100">
                  <AgentProgress
                    envelopes={envelopes}
                    terminalLines={terminalLines}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
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
        className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-3 py-1.5 font-mono text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Publishing…" : "Publish"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href={`/${handle}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600/10 px-3 py-1.5 font-mono text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-600/15"
      >
        Published · gitshow.io/{handle} ↗
      </a>
      <button
        type="button"
        onClick={unpublish}
        disabled={busy}
        className="font-mono text-[10px] text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline disabled:opacity-60"
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
