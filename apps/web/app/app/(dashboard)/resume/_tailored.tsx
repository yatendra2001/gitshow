"use client";

/**
 * Tailored-resume UI module — three pieces of the JD-tailor flow:
 *
 *   <TailoredVersionsSection> — section in the editor's left pane that
 *     lists past tailored resumes and opens the tailor dialog. Acts as
 *     the controller for both the dialog and the per-row viewer.
 *
 *   <TailorDialog> — modal that takes a job description, streams the
 *     tailored resume from the AI, and writes it to R2 on success.
 *     Mirrors the empty-state streaming theatre, scoped to a dialog.
 *
 *   <TailoredViewerDialog> — opens when the user clicks a saved row.
 *     Renders the printable resume at scaled-down preview size, with
 *     Download-PDF / Delete actions in the footer.
 *
 * All three are colocated because they share state (the list, the
 * "what's open" coordination, the optimistic insert on successful
 * stream) — splitting into separate files would just add prop
 * shuffling. The exported surface is intentionally narrow:
 * <TailoredVersionsSection /> is the only public component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MagicWand01Icon,
  AlertCircleIcon,
  Loading03Icon,
  Tick02Icon,
  Delete02Icon,
  Download04Icon,
  JobSearchIcon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import type { ResumeDoc } from "@gitshow/shared/resume-doc";
import type {
  TailoredResume,
  TailoredResumeMeta,
} from "@gitshow/shared/tailored-resume";
import {
  buildJdExcerpt,
  tailoredDisplayLabel,
} from "@gitshow/shared/tailored-resume";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import { PrintableResume, RESUME_PRINT_CSS } from "@/components/resume/printable";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────
// Streaming CSS shared with the empty-state streamer (gs-shimmer +
// gs-fade-in). Defined locally so the dialog has the same theatre
// without depending on the empty-state component.
// ──────────────────────────────────────────────────────────────

const STREAM_CSS = `
@keyframes gs-tailor-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.gs-tailor-shimmer-bar {
  display: block;
  background: linear-gradient(
    90deg,
    #ececec 0%,
    #f6f6f6 45%,
    #fafafa 50%,
    #f6f6f6 55%,
    #ececec 100%
  );
  background-size: 200% 100%;
  animation: gs-tailor-shimmer 1.6s linear infinite;
  border-radius: 2pt;
}
@keyframes gs-tailor-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.gs-tailor-reveal {
  animation: gs-tailor-fade-in 260ms cubic-bezier(0.2, 0.6, 0.2, 1) both;
}
@keyframes gs-tailor-dot {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.7); }
  40%           { opacity: 1;    transform: scale(1); }
}
.gs-tailor-dot { animation: gs-tailor-dot 1.2s ease-in-out infinite both; }
.gs-tailor-dot:nth-child(2) { animation-delay: 0.15s; }
.gs-tailor-dot:nth-child(3) { animation-delay: 0.3s; }
@media (prefers-reduced-motion: reduce) {
  .gs-tailor-shimmer-bar { animation: none; background: #eee; }
  .gs-tailor-reveal { animation: none; }
  .gs-tailor-dot { animation: none; opacity: 0.6; }
}
`;

// ──────────────────────────────────────────────────────────────
// Section (left pane)
// ──────────────────────────────────────────────────────────────

interface TailoredVersionsSectionProps {
  initialItems: TailoredResumeMeta[];
}

/**
 * The "Tailored versions" section that lives at the top of the left
 * pane in the resume editor. Owns the tailored-list state and the
 * dialog/viewer coordination.
 */
