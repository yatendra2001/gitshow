"use client";

/**
 * "Tailor for job" dialog — pastes a JD, streams a JD-aligned
 * `ResumeDoc` from the API, and on `done` either navigates to the new
 * tailored variant (default) or invokes a custom `onTailored`
 * callback.
 *
 * Composes the shared streaming primitives (banner, shimmer, progress
 * label) from `components/resume/streaming.tsx` so the visual language
 * matches the empty-state generator exactly.
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

export interface TailorDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * Override the default "navigate to the new variant" behaviour. When
   * provided, the dialog hands the validated `TailoredResume` back to
   * the parent instead of routing. Used in the list page where we want
   * an instant prepend before the navigation transitions.
   */
  onTailored?: (tailored: TailoredResume) => void;
}

export function TailorDialog({ open, onOpenChange, onTailored }: TailorDialogProps) {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusLabel, setStatusLabel] = useState("Reading the JD");
  const [partialDoc, setPartialDoc] = useState<ResumeDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset the dialog whenever it closes. We deliberately *do not*
  // clear the JD draft on close — accidental dismissal shouldn't lose
  // the user's paste — but the streaming state must reset so a re-open
  // doesn't show stale shimmer.
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
                if (onTailored) onTailored(tailored);
                else router.push(`/app/resume/tailored/${tailored.meta.id}`);
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
  }, [jd, onTailored, router]);

  const isBusy = phase === "streaming" || phase === "done";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't allow Esc/overlay-close while streaming — would lose
        // the in-flight AI work.
        if (isBusy && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent showClose={!isBusy} className="max-w-2xl gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={MagicWand01Icon} size={16} strokeWidth={2} />
            Tailor for a job
          </DialogTitle>
          <DialogDescription>
            Paste the full job description. We&apos;ll reorder, rewrite,
            and re-rank — using only facts already in your base resume —
            to produce a JD-aligned variant. Your main resume stays
            untouched.
          </DialogDescription>
        </DialogHeader>

        {phase === "idle" || phase === "error" ? (
          <IdleForm jd={jd} setJd={setJd} onSubmit={onSubmit} error={err} />
        ) : (
          <StreamingPreview doc={partialDoc} statusLabel={statusLabel} done={phase === "done"} />
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
        title={done ? "Tailored resume ready" : "Tailoring your resume"}
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
    case "payment_required":
      return "A Pro subscription is required.";
    default:
      return code || "Something went wrong";
  }
}
