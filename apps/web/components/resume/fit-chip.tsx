"use client";

/**
 * Page-fit indicator chip used in the resume toolbars. Pure
 * presentation — measurement comes from `<ResumePreview>` via its
 * `onFitChange` callback.
 *
 * Visible on `sm:` and up so the editor toolbar isn't crowded on
 * narrow screens. Hover tooltip carries the precise line/pixel
 * numbers for power users.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Tick02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { ONE_PAGE_LINE_BUDGET } from "@gitshow/shared/resume-doc";
import { cn } from "@/lib/utils";
import type { ResumePageFit } from "./preview-pane";

export interface ResumeFitChipProps {
  fit: ResumePageFit | null;
  /** Heuristic line estimate from `estimateContentLines()`. */
  estimatedLines: number;
  className?: string;
}

export function ResumeFitChip({
  fit,
  estimatedLines,
  className,
}: ResumeFitChipProps) {
  const over = fit ? fit.pages > 1 : false;
  const label = fit
    ? `${fit.pages} ${fit.pages === 1 ? "page" : "pages"}`
    : "Measuring";
  const title = fit
    ? over
      ? `Rendered resume spans ${fit.pages} pages. Overflow: ${Math.ceil(fit.overflowPx)}px. Estimate: ${estimatedLines}/${ONE_PAGE_LINE_BUDGET} lines.`
      : `Rendered resume fits on one page. Estimate: ${estimatedLines}/${ONE_PAGE_LINE_BUDGET} lines.`
    : `Measuring rendered resume layout. Estimate: ${estimatedLines}/${ONE_PAGE_LINE_BUDGET} lines.`;
  const icon = fit ? (over ? AlertCircleIcon : Tick02Icon) : Loading03Icon;

  return (
    <div
      className={cn(
        "hidden sm:inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-[11px] font-medium",
        "transition-[background-color,color] duration-200 ease-out",
        over
          ? "bg-foreground/[0.06] text-foreground"
          : "bg-foreground/[0.04] text-muted-foreground",
        className,
      )}
      title={title}
    >
      <HugeiconsIcon
        icon={icon}
        size={12}
        strokeWidth={2}
        className={fit ? undefined : "animate-spin"}
      />
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{label}</span>
    </div>
  );
}
