"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

/**
 * ActivityStream — the "what's happening right now" feed.
 *
 * Renders a vertical stack of one-line status messages. The most recent
 * is highlighted with a pulsing indicator; older ones fade back to
 * muted foreground. New items slide in from the top. This is the
 * component that makes the right pane feel alive while the scan runs.
 *
 * No timestamps, no percentages, no ETA — just "here's what I'm doing."
 */

export interface Activity {
  /** Stable id per activity (usually the source event id). */
  id: string | number;
  text: string;
  /** Optional small-caps category, shown dimmed before the text. */
  kind?: string;
}

export function ActivityStream({
  items,
  className,
  ...props
}: {
  items: Activity[];
} & React.HTMLAttributes<HTMLDivElement>) {
  if (items.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-card px-4 py-5 text-sm text-muted-foreground",
          className,
        )}
        {...props}
      >
        <Sparkles className="mb-2 size-4 text-muted-foreground/60" />
        Warming up…
      </div>
    );
  }

  // Show the latest 6; earlier ones fade.
  const recent = items.slice(-6);
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3 space-y-1.5",
        className,
      )}
      {...props}
    >
      {recent.map((a, i) => {
        const isLatest = i === recent.length - 1;
        return (
          <div
            key={a.id}
            className={cn(
              "flex items-start gap-2 text-sm leading-relaxed transition-opacity",
              isLatest
                ? "text-foreground"
                : i === recent.length - 2
                  ? "text-foreground/70"
                  : "text-muted-foreground/70",
            )}
          >
            <span className="mt-1.5 block size-1.5 shrink-0 rounded-full">
              {isLatest ? (
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-blue-500" />
                </span>
              ) : (
                <span className="inline-flex size-1.5 rounded-full bg-muted-foreground/40" />
              )}
            </span>
            <span className="flex-1">
              {a.kind && (
                <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {a.kind}
                </span>
              )}
              {a.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
