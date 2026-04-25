"use client";

import * as React from "react";
import { ChevronDown, Check, AlertTriangle, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import { Matrix } from "@/components/ui/matrix";
import { breathingDot } from "@/components/ui/matrix-loaders";

/**
 * Tool — per-invocation row showing one tool call.
 *
 * Subtle vibe to match Reasoning: hairline left rule (not a card),
 * tiny dot-matrix loader as the running indicator, ShimmeringText
 * on the active label, monospace display name. Click to expand
 * input/output inline if either was emitted.
 */

export type ToolStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "awaiting-approval"
  | "denied";

export interface ToolProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  status: ToolStatus;
  /** Stringified or stringifiable input — JSON in the expanded panel. */
  input?: unknown;
  output?: unknown;
  /** Error message when status === "error". */
  error?: string;
  /** Friendly purpose line, shown next to the tool name when present. */
  subtitle?: string;
  defaultOpen?: boolean;
}

export function Tool({
  name,
  status,
  input,
  output,
  error,
  subtitle,
  defaultOpen = false,
  className,
  ...props
}: ToolProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const hasBody = input !== undefined || output !== undefined || error;
  const running = status === "running";

  return (
    <div
      className={cn(
        // Hairline left rule, no card. Stays out of the way of the
        // surrounding phase row visually.
        "gs-enter relative pl-4 border-l border-border/40",
        running && "border-l-foreground/30",
        status === "error" && "border-l-[var(--destructive)]/50",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2.5 py-1.5 text-left",
          !hasBody && "cursor-default",
        )}
      >
        <StatusGlyph status={status} />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="flex items-center gap-2 truncate text-[12.5px] font-medium tracking-tight">
            {running ? (
              <ShimmeringText
                text={subtitle || name}
                duration={3.4}
                spread={1.1}
                className="text-foreground/60"
              />
            ) : (
              <span
                className={cn(
                  "truncate",
                  status === "completed" && "text-foreground/85",
                  status === "error" && "text-[var(--destructive)]",
                  status === "pending" && "text-muted-foreground/70",
                )}
              >
                {subtitle || name}
              </span>
            )}
          </span>
          {/* Show the technical tool name as a sub-line ONLY when it
              contributes new info. If subtitle is missing OR identical
              to name OR matches the friendly label closely, hide the
              sub-line — repeating "submit_judgment / submit_judgment"
              on every card was pure visual debt. */}
          {subtitle &&
          subtitle !== name &&
          subtitle.toLowerCase() !== name.toLowerCase() ? (
            <span className="block truncate font-mono text-[10.5px] text-muted-foreground/60">
              {name}
            </span>
          ) : null}
        </span>
        {hasBody && (
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
        )}
      </button>

      {hasBody && (
        <div
          className={cn(
            "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="min-h-0">
            <div className="space-y-2 pb-2 pr-1">
              {input !== undefined && (
                <ToolPanel label="Parameters" value={input} />
              )}
              {output !== undefined && (
                <ToolPanel label="Result" value={output} />
              )}
              {error && (
                <ToolPanel label="Error" value={error} variant="error" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Status glyph — running uses the dot-matrix loader, completed shows
 * a small check, error shows a triangle, denied shows a lock. Pending
 * is a faint dot. All sized to ~10px so they sit politely next to
 * the body text.
 */
function StatusGlyph({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return (
      <Matrix
        rows={5}
        cols={5}
        frames={breathingDot}
        fps={10}
        size={3}
        gap={1}
        palette={{ on: "var(--foreground)", off: "transparent" }}
        ariaLabel="Running"
        className="shrink-0"
      />
    );
  }
  if (status === "completed") {
    // Foreground-tinted disc, not coloured. The timeline already has
    // green check ticks on phase rows; another green dot here added
    // noise. Mono-tone reads cleaner.
    return (
      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-foreground/20">
        <Check className="size-2 text-foreground/80" strokeWidth={3} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <AlertTriangle
        className="size-3 shrink-0 text-[var(--destructive)]"
        strokeWidth={2}
      />
    );
  }
  if (status === "denied") {
    return (
      <Lock
        className="size-3 shrink-0 text-muted-foreground/70"
        strokeWidth={2}
      />
    );
  }
  return (
    <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/30" />
  );
}

function ToolPanel({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: unknown;
  variant?: "default" | "error";
}) {
  const text =
    typeof value === "string"
      ? value
      : value === null || value === undefined
        ? ""
        : JSON.stringify(value, null, 2);
  return (
    <div>
      <div
        className={cn(
          "mb-1 font-mono text-[9.5px] uppercase tracking-[0.08em]",
          variant === "error"
            ? "text-[var(--destructive)]/80"
            : "text-muted-foreground/55",
        )}
      >
        {label}
      </div>
      <pre
        className={cn(
          "rounded-md bg-foreground/[0.04] px-2.5 py-2 font-mono text-[11px] leading-relaxed",
          variant === "error"
            ? "text-[var(--destructive)]/90"
            : "text-foreground/75",
          "overflow-x-auto whitespace-pre-wrap break-all",
        )}
      >
        {text || "—"}
      </pre>
    </div>
  );
}
