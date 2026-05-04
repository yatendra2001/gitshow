"use client";

/**
 * Empty state + live-stream generator for /app/resume.
 *
 * Three states this component can render:
 *   1. No portfolio at all → nudge user to run a scan first.
 *   2. Portfolio exists, no ResumeDoc → "Generate Resume" CTA.
 *   3. User clicked Generate → live preview that fills in section by
 *      section as the AI streams the document. On stream completion
 *      we router.refresh() so the page server-component picks up the
 *      newly-written R2 blob and mounts the full editor.
 *
 * The streaming UI is intentionally bigger and more theatrical than
 * the editor preview — this is a moment, not a routine. The user is
 * watching their resume materialize.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MagicWand01Icon,
  CheckmarkBadge01Icon,
  Tick02Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import type { ResumeDoc } from "@gitshow/shared/resume-doc";
import { cn } from "@/lib/utils";
import {
  PrintableResume,
  RESUME_PRINT_CSS,
} from "@/components/resume/printable";

/**
 * Streaming-only CSS — shimmer for the pre-stream skeleton, fade-in
 * when the first partial arrives, and bouncing dots in the banner so
 * the spin-up window before any tokens lands doesn't feel dead.
 *
 * Scoped to `.gs-…` classes; no overlap with RESUME_PRINT_CSS. Honors
 * `prefers-reduced-motion` by collapsing every animation to a static
 * end state.
 */
const STREAM_CSS = `
@keyframes gs-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.gs-shimmer-bar {
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
  animation: gs-shimmer 1.6s linear infinite;
  border-radius: 2pt;
}
@keyframes gs-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.gs-resume-reveal {
  animation: gs-fade-in 260ms cubic-bezier(0.2, 0.6, 0.2, 1) both;
}
@keyframes gs-bounce-dot {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.7); }
  40%           { opacity: 1;    transform: scale(1); }
}
.gs-bounce-dot {
  animation: gs-bounce-dot 1.2s ease-in-out infinite both;
}
.gs-bounce-dot:nth-child(2) { animation-delay: 0.15s; }
.gs-bounce-dot:nth-child(3) { animation-delay: 0.3s; }
@media (prefers-reduced-motion: reduce) {
  .gs-shimmer-bar { animation: none; background: #eee; }
  .gs-resume-reveal { animation: none; }
  .gs-bounce-dot { animation: none; opacity: 0.6; }
}
`;

type Phase = "idle" | "streaming" | "done";

