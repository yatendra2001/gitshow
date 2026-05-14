"use client";

/**
 * Self-contained "Download PDF" button used in the resume editor
 * toolbar and the tailored-detail toolbar. Owns:
 *
 *   - the network call to `/api/resume/doc/pdf`,
 *   - the smooth easeOut progress curve that ticks while Cloudflare
 *     Browser Rendering does its thing,
 *   - the in-place progress fill animation (no width/layout shift —
 *     the same button morphs into a progress chip),
 *   - blob → object-URL → click → revoke download flow.
 *
 * The parent passes the `doc` and an optional filename stem; the rest
 * is handled here. Errors flow back through the optional `onError`
 * callback so the host surface can decide where to render them (the
 * editor surfaces in its save badge; the detail page shows an inline
 * caption next to the button).
 *
 * Behaviour ported verbatim from `_resume-editor.tsx`'s original
 * `DownloadButton` so the tactile feel matches across surfaces.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download04Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { ResumeDoc } from "@gitshow/shared/resume-doc";
import { cn } from "@/lib/utils";

const EXPECTED_RENDER_MS = 9000;

export interface ResumePdfDownloadButtonProps {
  doc: ResumeDoc;
  /**
   * Override the default filename stem. Final filename is
   * `${stem}.pdf`. When omitted, the stem is derived from
   * `doc.header.name` ("jane-doe-resume").
   */
  filenameStem?: string;
  /** Surface a human-readable error message however the host wants. */
  onError?: (message: string) => void;
  className?: string;
}

export function ResumePdfDownloadButton({
  doc,
  filenameStem,
  onError,
  className,
}: ResumePdfDownloadButtonProps) {
  const [downloading, setDownloading] = useState(false);
  const [pct, setPct] = useState(0);
  const [label, setLabel] = useState("Starting");
  const progressRafRef = useRef<number | null>(null);

  const onDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setPct(0);
    setLabel("Starting");

    // Smooth easeOut driven by elapsed time. The curve `1 - exp(-3t)`
    // hits 95% at the expected duration and then asymptotes — feels
    // honest because the real bottleneck (PDF render) slows as it
    // nears completion. We snap to 100 when the fetch resolves.
    const startedAt = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const t = elapsed / EXPECTED_RENDER_MS;
      const eased = 1 - Math.exp(-3 * t);
      const next = Math.min(eased * 95, 95);
      setPct(next);
      setLabel(labelForPct(next));
      progressRafRef.current = requestAnimationFrame(tick);
    };
    progressRafRef.current = requestAnimationFrame(tick);

    try {
      const resp = await fetch("/api/resume/doc/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc }),
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        if (progressRafRef.current)
          cancelAnimationFrame(progressRafRef.current);
        progressRafRef.current = null;
        setDownloading(false);
        onError?.(err.detail || humanizeError(err.error));
        return;
      }
      const blob = await resp.blob();

      if (progressRafRef.current)
        cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
      setPct(100);
      setLabel("Ready");

      const stem =
        filenameStem ||
        ((doc.header.name || "resume")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-") + "-resume");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stem}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Hold the "Ready" state briefly so the 100% feels intentional
      // rather than an instant flash, then return to the idle button.
      setTimeout(() => {
        setDownloading(false);
        setPct(0);
      }, 700);
    } catch {
      if (progressRafRef.current)
        cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
      setDownloading(false);
      onError?.("PDF download failed");
    }
  }, [doc, filenameStem, onError, downloading]);

  // Cancel any pending progress tick if the button unmounts mid-render.
  useEffect(() => {
    return () => {
      if (progressRafRef.current)
        cancelAnimationFrame(progressRafRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={onDownload}
      disabled={downloading}
      className={cn(
        "relative overflow-hidden inline-flex items-center justify-center gap-1.5",
        "rounded-md h-8 px-3 text-[12px] font-medium",
        "bg-foreground text-background min-h-9 min-w-[148px]",
        "transition-[opacity] duration-150 ease",
        "disabled:cursor-progress",
        className,
      )}
      aria-label={
        downloading
          ? `Generating PDF — ${Math.round(pct)} percent complete`
          : "Download resume as PDF"
      }
      aria-live="polite"
      aria-busy={downloading}
      aria-valuenow={downloading ? Math.round(pct) : undefined}
      aria-valuemin={downloading ? 0 : undefined}
      aria-valuemax={downloading ? 100 : undefined}
      role={downloading ? "progressbar" : undefined}
    >
      {/* Progress fill underlay — slightly lighter than the button
          background so it reads as a fill without breaking the
          button's identity. Sits at 0 width when idle. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 origin-left",
          "bg-background/15",
          "transition-[transform] duration-150 ease-out",
        )}
        style={{
          width: "100%",
          transform: `scaleX(${downloading ? pct / 100 : 0})`,
        }}
      />
      {/* Bottom strip — the precise progress indicator. Visible only
          while downloading; fades out on completion. */}
      <span
        aria-hidden
        className={cn(
          "absolute bottom-0 left-0 h-[2px] origin-left",
          "bg-background/55",
          "transition-[transform,opacity] duration-150 ease-out",
        )}
        style={{
          width: "100%",
          transform: `scaleX(${downloading ? pct / 100 : 0})`,
          opacity: downloading ? 1 : 0,
        }}
      />
      <span className="relative z-10 inline-flex items-center gap-1.5 tabular-nums">
        <HugeiconsIcon
          icon={downloading ? Loading03Icon : Download04Icon}
          size={14}
          strokeWidth={2}
          className={downloading ? "animate-spin" : ""}
        />
        {downloading ? (
          <>
            <span>{Math.round(pct)}%</span>
            <span className="opacity-75 font-normal">· {label}</span>
          </>
        ) : (
          "Download PDF"
        )}
      </span>
    </button>
  );
}

/**
 * Map a percentage to a phase label. The bands roughly track when
 * Cloudflare Browser Rendering is doing each step in practice — they
 * land near the right phase even though we're not getting real signals
 * from the server. Honest enough that "Rendering layout" appears when
 * Puppeteer is actually rendering the page.
 */
function labelForPct(pct: number): string {
  if (pct < 12) return "Connecting";
  if (pct < 35) return "Loading fonts";
  if (pct < 65) return "Rendering layout";
  if (pct < 85) return "Generating PDF";
  return "Almost there";
}

function humanizeError(code?: string): string {
  switch (code) {
    case "no_doc":
      return "Resume not found";
    case "browser_not_bound":
      return "PDF service unavailable";
    case "pdf_render_failed":
      return "PDF render failed";
    case "payment_required":
      return "A Pro subscription is required.";
    default:
      return code || "Download failed";
  }
}
