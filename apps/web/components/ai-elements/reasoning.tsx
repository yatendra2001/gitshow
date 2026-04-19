"use client";

import * as React from "react";
import { Brain, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reasoning — the "Thought for Xs" collapsible. Streams text in while
 * the agent is thinking; after it completes, the block collapses to
 * just the header with the elapsed time. Click the header to re-open.
 *
 * Design:
 *   - header: brain icon, "Thinking" (streaming) or "Thought for Xs"
 *     (done), chevron
 *   - body: monospace-ish serif at reduced size + leading; each word
 *     fades+blurs in on mount via gs-stream
 *   - a blinking caret pulses at the tail while streaming
 *   - auto-collapses on completion after a ~600ms pause
 */

export interface ReasoningProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Live reasoning text. Append-only as new tokens arrive. */
  text: string;
  /** True while text is still being appended. Flip false when done. */
  streaming?: boolean;
  /** Manual duration override for the "Thought for Xs" label; otherwise
   * we derive it from the time between first mount and `streaming=false`. */
  elapsedMs?: number;
  /** Shown above the body while active. Defaults to "Thinking". */
  label?: string;
  /** Stay open after streaming ends (useful for debugging). Default false. */
  keepOpenAfterDone?: boolean;
}

export function Reasoning({
  text,
  streaming = false,
  elapsedMs,
  label = "Thinking",
  keepOpenAfterDone = false,
  className,
  ...props
}: ReasoningProps) {
  const [open, setOpen] = React.useState(true);
  const mountedAt = React.useRef(Date.now());
  const [derivedMs, setDerivedMs] = React.useState(0);

  // Track stream-end for auto-collapse.
  const wasStreaming = React.useRef(streaming);
  React.useEffect(() => {
    if (wasStreaming.current && !streaming) {
      if (elapsedMs === undefined) {
        setDerivedMs(Date.now() - mountedAt.current);
      }
      if (!keepOpenAfterDone) {
        const t = setTimeout(() => setOpen(false), 700);
        return () => clearTimeout(t);
      }
    }
    wasStreaming.current = streaming;
  }, [streaming, elapsedMs, keepOpenAfterDone]);

  const seconds = Math.max(
    1,
    Math.round((elapsedMs ?? derivedMs) / 1000),
  );
  const headerLabel = streaming ? label : `Thought for ${seconds}s`;

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
        className={cn(
          "flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors",
          "hover:bg-accent/40",
        )}
      >
        <Brain
          className={cn(
            "size-4 text-blue-400",
            streaming && "gs-pulse",
          )}
        />
        <span className="flex-1 text-sm font-medium text-foreground/90">
          {headerLabel}
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
          <div
            className={cn(
              "gs-pane-scroll max-h-64 overflow-y-auto border-t border-border/60 px-4 py-3",
              "font-serif text-[13.5px] leading-relaxed text-muted-foreground",
            )}
          >
            <ReasoningBody text={text} streaming={streaming} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Splits the streamed text on whitespace and animates each new word in
 * with a gentle blur+rise. We compare against previous render to avoid
 * re-animating everything on a re-render — React key is "position".
 */
function ReasoningBody({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const words = React.useMemo(() => text.split(/(\s+)/), [text]);
  return (
    <p className="whitespace-pre-wrap">
      {words.map((w, i) =>
        w.match(/^\s+$/) ? (
          <span key={i}>{w}</span>
        ) : (
          <span key={i} className="gs-stream inline">
            {w}
          </span>
        ),
      )}
      {streaming && (
        <span className="gs-caret ml-[2px] inline-block h-[0.9em] w-[2px] translate-y-[2px] bg-blue-400" />
      )}
    </p>
  );
}
