"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shimmer — animated loading text. Drops a moving gradient over the
 * foreground color so "Drafting hero hook…" pulses while the worker
 * writes claims. Pure CSS, no framer-motion dep.
 */
export interface ShimmerProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  duration?: number;
  as?: "span" | "div";
}

export function Shimmer({
  duration = 2,
  as: Comp = "span",
  className,
  children,
  style,
  ...props
}: ShimmerProps) {
  return (
    <Comp
      className={cn(
        "relative inline-block bg-clip-text text-transparent",
        "before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent",
        className,
      )}
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--foreground) 0%, var(--foreground) 40%, color-mix(in oklch, var(--foreground), transparent 60%) 50%, var(--foreground) 60%, var(--foreground) 100%)",
        backgroundSize: "200% 100%",
        animation: `gs-shimmer ${duration}s linear infinite`,
        ...style,
      }}
      {...props}
    >
      {children}
      <style jsx>{`
        @keyframes gs-shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>
    </Comp>
  );
}
