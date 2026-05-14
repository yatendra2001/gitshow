"use client";

/**
 * Scaled `PrintableResume` preview frame — the visual container used
 * in three places: the live editor preview, the tailored-detail page,
 * and the streaming dialog. Wraps `<PrintableResume>` with the print
 * stylesheet, a centered scale transform, and an optional surface
 * background.
 *
 * The editor pane keeps its own `<PreviewPane>` because it also runs a
 * ResizeObserver to measure page-fit. This component is the simpler
 * read-only variant — no measurement, no overlay.
 */

import type { ResumeDoc } from "@gitshow/shared/resume-doc";
import { PrintableResume, RESUME_PRINT_CSS } from "./printable";
import { cn } from "@/lib/utils";

export interface ScaledResumePreviewProps {
  doc: ResumeDoc;
  /** 0–1 transform scale. `0.78` matches the editor's default. */
  scale?: number;
  /** Wrapper className for the outer surface. */
  className?: string;
  /**
   * If true, the print stylesheet is injected here. Set to `false` when
   * a parent surface has already mounted `RESUME_PRINT_CSS` (e.g. the
   * streaming view mounts both print + shimmer in one `<style>`).
   */
  injectCss?: boolean;
}

export function ScaledResumePreview({
  doc,
  scale = 0.78,
  className,
  injectCss = true,
}: ScaledResumePreviewProps) {
  return (
    <div
      className={cn(
        "bg-foreground/[0.015] dark:bg-foreground/[0.04]",
        "rounded-lg border border-border/40",
        "px-6 py-8",
        "flex justify-center",
        className,
      )}
    >
      {injectCss ? (
        <style dangerouslySetInnerHTML={{ __html: RESUME_PRINT_CSS }} />
      ) : null}
      <div
        className="origin-top"
        style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
      >
        <PrintableResume doc={doc} />
      </div>
    </div>
  );
}
