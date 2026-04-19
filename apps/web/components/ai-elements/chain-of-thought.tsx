"use client";

import * as React from "react";
import { ChevronDown, Search, FileSearch } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ChainOfThought — structured narrative of the agent's work. Unlike
 * Reasoning (a single streaming monologue), this one renders a sequence
 * of titled sub-steps. Each step can carry:
 *
 *   - a set of "search chip" sources (small domain pills)
 *   - a subtitle / body text
 *   - an inline image (e.g. found a profile photo)
 *   - nested sub-items (file pills, etc.)
 *
 * Shown while the pipeline runs, collapses to its header on completion
 * if `done` is true.
 */

export interface CoTSearchChip {
  id: string;
  label: string;
  url?: string;
}

export interface CoTStep {
  id: string;
  /** Icon slot — we ship Search and FileSearch defaults; supply your own. */
  icon?: React.ReactNode;
  title: string;
  /** Zero or more search-result chips like `www.x.com` or `github.com`. */
  chips?: CoTSearchChip[];
  /** Optional body copy that appears on its own line. */
  body?: React.ReactNode;
  /** Optional image preview (inline embed, not a link). */
  imageUrl?: string;
  imageAlt?: string;
  /** True once this step is finalized (stops the "in-progress" dot). */
  done?: boolean;
}

export interface ChainOfThoughtProps
  extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  steps: CoTStep[];
  /** True means the overall agent is still thinking. Flip false to
   *  collapse/disable the pulse on the header. */
  streaming?: boolean;
}

export function ChainOfThought({
  title = "Chain of Thought",
  steps,
  streaming = false,
  className,
  ...props
}: ChainOfThoughtProps) {
  const [open, setOpen] = React.useState(true);

  return (
    <div
      className={cn(
        "gs-enter rounded-xl border border-border bg-card/70 backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-accent/40"
      >
        <span
          className={cn(
            "relative flex size-4 items-center justify-center rounded-full",
            streaming ? "bg-blue-500/15" : "bg-muted/40",
          )}
        >
          <Search
            className={cn(
              "size-2.5",
              streaming ? "text-blue-400 gs-pulse" : "text-muted-foreground",
            )}
          />
        </span>
        <span className="flex-1 text-sm font-medium text-foreground/90">
          {title}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>

      <div
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0">
          <div className="space-y-4 border-t border-border/60 px-4 py-4">
            {steps.map((s, i) => (
              <CoTStepView
                key={s.id}
                step={s}
                isLast={i === steps.length - 1}
                streaming={streaming && i === steps.length - 1}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CoTStepView({
  step,
  isLast,
  streaming,
}: {
  step: CoTStep;
  isLast: boolean;
  streaming: boolean;
}) {
  const defaultIcon =
    step.title.toLowerCase().startsWith("searching") ||
    step.title.toLowerCase().startsWith("found") ? (
      <Search className="size-3" />
    ) : (
      <FileSearch className="size-3" />
    );

  return (
    <div className="gs-enter flex gap-3">
      <div className="relative flex size-5 shrink-0 items-center justify-center">
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-full border",
            streaming
              ? "border-blue-500/60 bg-blue-500/10 text-blue-300"
              : step.done === false
                ? "border-muted-foreground/40 bg-transparent text-muted-foreground"
                : "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
          )}
        >
          {step.icon ?? defaultIcon}
        </span>
        {!isLast && (
          <span className="absolute left-1/2 top-5 h-[calc(100%-4px)] w-px -translate-x-1/2 bg-border" />
        )}
      </div>

      <div className="flex-1 min-w-0 pb-1">
        <div className="text-sm leading-snug text-foreground/95">
          {step.title}
        </div>
        {step.chips && step.chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {step.chips.map((c) => (
              <SearchChip key={c.id} chip={c} />
            ))}
          </div>
        )}
        {step.body && (
          <div className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {step.body}
          </div>
        )}
        {step.imageUrl && (
          <div className="mt-2 overflow-hidden rounded-lg border border-border bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={step.imageUrl}
              alt={step.imageAlt ?? ""}
              className="max-h-48 w-full object-cover"
              loading="lazy"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SearchChip({ chip }: { chip: CoTSearchChip }) {
  const host = React.useMemo(() => {
    if (!chip.url) return chip.label;
    try {
      return new URL(chip.url).hostname.replace(/^www\./, "");
    } catch {
      return chip.label;
    }
  }, [chip.url, chip.label]);
  const Wrap: React.ElementType = chip.url ? "a" : "span";
  const wrapProps = chip.url
    ? { href: chip.url, target: "_blank", rel: "noreferrer" }
    : {};
  return (
    <Wrap
      {...wrapProps}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-1.5 py-0.5",
        "font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30",
      )}
    >
      <span className="size-1 rounded-full bg-muted-foreground/60" />
      {chip.label || host}
    </Wrap>
  );
}
