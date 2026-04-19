"use client";

import * as React from "react";
import { ChevronDown, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tool — per-invocation card showing one tool call.
 *
 * Header: icon · tool name · status badge · chevron
 * Body (open): parameters JSON + result preview
 *
 * Status enum mirrors AI Elements' ToolUIPart state:
 *   pending | running | completed | error | awaiting-approval | denied
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
  /** Shown in monospace inside a fenced block; we stringify objects. */
  input?: unknown;
  output?: unknown;
  /** Error message when status === "error". */
  error?: string;
  /** Shown after the tool name (e.g. a brief purpose). */
  subtitle?: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
}

const STATUS_STYLES: Record<ToolStatus, { label: string; cls: string }> = {
  pending: {
    label: "Pending",
    cls: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  },
  running: {
    label: "Running",
    cls: "border-blue-500/40 bg-blue-500/15 text-blue-300",
  },
  completed: {
    label: "Completed",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  error: {
    label: "Error",
    cls: "border-red-500/40 bg-red-500/15 text-red-300",
  },
  "awaiting-approval": {
    label: "Awaiting Approval",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  denied: {
    label: "Denied",
    cls: "border-red-500/40 bg-red-500/10 text-red-400",
  },
};

export function Tool({
  name,
  status,
  input,
  output,
  error,
  subtitle,
  icon,
  defaultOpen = false,
  className,
  ...props
}: ToolProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const hasBody = input !== undefined || output !== undefined || error;

  return (
    <div
      className={cn(
        "gs-enter rounded-lg border border-border bg-card/70 backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left",
          hasBody && "transition-colors hover:bg-accent/40",
          !hasBody && "cursor-default",
        )}
      >
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md border",
            status === "running"
              ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
              : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          {icon ?? <Wrench className="size-3" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 truncate font-mono text-[12.5px] font-medium text-foreground">
            {name}
          </span>
          {subtitle && (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {subtitle}
            </span>
          )}
        </span>
        <StatusBadge status={status} />
        {hasBody && (
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
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
            <div className="space-y-3 border-t border-border/60 px-3 py-3">
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

function StatusBadge({ status }: { status: ToolStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider",
        s.cls,
      )}
    >
      {status === "running" && (
        <span className="size-1 rounded-full bg-current gs-pulse" />
      )}
      {s.label}
    </span>
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
          "mb-1 font-mono text-[10px] uppercase tracking-wider",
          variant === "error" ? "text-red-400" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <pre
        className={cn(
          "rounded-md border border-border/70 bg-background/60 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed",
          variant === "error"
            ? "text-red-300"
            : "text-foreground/90",
          "overflow-x-auto whitespace-pre-wrap break-all",
        )}
      >
        {text || "—"}
      </pre>
    </div>
  );
}
