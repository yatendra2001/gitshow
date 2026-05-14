"use client";

/**
 * "New resume" dialog — pastes a JD, streams a tailored resume from
 * the API, and on `done` either navigates to the new resume's editor
 * (default) or hands the validated `TailoredResume` back to the
 * parent for an optimistic insert.
 *
 * Composes the shared streaming primitives so the visual language
 * matches every other live-AI surface in gitshow.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { MagicWand01Icon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import type { ResumeDoc } from "@gitshow/shared/resume-doc";
import type { TailoredResume } from "@gitshow/shared/tailored-resume";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import { PrintableResume } from "@/components/resume/printable";
import {
  ResumeStreamCss,
  ResumeStreamBanner,
  ResumeShimmerPlaceholder,
  progressLabelFor,
} from "@/components/resume/streaming";
import { cn } from "@/lib/utils";

type Phase = "idle" | "streaming" | "done" | "error";

export interface NewResumeDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * Override the default "navigate to the new resume" behaviour.
   * When provided, the dialog hands the validated `TailoredResume`
   * back instead of routing.
   */
  onCreated?: (tailored: TailoredResume) => void;
}

export function NewResumeDialog({
  open,
  onOpenChange,
  onCreated,
}: NewResumeDialogProps) {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusLabel, setStatusLabel] = useState("Reading the JD");
  const [partialDoc, setPartialDoc] = useState<ResumeDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset streaming state when the dialog closes. The JD draft sticks
  // around — accidental dismissal shouldn't lose the user's paste —
  // but the shimmer/preview must reset for a clean re-open.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setPhase("idle");
      setPartialDoc(null);
      setStatusLabel("Reading the JD");
      setErr(null);
    }
  }, [open]);

  const onSubmit = useCallback(async () => {
    const text = jd.trim();
    if (text.length < 50) return;
    setPhase("streaming");
    setErr(null);
    setPartialDoc(null);
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
              setPartialDoc(evt.doc);
              setStatusLabel(progressLabelFor(evt.doc, "tailor"));
            } else if (evt.type === "done") {
              setStatusLabel("Saving");
              setPhase("done");
              setJd("");
              const tailored = evt.tailored;
              setTimeout(() => {
                if (onCreated) onCreated(tailored);
                else router.push(`/app/resume/${tailored.meta.id}`);
              }, 500);
            } else if (evt.type === "error") {
              setErr(evt.detail || humanizeError(evt.error));
              setPhase("error");
            }
          } catch {
            // Malformed SSE frame — skip silently.
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErr("Network error");
      setPhase("error");
    }
  }, [jd, onCreated, router]);

  const isBusy = phase === "streaming" || phase === "done";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't allow Esc/overlay-close while streaming.
        if (isBusy && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent showClose={!isBusy} className="max-w-2xl gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={MagicWand01Icon} size={16} strokeWidth={2} />
            New resume
          </DialogTitle>
          <DialogDescription>
            Paste the job description.
          </DialogDescription>
        </DialogHeader>

        {phase === "idle" || phase === "error" ? (
          <IdleForm jd={jd} setJd={setJd} onSubmit={onSubmit} error={err} />
        ) : (
          <StreamingPreview
            doc={partialDoc}
            statusLabel={statusLabel}
            done={phase === "done"}
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
          if (
            (e.metaKey || e.ctrlKey) &&
            e.key === "Enter" &&
            trimmed.length >= 50
          ) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={10}
        placeholder={`Paste the JD…\n\nSenior Backend Engineer at Stripe\nYou'll own…\nRequirements:\n- 5+ years…\n- Distributed systems…`}
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
            ? "Paste to begin"
            : tooShort
              ? `${trimmed.length}/50`
              : `${trimmed.length.toLocaleString()} chars · ⌘ ↵`}
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
          Create
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
  done,
}: {
  doc: ResumeDoc | null;
  statusLabel: string;
  done: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ResumeStreamCss />
      <ResumeStreamBanner
        statusLabel={statusLabel}
        done={done}
        title={done ? "Ready" : "Drafting"}
        className="rounded-lg border border-border/40 bg-foreground/[0.02] px-3 py-2"
      />
      <div className="rounded-lg border border-border/40 bg-foreground/[0.015] dark:bg-foreground/[0.04] p-4 max-h-[50vh] overflow-y-auto gs-pane-scroll flex justify-center">
        <div
          className="origin-top"
          style={{ transform: "scale(0.5)", transformOrigin: "top center" }}
        >
          <div key={doc ? "doc" : "placeholder"} className="gs-stream-reveal">
            {doc ? <PrintableResume doc={doc} /> : <ResumeShimmerPlaceholder />}
          </div>
        </div>
      </div>
    </div>
  );
}

function humanizeError(code?: string): string {
  switch (code) {
    case "no_portfolio":
      return "Run a portfolio scan first.";
    case "missing_job_description":
      return "Paste a job description.";
    case "job_description_too_long":
      return "Trim the JD under 16k characters.";
    case "ai_not_configured":
      return "AI is not configured.";
    case "openrouter_failed":
      return "The AI gateway is having a moment — retry.";
    case "validation_failed":
      return "Malformed output. Retry usually fixes it.";
    case "stream_failed":
      return "Connection dropped. Retry.";
    case "payment_required":
      return "A Pro subscription is required.";
    default:
      return code || "Something went wrong";
  }
}