export function TailoredVersionsSection({
  initialItems,
}: TailoredVersionsSectionProps) {
  const [items, setItems] = useState<TailoredResumeMeta[]>(initialItems);
  const [tailorOpen, setTailorOpen] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);

  /** Insert a newly-streamed tailored resume at the top, dedupe by id. */
  const onTailored = useCallback((tailored: TailoredResume) => {
    setItems((prev) => [
      tailored.meta,
      ...prev.filter((it) => it.id !== tailored.meta.id),
    ]);
    setTailorOpen(false);
    setViewerId(tailored.meta.id);
  }, []);

  const onDeleted = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setViewerId(null);
  }, []);

  return (
    <section>
      <header className="flex items-center justify-between mb-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Tailored versions
          {items.length > 0 ? (
            <span className="ml-1.5 text-muted-foreground/60">{items.length}</span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={() => setTailorOpen(true)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md h-7 px-2 text-[11px] font-medium",
            "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
            "transition-[background-color,color] duration-150 ease",
            "min-h-9",
          )}
          aria-label="Tailor resume for a job"
        >
          <HugeiconsIcon icon={MagicWand01Icon} size={12} strokeWidth={2} />
          Tailor for job
        </button>
      </header>

      {items.length === 0 ? (
        <EmptyState onTailor={() => setTailorOpen(true)} />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((meta) => (
            <TailoredRow
              key={meta.id}
              meta={meta}
              onOpen={() => setViewerId(meta.id)}
            />
          ))}
        </ul>
      )}

      <TailorDialog
        open={tailorOpen}
        onOpenChange={setTailorOpen}
        onTailored={onTailored}
      />

      {viewerId ? (
        <TailoredViewerDialog
          id={viewerId}
          open={true}
          onOpenChange={(next) => {
            if (!next) setViewerId(null);
          }}
          onDeleted={onDeleted}
        />
      ) : null}
    </section>
  );
}

function EmptyState({ onTailor }: { onTailor: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border/50 bg-foreground/[0.015] px-3 py-3">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Drop a job description and we&apos;ll spin up a tailored copy of
        your resume — reordered bullets, prioritized projects, JD-aligned
        skills. Your base resume stays untouched.
      </p>
      <button
        type="button"
        onClick={onTailor}
        className={cn(
          "mt-2.5 inline-flex items-center gap-1.5 rounded-md h-8 px-3 text-[12px] font-medium",
          "bg-foreground text-background min-h-9",
          "transition-[opacity] duration-150 ease",
          "hover:opacity-90",
        )}
      >
        <HugeiconsIcon icon={MagicWand01Icon} size={13} strokeWidth={2} />
        Tailor for job
      </button>
    </div>
  );
}

function TailoredRow({
  meta,
  onOpen,
}: {
  meta: TailoredResumeMeta;
  onOpen: () => void;
}) {
  const label = tailoredDisplayLabel(meta);
  const relTime = useRelativeTime(meta.createdAt);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group w-full text-left rounded-lg border border-border/40 bg-foreground/[0.015]",
          "px-3 py-2.5 flex items-start gap-2.5",
          "transition-[background-color,border-color] duration-150 ease",
          "hover:border-border/60 hover:bg-foreground/[0.03]",
          "outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
          "min-h-11",
        )}
        aria-label={`Open tailored resume: ${label}`}
      >
        <HugeiconsIcon
          icon={JobSearchIcon}
          size={14}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-muted-foreground/70 group-hover:text-foreground/80 transition-colors duration-150"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">
              {label}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {relTime}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground/85">
            {meta.jdExcerpt}
          </p>
        </div>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={13}
          strokeWidth={2}
          className="mt-1 shrink-0 text-muted-foreground/40 transition-transform duration-150 ease group-hover:translate-x-0.5 group-hover:text-foreground/70"
        />
      </button>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────
// Tailor dialog
// ──────────────────────────────────────────────────────────────

type TailorPhase = "idle" | "streaming" | "done" | "error";