export function ResumeEmpty({ hasResume }: { hasResume: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [partialDoc, setPartialDoc] = useState<ResumeDoc | null>(null);
  const [statusLabel, setStatusLabel] = useState<string>("Warming up");
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onGenerate = useCallback(async () => {
    if (phase !== "idle") return;
    setPhase("streaming");
    setErr(null);
    setStatusLabel("Reading your portfolio");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/resume/doc/generate-stream", {
        method: "POST",
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        const data = (await resp.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setErr(data.detail || data.error || "Generation failed");
        setPhase("idle");
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // The shape of events we expect from /generate-stream.
      type StreamEvent =
        | { type: "partial"; doc: ResumeDoc }
        | { type: "done"; doc: ResumeDoc }
        | { type: "error"; error: string; detail?: string };

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
              setStatusLabel(progressLabelFor(evt.doc));
            } else if (evt.type === "done") {
              setPartialDoc(evt.doc);
              setStatusLabel("Polishing");
              setPhase("done");
              // Tiny pause so the user sees the completed state
              // before the page swaps to the editor.
              setTimeout(() => router.refresh(), 600);
            } else if (evt.type === "error") {
              setErr(evt.detail || evt.error || "Generation failed");
              setPhase("idle");
            }
          } catch {
            // Ignore malformed frames silently.
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErr("Network error");
      setPhase("idle");
    }
  }, [phase, router]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  if (!hasResume) {
    return (
      <section className="mx-auto w-full max-w-xl px-5 sm:px-6 py-16">
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
          No portfolio yet
        </div>
        <h1 className="text-[28px] sm:text-[32px] leading-tight tracking-tight font-semibold mb-3">
          Run a scan first
        </h1>
        <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
          Your résumé is generated from your portfolio data — your work,
          projects, education, and skills. Run the AI scan from the dashboard
          to seed everything, then come back here for a one-page export.
        </p>
        <Link
          href="/app"
          className={cn(
            "inline-flex items-center rounded-lg bg-foreground text-background px-4 h-10 text-[13px] font-medium",
            "hover:opacity-90 transition-[opacity] duration-150 ease",
            "min-h-11",
          )}
        >
          Back to dashboard
        </Link>
      </section>
    );
  }

  if (phase === "streaming" || phase === "done") {
    return (
      <StreamingView
        doc={partialDoc}
        statusLabel={statusLabel}
        phase={phase}
      />
    );
  }

  return (
    <section className="mx-auto w-full max-w-2xl px-5 sm:px-6 py-12 sm:py-16">
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
        Resume
      </div>
      <h1 className="text-[28px] sm:text-[34px] leading-[1.1] tracking-tight font-semibold mb-3">
        Generate your one-page resume
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-8 max-w-prose">
        We'll turn your portfolio into a printable, ATS-safe resume — impact
        bullets, no fluff, no fancy chrome. Watch it write itself in front of
        you, then tune anything before exporting to PDF.
      </p>

      <div className="rounded-xl border border-border/40 bg-foreground/[0.02] p-4 sm:p-5 mb-6">
        <div className="flex items-start gap-2.5 mb-3">
          <HugeiconsIcon
            icon={CheckmarkBadge01Icon}
            size={18}
            strokeWidth={2}
            className="text-foreground/70 mt-0.5 shrink-0"
          />
          <div className="text-[13px] font-semibold">
            ATS-safe, recruiter-friendly, founder-friendly
          </div>
        </div>
        <ul className="space-y-1.5 text-[12.5px] text-muted-foreground">
          {[
            "Single column · standard fonts · pure black & white",
            "Action-verb impact bullets, quantified where possible",
            "Hard one-page cap, with a live fit indicator",
            "Skills grouped by category for clean parsing",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <HugeiconsIcon
                icon={Tick02Icon}
                size={13}
                strokeWidth={2.25}
                className="text-foreground/60 mt-0.5 shrink-0"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={onGenerate}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-4 h-11 text-[13.5px] font-medium",
          "hover:opacity-90 transition-[opacity] duration-150 ease",
          "min-h-11",
        )}
      >
        <HugeiconsIcon icon={MagicWand01Icon} size={16} strokeWidth={2} />
        Generate resume
      </button>

      <p className="text-[11px] text-muted-foreground/60 mt-3">
        Powered by AI · live preview as it builds
      </p>

      {err ? (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-lg border border-foreground/15 bg-foreground/[0.04] px-3 py-2.5 text-[12.5px]"
        >
          <HugeiconsIcon
            icon={AlertCircleIcon}
            size={14}
            strokeWidth={2}
            className="mt-0.5 shrink-0"
          />
          <span>{err}</span>
        </div>
      ) : null}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
// Streaming view
// ──────────────────────────────────────────────────────────────

function StreamingView({
  doc,
  statusLabel,
  phase,
}: {
  doc: ResumeDoc | null;
  statusLabel: string;
  phase: Exclude<Phase, "idle">;
}) {
  const isDone = phase === "done";
  return (
    <div className="relative min-h-[calc(100svh-3.5rem)]">
      {/* Plain <style> tag — styled-jsx eats interpolation-only globals. */}
      <style dangerouslySetInnerHTML={{ __html: RESUME_PRINT_CSS + STREAM_CSS }} />

      {/* Status banner — sticky at the top of the streaming surface. */}
      <div className="sticky top-14 z-10 bg-background/80 backdrop-blur border-b border-border/30">
        <div className="mx-auto max-w-5xl px-5 h-12 flex items-center gap-3">
          {isDone ? (
            <HugeiconsIcon
              icon={Tick02Icon}
              size={14}
              strokeWidth={2}
              className="shrink-0 text-foreground"
            />
          ) : (
            // Bouncing dots — keeps the banner visibly alive even when
            // the model hasn't streamed a token yet (the dead 5-10s).
            <span
              className="shrink-0 inline-flex items-center gap-1"
              aria-hidden
            >
              <span className="gs-bounce-dot inline-block size-1.5 rounded-full bg-foreground/70" />
              <span className="gs-bounce-dot inline-block size-1.5 rounded-full bg-foreground/70" />
              <span className="gs-bounce-dot inline-block size-1.5 rounded-full bg-foreground/70" />
            </span>
          )}
          <span className="text-[12.5px] font-medium tracking-tight">
            {isDone ? "Resume ready" : "Generating your resume"}
          </span>
          <span className="text-[12px] text-muted-foreground/80 truncate">
            · {statusLabel}
          </span>
        </div>
      </div>

      <div className="px-5 py-8 flex justify-center">
        <div
          className="origin-top"
          style={{
            transform: "scale(var(--resume-scale-stream, 0.82))",
            transformOrigin: "top center",
          }}
        >
          {/* The `key` flips when the first partial arrives, so the
              fade-in plays once on the placeholder→content swap. We
              don't re-key on every partial — that would flash the
              animation every ~100ms. */}
          <div
            key={doc ? "doc" : "placeholder"}
            className="gs-resume-reveal"
          >
            {doc ? <PrintableResume doc={doc} /> : <ResumePlaceholder />}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Animated skeleton showing the resume's silhouette before the first
 * partial event lands. Each bar shimmers with a moving gradient so the
 * 5-10s spin-up window before any tokens arrive feels alive — not a
 * dead static page. Matches the printable's typographic rhythm so the
 * cross-fade into real content feels continuous.
 */
function ResumePlaceholder() {
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
          className="gs-shimmer-bar"
          style={{ height: "20pt", width: "60%", margin: "0 auto 4pt" }}
        />
        <div
          className="gs-shimmer-bar"
          style={{ height: "10pt", width: "75%", margin: "0 auto 4pt" }}
        />
        <div
          className="gs-shimmer-bar"
          style={{ height: "9pt", width: "85%", margin: "0 auto" }}
        />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="resume-section">
          <div
            className="gs-shimmer-bar"
            style={{ height: "10pt", width: "120pt", margin: "0 0 6pt 0" }}
          />
          {[0, 1, 2].map((j) => (
            <div
              key={j}
              className="gs-shimmer-bar"
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

/**
 * Pick a human-readable progress label from the doc's current shape.
 * The model emits sections in order, so the first non-empty section
 * we don't yet see is the one being written *now*.
 */
function progressLabelFor(doc: ResumeDoc): string {
  if (!doc.header.name) return "Reading your portfolio";
  if (doc.experience.length === 0) return "Drafting your headline";
  // Inside experience the bullets fill in last for the current entry —
  // we use an absent-bullet-on-last-entry as the "still writing" hint.
  const lastExp = doc.experience[doc.experience.length - 1];
  if (lastExp && lastExp.bullets.length === 0) {
    return `Writing impact bullets for ${lastExp.company || "experience"}`;
  }
  if (doc.projects.length === 0 && doc.experience.length > 0) {
    return "Picking your top projects";
  }
  if (doc.education.length === 0 && doc.projects.length > 0) {
    return "Adding education";
  }
  if (doc.skills.length === 0 && doc.education.length > 0) {
    return "Grouping skills";
  }
  if (doc.skills.length > 0 && doc.awards.length === 0) {
    return "Reviewing awards";
  }
  return "Polishing";
}
