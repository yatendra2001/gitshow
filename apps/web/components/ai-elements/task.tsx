"use client";

import * as React from "react";
import { ChevronDown, Circle, Check, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Task — upgrade of the earlier Task primitive to match the AI Elements
 * reference pattern. A Task is a collapsible header with an indented
 * child list; each child can be a plain line, a file chip row, or a
 * nested Task.
 *
 * Pattern mirrors ChatGPT/Cursor/Claude's search-task UIs: one clean
 * header per activity, a left-hinge border for nesting, status dot on
 * the left, chevron on the right.
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
        "gs-enter rounded-xl border border-border bg-card/70 backdrop-blur-sm",
        status === "running" && "ring-1 ring-blue-500/30",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/40"
      >
        <StatusDot status={status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground/95">
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        {rightSlot}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
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
          {children && (
            <div className="relative border-t border-border/60 px-3.5 py-2.5">
              {/* Tree hinge */}
              <span
                aria-hidden
                className="absolute bottom-2 left-[18px] top-2 w-px bg-border"
              />
              <div className="space-y-1 pl-5">{children}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusDot({
  status,
  size = "sm",
}: {
  status: TaskStatus;
  size?: "xs" | "sm";
}) {
  const d = size === "xs" ? 10 : 14;
  if (status === "running") {
    return (
      <span
        className="relative flex items-center justify-center"
        style={{ width: d, height: d }}
      >
        <span
          className="absolute inline-flex animate-ping rounded-full bg-blue-500 opacity-70"
          style={{ width: d - 4, height: d - 4 }}
        />
        <span
          className="relative inline-flex rounded-full bg-blue-500"
          style={{ width: d - 4, height: d - 4 }}
        />
      </span>
    );
  }
  if (status === "done") {
    return (
      <span
        className="flex items-center justify-center rounded-full bg-emerald-500/90 text-white"
        style={{ width: d, height: d }}
      >
        <Check
          style={{ width: d * 0.55, height: d * 0.55 }}
          strokeWidth={3.5}
        />
      </span>
    );
  }
  if (status === "warn") {
    return (
      <AlertTriangle
        className="text-amber-400"
        style={{ width: d, height: d }}
      />
    );
  }
  if (status === "failed") {
    return (
      <span
        className="flex items-center justify-center rounded-full bg-red-500/90 text-white"
        style={{ width: d, height: d }}
      >
        <X
          style={{ width: d * 0.55, height: d * 0.55 }}
          strokeWidth={3.5}
        />
      </span>
    );
  }
  return (
    <Circle
      className="text-muted-foreground/40"
      style={{ width: d, height: d }}
    />
  );
}
