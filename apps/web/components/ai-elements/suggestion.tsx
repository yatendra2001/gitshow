"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Suggestion — canned-ask chips, typically placed above the
 * PromptInput. Click writes the suggestion's text into the input.
 */
export interface SuggestionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export function Suggestion({
  className,
  children,
  ...props
}: SuggestionProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground",
        "transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Suggestions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 px-1",
        className,
      )}
      {...props}
    />
  );
}
