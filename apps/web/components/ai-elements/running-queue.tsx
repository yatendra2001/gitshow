"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * RunningQueue — modern agent-style work queue.
 *
 * Three sections: Running, Up next, Done. Running is always visible and
 * animated. Up next shows the next 3–4 upcoming tasks so the user sees
 * the shape of what's coming without being drowned in a list. Done
 * collapses into a single summary line by default — the user doesn't
 * need to scroll past twelve completed steps.
 *
 * Swallows anything phase-specific so the caller only hands us three
 * arrays of labels + keys. Use this instead of the raw Task list when
 * the goal is "give the user a calm sense of progress."
 */

export interface QueueItem {
  id: string;
  title: string;
  subtitle?: string;
}

export function RunningQueue({
  running,
  upNext,
  done,
  className,
  ...props
}: {
  running: QueueItem[];
  upNext: QueueItem[];
  done: QueueItem[];
} & React.HTMLAttributes<HTMLDivElement>) {
  const [doneOpen, setDoneOpen] = React.useState(false);

  return (
    <div className={cn("space-y-2", className)} {...props}>
      {/* RUNNING */}
      {running.map((r) => (
        <div
          key={r.id}
          className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2.5"
        >
          <span className="relative mt-1 flex size-2 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {r.title}
            </div>
            {r.subtitle && (
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {r.subtitle}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* UP NEXT */}
      {upNext.length > 0 && (
        <div className="space-y-0.5 rounded-lg border border-border bg-card/60 px-3 py-2.5">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Up next · {upNext.length}
          </div>
          {upNext.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-2.5 py-0.5 text-sm text-muted-foreground"
            >
              <span className="block size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
              <span className="truncate">{u.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* DONE — collapsible */}
      {done.length > 0 && (
        <div className="rounded-lg border border-border bg-card/40">
          <button
            type="button"
            onClick={() => setDoneOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3 transition-transform",
                doneOpen ? "" : "-rotate-90",
              )}
            />
            Done · {done.length}
          </button>
          {doneOpen && (
            <div className="space-y-0.5 border-t border-border px-3 py-2">
              {done.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2.5 py-0.5 text-sm text-muted-foreground"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/90 text-white">
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                  <span className="truncate line-through decoration-muted-foreground/30">
                    {d.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
