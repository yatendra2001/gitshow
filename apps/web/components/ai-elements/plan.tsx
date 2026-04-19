"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { Shimmer } from "./shimmer";

/**
 * Plan — "here's what I'll do" card. Top of the progress pane when a
 * scan is running or a revise is mid-flight. `isStreaming` flips on
 * the shimmer for the title.
 */

export interface PlanProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  eta?: string;
  isStreaming?: boolean;
}

export function Plan({
  title,
  description,
  eta,
  isStreaming,
  className,
  children,
  ...props
}: PlanProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-gradient-to-b from-card to-card/60 p-3 shadow-sm",
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-blue-500" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-foreground">
            {isStreaming ? (
              <Shimmer duration={2.4}>{title}</Shimmer>
            ) : (
              title
            )}
          </div>
          {description && (
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        {eta && (
          <div className="shrink-0 rounded-md bg-accent px-2 py-1 font-mono text-[10px] font-semibold text-accent-foreground">
            {eta}
          </div>
        )}
      </div>
      {children && <div className="mt-3 border-t border-border pt-3">{children}</div>}
    </div>
  );
}
