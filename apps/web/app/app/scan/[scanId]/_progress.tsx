"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * Live scan progress viewer.
 *
 * Polls `/api/scan/status/{scanId}` every 2s while the scan is
 * running. Server-rendered initial state keeps the first paint
 * informative (no "loading…" spinner). When the scan hits a terminal
 * state (succeeded/failed/cancelled) we stop polling and show the
 * appropriate CTA.
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
}

interface EventRow {
  id: number;
  kind: string;
  stage: string | null;
  worker: string | null;
  status: string | null;
  duration_ms: number | null;
  message: string | null;
  at: number;
}

const POLL_MS = 2000;

const PHASE_COPY: Record<string, string> = {
  "github-fetch": "Reading your GitHub",
  "repo-filter": "Picking which repos matter",
  inventory: "Studying your top repos",
  normalize: "Organising the pieces",
  discover: "Spotting what's distinctive",
  "section-agents": "Crafting your portfolio sections",
  "resume:person": "Writing your hero + about",
  "resume:skills": "Curating your skills",
  "resume:build-log": "Summarising every repo",
  "resume:work": "Reconstructing work history",
  "resume:education": "Reconstructing education",
  "resume:blog-import": "Importing your blog posts",
  "resume:projects": "Deep-researching featured projects",
  assemble: "Putting it all together",
  persist: "Saving your draft",
  resume: "Finalising the resume",
};

/**
 * Ordered phase progression — used to compute a rough % complete for the
 * progress bar. Parallel sub-phases live under "section-agents" and don't
 * need their own bucket here.
 */
const PHASE_ORDER = [
  "github-fetch",
  "repo-filter",
  "inventory",
  "normalize",
  "discover",
  "section-agents",
  "resume:person",
  "assemble",
  "persist",
];

function phaseLabel(phase: string | null | undefined): string {
  if (!phase) return "Getting set up";
  if (PHASE_COPY[phase]) return PHASE_COPY[phase]!;
  // Fall back to turning resume:project:flightcast → "flightcast"
  const parts = phase.split(":");
  return parts[parts.length - 1]!.replace(/[-_]/g, " ");
}

function progressPercent(scan: ScanState): number {
  if (scan.status === "succeeded") return 100;
  if (scan.status === "failed" || scan.status === "cancelled") return 0;
  const current = scan.current_phase ?? scan.last_completed_phase;
  const idx = current ? PHASE_ORDER.indexOf(current) : -1;
  if (idx < 0) return 4; // show a sliver so the bar isn't empty at "queued"
  // +1 if this phase is mid-flight, halfway between steps
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
    // Drive the "elapsed" counter every second without needing to
    // re-poll the API for that alone.
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
          {titleForStatus(scan)}
        </h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
          <span>
            <span className="font-mono text-foreground">@{scan.handle}</span>
          </span>
          <span>
            Elapsed <span className="text-foreground font-mono">{elapsed}</span>
          </span>
        </div>
        {scan.status === "running" || scan.status === "queued" ? (
          <ProgressBar percent={progressPercent(scan)} />
        ) : null}
      </section>

      {scan.status === "succeeded" ? (
        <CompletedCta scanId={scanId} onRefresh={() => router.refresh()} />
      ) : null}

      {scan.status === "failed" ? (
        <FailedCard error={scan.error} />
      ) : null}

      {scan.status === "cancelled" ? (
        <CancelledCard />
      ) : null}

      <EventLog events={events} />
    </div>
  );
}

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

function CompletedCta({
  scanId,
  onRefresh,
}: {
  scanId: string;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/40 p-5 flex flex-col gap-3">
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
      <span className="text-[11px] text-muted-foreground font-mono">
        scan id: {scanId}
      </span>
    </div>
  );
}

function FailedCard({ error }: { error: string | null }) {
  return (
    <div className="rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/[0.04] p-5 flex flex-col gap-3">
      <div className="text-[13px] font-medium">
        The pipeline hit a snag.
      </div>
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
    <div className="rounded-2xl border border-border/40 bg-card/30 p-5 text-[13px] text-muted-foreground">
      Scan was cancelled.
    </div>
  );
}

function EventLog({ events }: { events: EventRow[] }) {
  // Events arrive newest-last from the server; render bottom-up so the
  // latest sits at the top.
  const ordered = useMemo(() => [...events].reverse(), [events]);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">Log</h2>
        <span className="text-[11px] text-muted-foreground">
          {events.length} event{events.length === 1 ? "" : "s"}
        </span>
      </div>
      {ordered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/40 p-4 text-[12px] text-muted-foreground text-center">
          Waiting for the first event…
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5 max-h-[60vh] overflow-auto pr-1">
          {ordered.map((ev) => (
            <EventRowView key={ev.id} ev={ev} />
          ))}
        </ol>
      )}
    </section>
  );
}

function EventRowView({ ev }: { ev: EventRow }) {
  const tone =
    ev.kind === "error"
      ? "text-[var(--destructive)]"
      : ev.kind === "stage-warn"
        ? "text-amber-500"
        : ev.kind === "stage-end"
          ? "text-emerald-500"
          : "text-muted-foreground";
  const label =
    ev.stage ||
    ev.worker ||
    ev.kind;
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/30 bg-card/20 px-3 py-2 text-[12px]">
      <span className="font-mono tabular-nums text-muted-foreground/70 w-14 shrink-0">
        {formatClock(ev.at)}
      </span>
      <span className={cn("font-mono uppercase text-[10px] tracking-wide w-20 shrink-0", tone)}>
        {ev.kind}
      </span>
      <span className="flex-1 min-w-0">
        <span className="text-foreground font-medium">{label}</span>
        {ev.message ? (
          <span className="text-muted-foreground"> — {ev.message}</span>
        ) : null}
        {ev.duration_ms ? (
          <span className="ml-2 text-muted-foreground/70 tabular-nums">
            {formatDuration(ev.duration_ms)}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
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
