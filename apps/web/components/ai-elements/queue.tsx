"use client";

import * as React from "react";
import { Check, ChevronDown, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Queue — AI Elements-style stacked-section work list.
 *
 * Two sections: "Running" (currently in-flight + next couple) and
 * "Done" (completed, strikethrough, collapsible). Each section header
 * shows a count and a chevron. Each row is a radio circle + title (+
 * optional subtitle on a second line). Done rows get a strikethrough.
 *
 * Drops the earlier RunningQueue look which didn't read as modern —
 * now mirrors the reference screenshot.
 */

export interface QueueRow {
  id: string;
  title: string;
  subtitle?: string;
  /** Optional avatar URL; shown as a small square thumbnail. */
  avatarUrl?: string;
}

export interface QueueProps extends React.HTMLAttributes<HTMLDivElement> {
  running: QueueRow[];
  upNext: QueueRow[];
  done: QueueRow[];
  runningLabel?: string;
  doneLabel?: string;
}

export function Queue({
  running,
  upNext,
  done,
  runningLabel = "Running",
  doneLabel = "Done",
  className,
  ...props
}: QueueProps) {
  const [runningOpen, setRunningOpen] = React.useState(true);
  const [doneOpen, setDoneOpen] = React.useState(false);

  const runningCount = running.length + upNext.length;

  return (
    <div
      className={cn(
        "gs-enter overflow-hidden rounded-xl border border-border bg-card/70 backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      {/* RUNNING section */}
      {runningCount > 0 && (
        <Section
          label={`${runningCount} ${runningLabel}`}
          open={runningOpen}
          onToggle={() => setRunningOpen((v) => !v)}
          dense={false}
        >
          {running.map((r) => (
            <Row key={r.id} row={r} state="running" />
          ))}
          {upNext.map((r) => (
            <Row key={r.id} row={r} state="pending" />
          ))}
        </Section>
      )}

      {/* DONE section */}
      {done.length > 0 && (
        <Section
          label={`${done.length} ${doneLabel}`}
          open={doneOpen}
          onToggle={() => setDoneOpen((v) => !v)}
          dense
          isLast
        >
          {done.map((r) => (
            <Row key={r.id} row={r} state="done" />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  open,
  onToggle,
  dense,
  isLast,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  dense?: boolean;
  isLast?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(!isLast && "border-b border-border/60")}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 px-4 text-left transition-colors hover:bg-accent/40",
          dense ? "py-2" : "py-2.5",
        )}
      >
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
        <span className="text-sm font-medium text-foreground/95">{label}</span>
      </button>
      <div
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0">
          <div className="space-y-0.5 px-4 pb-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Row({
  row,
  state,
}: {
  row: QueueRow;
  state: "running" | "pending" | "done";
}) {
  return (
    <div className="gs-fade flex items-start gap-2.5 py-1.5">
      <RowIndicator state={state} />
      {row.avatarUrl && (
        <span className="relative size-5 shrink-0 overflow-hidden rounded">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={row.avatarUrl}
            alt=""
            className="size-full object-cover"
          />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-sm leading-snug",
            state === "done"
              ? "text-muted-foreground/60 line-through decoration-muted-foreground/40"
              : state === "running"
                ? "text-foreground"
                : "text-foreground/90",
          )}
        >
          {row.title}
        </div>
        {row.subtitle && (
          <div
            className={cn(
              "mt-0.5 text-[12px] leading-snug",
              state === "done"
                ? "text-muted-foreground/50 line-through"
                : "text-muted-foreground",
            )}
          >
            {row.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

function RowIndicator({
  state,
}: {
  state: "running" | "pending" | "done";
}) {
  if (state === "running") {
    return (
      <span className="relative mt-1 flex size-[13px] shrink-0 items-center justify-center">
        <span className="absolute inline-flex size-[13px] animate-ping rounded-full border border-blue-500/40 opacity-70" />
        <span className="relative inline-flex size-[9px] rounded-full bg-blue-500" />
      </span>
    );
  }
  if (state === "done") {
    return (
      <span className="mt-1 flex size-[13px] shrink-0 items-center justify-center rounded-full border border-muted-foreground/30 bg-emerald-500/15">
        <Check className="size-[8px] text-emerald-300" strokeWidth={3.5} />
      </span>
    );
  }
  return (
    <Circle className="mt-1 size-[13px] shrink-0 text-muted-foreground/40" />
  );
}
