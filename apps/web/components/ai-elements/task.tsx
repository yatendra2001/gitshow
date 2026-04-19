"use client";

import * as React from "react";
import { ChevronRight, Check, Circle, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Task — one pipeline phase or sub-worker in the progress pane.
 * Collapsible; status dot reflects state. One Task per phase with
 * nested TaskItems for worker updates, reasoning blocks, etc.
 */

export type TaskStatus = "pending" | "running" | "done" | "warn" | "failed";

export interface TaskProps extends React.HTMLAttributes<HTMLDivElement> {
  status?: TaskStatus;
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  defaultOpen?: boolean;
}

export function Task({
  status = "pending",
  title,
  subtitle,
  rightSlot,
  defaultOpen = true,
  className,
  children,
  ...props
}: TaskProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card",
        status === "running" && "ring-1 ring-blue-500/30",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <StatusDot status={status} />
        <div className="flex-1 overflow-hidden">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {subtitle && (
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        {rightSlot}
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && children && (
        <div className="border-t border-border px-3 py-2">{children}</div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: TaskStatus }) {
  switch (status) {
    case "pending":
      return <Circle className="size-4 text-muted-foreground/50" />;
    case "running":
      return (
        <div className="relative size-4">
          <Circle className="absolute inset-0 size-4 text-blue-500/30" />
          <div className="absolute inset-[2px] size-3 animate-pulse rounded-full bg-blue-500" />
        </div>
      );
    case "done":
      return (
        <div className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Check className="size-2.5" strokeWidth={3} />
        </div>
      );
    case "warn":
      return <AlertTriangle className="size-4 text-amber-500" />;
    case "failed":
      return (
        <div className="flex size-4 items-center justify-center rounded-full bg-red-500 text-white">
          <X className="size-2.5" strokeWidth={3} />
        </div>
      );
  }
}

export function TaskItem({
  className,
  children,
  status,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { status?: TaskStatus }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 py-1 font-mono text-[11px] leading-relaxed",
        className,
      )}
      {...props}
    >
      {status && (
        <div className="mt-0.5">
          <StatusDot status={status} />
        </div>
      )}
      <div className="flex-1 text-muted-foreground">{children}</div>
    </div>
  );
}
