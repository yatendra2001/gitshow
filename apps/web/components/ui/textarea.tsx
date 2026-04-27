"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

/**
 * Textarea with premium focus state — soft 2px ring fade-in instead
 * of a hard binary outline. Border color shifts on hover/focus to
 * signal interactivity.
 *
 * 16px text on mobile prevents iOS auto-zoom (DESIGN.md §7).
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full resize-none rounded-md bg-background px-3 py-2",
          "border border-border text-foreground placeholder:text-muted-foreground/70",
          // 16px on mobile, 14px on desktop — iOS no-zoom rule.
          "text-base sm:text-sm",
          // Hover: subtle border darkening, no jump.
          "hover:border-foreground/20",
          // Focus ring uses --ring at 50% with 2px offset; the
          // 180ms fade is barely perceptible but kills the binary
          // "click → outline appears instantly" feel.
          "outline-none transition-[border-color,box-shadow] duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-0",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