function TailorDialog({
  open,
  onOpenChange,
  onTailored,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onTailored: (tailored: TailoredResume) => void;
}) {
  const [jd, setJd] = useState("");
  const [phase, setPhase] = useState<TailorPhase>("idle");
  const [statusLabel, setStatusLabel] = useState("Reading the JD");
  const [partial, setPartial] = useState<{
    doc: ResumeDoc | null;
    jobTitle?: string;
    company?: string;
  }>({ doc: null });
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Reset the dialog state when it closes. Keeps the JD draft so the
   *  user doesn't lose their paste if they re-open by accident — but
   *  clear it on a confirmed successful submission. */
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setPhase("idle");
      setPartial({ doc: null });
      setStatusLabel("Reading the JD");
      setErr(null);
    }
  }, [open]);

  const onSubmit = useCallback(async () => {
    const text = jd.trim();
    if (!text) return;
    setPhase("streaming");
    setErr(null);
    setPartial({ doc: null });
    setStatusLabel("Reading the JD");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/resume/tailored/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription: text }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        const data = (await resp.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setErr(data.detail || humanizeError(data.error));
        setPhase("error");
        return;
      }

      type StreamEvent =
        | {
            type: "partial";
            doc: ResumeDoc;
            jobTitle?: string;
            company?: string;
          }
        | { type: "done"; tailored: TailoredResume }
        | { type: "error"; error: string; detail?: string };

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            const evt = JSON.parse(json) as StreamEvent;
            if (evt.type === "partial") {
              setPartial({
                doc: evt.doc,
                jobTitle: evt.jobTitle,
                company: evt.company,
              });
              setStatusLabel(progressLabelFor(evt.doc));
            } else if (evt.type === "done") {
              setStatusLabel("Saving");
              setPhase("done");
              setJd("");
              setTimeout(() => onTailored(evt.tailored), 500);
            } else if (evt.type === "error") {
              setErr(evt.detail || humanizeError(evt.error));
              setPhase("error");
            }
          } catch {
            // Malformed SSE frame — skip silently; next chunk will land.
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErr("Network error");
      setPhase("error");
    }
  }, [jd, onTailored]);

  const isStreaming = phase === "streaming";
  const isBusy = phase === "streaming" || phase === "done";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't allow Esc/overlay-close while streaming so the user
        // doesn't lose 8 seconds of AI work by accident.
        if (isBusy && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showClose={!isBusy}
        className="max-w-2xl gap-3"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={MagicWand01Icon} size={16} strokeWidth={2} />
            Tailor for a job
          </DialogTitle>
          <DialogDescription>
            Paste the full job description. We&apos;ll reorder, rewrite,
            and re-rank — using only the facts already in your base
            resume — to produce a JD-aligned variant. Your main resume
            stays untouched.
          </DialogDescription>
        </DialogHeader>

        {phase === "idle" || phase === "error" ? (
          <IdleForm
            jd={jd}
            setJd={setJd}
            onSubmit={onSubmit}
            error={err}
          />
        ) : (
          <StreamingPreview
            doc={partial.doc}
            statusLabel={statusLabel}
            phase={phase}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function IdleForm({
  jd,
  setJd,
  onSubmit,
  error,
}: {
  jd: string;
  setJd: (v: string) => void;
  onSubmit: () => void;
  error: string | null;
}) {
  const trimmed = jd.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 50;
  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={jd}
        onChange={(e) => setJd(e.target.value)}
        onKeyDown={(e) => {
          // ⌘+Enter / Ctrl+Enter submits — matches Linear's textareas.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && trimmed.length >= 50) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={10}
        placeholder={`Paste the job description here — title, requirements, responsibilities, the whole thing.\n\nExample:\nSenior Backend Engineer at Stripe…\n\nYou'll own…\nRequirements:\n- 5+ years…\n- Distributed systems…`}
        className={cn(
          "min-h-[220px] max-h-[40vh] w-full rounded-lg border border-border/50 bg-background px-3 py-2.5",
          "text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/50",
          "focus:outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10",
          "transition-[border-color,box-shadow] duration-150 ease",
          "resize-y",
        )}
        aria-label="Job description"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground/70 tabular-nums">
          {trimmed.length === 0
            ? "Paste the JD to begin"
            : tooShort
              ? `Add a bit more context — ${trimmed.length}/50 chars`
              : `${trimmed.length.toLocaleString()} chars · ⌘ ↵ to tailor`}
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={trimmed.length < 50}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md h-9 px-3.5 text-[13px] font-medium",
            "bg-foreground text-background min-h-9",
            "transition-[opacity] duration-150 ease",
            "hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          <HugeiconsIcon icon={MagicWand01Icon} size={14} strokeWidth={2} />
          Tailor resume
        </button>
      </div>
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-foreground/15 bg-foreground/[0.04] px-3 py-2 text-[12.5px]"
        >
          <HugeiconsIcon
            icon={AlertCircleIcon}
            size={14}
            strokeWidth={2}
            className="mt-0.5 shrink-0"
          />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

function StreamingPreview({
  doc,
  statusLabel,
  phase,
}: {
  doc: ResumeDoc | null;
  statusLabel: string;
  phase: TailorPhase;
}) {
  const isDone = phase === "done";
  return (
    <div className="flex flex-col gap-3">
      <style dangerouslySetInnerHTML={{ __html: RESUME_PRINT_CSS + STREAM_CSS }} />
      <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-foreground/[0.02] px-3 py-2">
        {isDone ? (
          <HugeiconsIcon
            icon={Tick02Icon}
            size={13}
            strokeWidth={2}
            className="shrink-0"
          />
        ) : (
          <span className="shrink-0 inline-flex items-center gap-1" aria-hidden>
            <span className="gs-tailor-dot inline-block size-1.5 rounded-full bg-foreground/70" />
            <span className="gs-tailor-dot inline-block size-1.5 rounded-full bg-foreground/70" />
            <span className="gs-tailor-dot inline-block size-1.5 rounded-full bg-foreground/70" />
          </span>
        )}
        <span className="text-[12.5px] font-medium tracking-tight">
          {isDone ? "Tailored resume ready" : "Tailoring your resume"}
        </span>
        <span className="text-[12px] text-muted-foreground/80 truncate">
          · {statusLabel}
        </span>
      </div>
      <div className="rounded-lg border border-border/40 bg-foreground/[0.015] dark:bg-foreground/[0.04] p-4 max-h-[50vh] overflow-y-auto gs-pane-scroll flex justify-center">
        <div
          className="origin-top"
          style={{ transform: "scale(0.5)", transformOrigin: "top center" }}
        >
          <div
            key={doc ? "doc" : "placeholder"}
            className="gs-tailor-reveal"
          >
            {doc ? (
              <PrintableResume doc={doc} />
            ) : (
              <TailorPlaceholder />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TailorPlaceholder() {
  return (
    <div
      className="resume-doc"
      style={{
        width: "8.5in",
        minHeight: "11in",
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.08)",
      }}
    >
      <div className="resume-header">
        <div
          className="gs-tailor-shimmer-bar"
          style={{ height: "20pt", width: "60%", margin: "0 auto 4pt" }}
        />
        <div
          className="gs-tailor-shimmer-bar"
          style={{ height: "10pt", width: "75%", margin: "0 auto 4pt" }}
        />
        <div
          className="gs-tailor-shimmer-bar"
          style={{ height: "9pt", width: "85%", margin: "0 auto" }}
        />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="resume-section">
          <div
            className="gs-tailor-shimmer-bar"
            style={{ height: "10pt", width: "120pt", margin: "0 0 6pt 0" }}
          />
          {[0, 1, 2].map((j) => (
            <div
              key={j}
              className="gs-tailor-shimmer-bar"
              style={{
                height: "9pt",
                width: `${85 - j * 8}%`,
                margin: "3pt 0",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Viewer dialog
// ──────────────────────────────────────────────────────────────

type ViewerLoadState =
  | { kind: "loading" }
  | { kind: "ready"; tailored: TailoredResume }
  | { kind: "error"; message: string };

function TailoredViewerDialog({
  id,
  open,
  onOpenChange,
  onDeleted,
}: {
  id: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [state, setState] = useState<ViewerLoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/resume/tailored/${id}`)
      .then(async (resp) => {
        if (cancelled) return;
        if (!resp.ok) {
          const body = (await resp.json().catch(() => ({}))) as {
            error?: string;
          };
          setState({
            kind: "error",
            message: humanizeError(body.error) || "Couldn't load this resume",
          });
          return;
        }
        const data = (await resp.json()) as { tailored: TailoredResume };
        setState({ kind: "ready", tailored: data.tailored });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ kind: "error", message: "Network error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-3 p-5 sm:p-6">
        {state.kind === "loading" ? (
          <ViewerLoadingState />
        ) : state.kind === "error" ? (
          <ViewerErrorState message={state.message} />
        ) : (
          <ViewerReadyState
            tailored={state.tailored}
            onDeleted={() => {
              onDeleted(state.tailored.meta.id);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ViewerLoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
        <HugeiconsIcon
          icon={Loading03Icon}
          size={14}
          strokeWidth={2}
          className="animate-spin"
        />
        Loading
      </span>
    </div>
  );
}

function ViewerErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-2 py-6">
      <DialogTitle>Couldn&apos;t load this resume</DialogTitle>
      <DialogDescription>{message}</DialogDescription>
    </div>
  );
}

function ViewerReadyState({
  tailored,
  onDeleted,
}: {
  tailored: TailoredResume;
  onDeleted: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const label = tailoredDisplayLabel(tailored.meta);
  const createdLabel = useMemo(
    () =>
      new Date(tailored.meta.createdAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [tailored.meta.createdAt],
  );

  const onDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadErr(null);
    try {
      const resp = await fetch("/api/resume/doc/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: tailored.doc }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setDownloadErr(body.detail || humanizeError(body.error));
        return;
      }
      const blob = await resp.blob();
      const baseName =
        (tailored.doc.header.name || "resume").toLowerCase().replace(/[^a-z0-9]+/g, "-") +
        "-" +
        (tailored.meta.company || tailored.meta.jobTitle || "tailored")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadErr("PDF download failed");
    } finally {
      setDownloading(false);
    }
  }, [tailored, downloading]);

  const onDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      const resp = await fetch(`/api/resume/tailored/${tailored.meta.id}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setDeleteErr(body.detail || humanizeError(body.error));
        setDeleting(false);
        return;
      }
      onDeleted();
    } catch {
      setDeleteErr("Delete failed");
      setDeleting(false);
    }
  }, [tailored.meta.id, deleting, onDeleted]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: RESUME_PRINT_CSS }} />
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <HugeiconsIcon icon={JobSearchIcon} size={15} strokeWidth={2} />
          {label}
        </DialogTitle>
        <DialogDescription>
          <span className="tabular-nums">Tailored {createdLabel}</span>
          {tailored.meta.jdExcerpt ? (
            <>
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/80">
                {tailored.meta.jdExcerpt}
              </span>
            </>
          ) : null}
        </DialogDescription>
      </DialogHeader>
      <div className="rounded-lg border border-border/40 bg-foreground/[0.015] dark:bg-foreground/[0.04] p-4 max-h-[60vh] overflow-y-auto gs-pane-scroll flex justify-center">
        <div
          className="origin-top"
          style={{ transform: "scale(0.55)", transformOrigin: "top center" }}
        >
          <PrintableResume doc={tailored.doc} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          {deleteConfirm ? (
            <>
              <span className="text-[12px] text-muted-foreground">
                Delete this version?
              </span>
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
                className={cn(
                  "inline-flex items-center rounded-md h-8 px-3 text-[12px]",
                  "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
                  "transition-[background-color,color] duration-150 ease",
                  "min-h-9",
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md h-8 px-3 text-[12px] font-medium",
                  "bg-[var(--destructive)] text-white",
                  "transition-[opacity] duration-150 ease",
                  "hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
                  "min-h-9",
                )}
              >
                <HugeiconsIcon
                  icon={deleting ? Loading03Icon : Delete02Icon}
                  size={12}
                  strokeWidth={2}
                  className={deleting ? "animate-spin" : undefined}
                />
                {deleting ? "Deleting" : "Confirm delete"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md h-8 px-2.5 text-[12px]",
                "text-muted-foreground hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/[0.08]",
                "transition-[background-color,color] duration-150 ease",
                "min-h-9",
              )}
            >
              <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={2} />
              Delete
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {downloadErr ? (
            <span className="text-[11px] text-foreground">{downloadErr}</span>
          ) : null}
          {deleteErr ? (
            <span className="text-[11px] text-foreground">{deleteErr}</span>
          ) : null}
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md h-9 px-3.5 text-[13px] font-medium",
              "bg-foreground text-background",
              "transition-[opacity] duration-150 ease",
              "hover:opacity-90 disabled:opacity-50 disabled:cursor-progress",
              "min-h-9",
            )}
          >
            <HugeiconsIcon
              icon={downloading ? Loading03Icon : Download04Icon}
              size={13}
              strokeWidth={2}
              className={downloading ? "animate-spin" : undefined}
            />
            {downloading ? "Generating" : "Download PDF"}
          </button>
        </div>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function progressLabelFor(doc: ResumeDoc): string {
  if (!doc.header.name) return "Reading the JD";
  if (doc.experience.length === 0) return "Tailoring your headline";
  const lastExp = doc.experience[doc.experience.length - 1];
  if (lastExp && lastExp.bullets.length === 0) {
    return `Rewriting bullets for ${lastExp.company || "experience"}`;
  }
  if (doc.projects.length === 0 && doc.experience.length > 0) {
    return "Re-ranking your projects";
  }
  if (doc.education.length === 0 && doc.projects.length > 0) {
    return "Slotting education";
  }
  if (doc.skills.length === 0 && doc.education.length > 0) {
    return "Regrouping skills";
  }
  return "Polishing";
}

function humanizeError(code?: string): string {
  switch (code) {
    case "no_base_resume":
      return "Generate your main resume first.";
    case "missing_job_description":
      return "Paste a job description to tailor against.";
    case "job_description_too_long":
      return "Job description is too long — trim it under 16k characters.";
    case "ai_not_configured":
      return "AI is not configured for this environment.";
    case "openrouter_failed":
      return "The AI gateway is having a moment — try again in a few seconds.";
    case "validation_failed":
      return "The AI returned a malformed resume. Retry once and it usually fixes itself.";
    case "stream_failed":
      return "The connection dropped mid-generation. Try again.";
    case "no_handle":
      return "Your GitHub handle is missing from this session.";
    case "r2_not_bound":
      return "Storage is unavailable right now.";
    case "payment_required":
      return "A Pro subscription is required.";
    case "not_found":
      return "This tailored resume no longer exists.";
    case "delete_failed":
      return "Couldn't delete this tailored resume.";
    case "pdf_render_failed":
      return "PDF render failed.";
    case "browser_not_bound":
      return "PDF service unavailable.";
    default:
      return code || "Something went wrong";
  }
}

/**
 * Tiny relative-time formatter for the list rows. "3m ago", "2h ago",
 * "yesterday", "Mar 12". Re-evaluates every minute via state to keep
 * the label honest without bringing in a date library.
 */
function useRelativeTime(iso: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => formatRelative(new Date(iso).getTime(), now), [iso, now]);
}

function formatRelative(then: number, now: number): string {
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Keep the helper available to callers who only need the excerpt
// without importing the schema module twice.
export { buildJdExcerpt };
