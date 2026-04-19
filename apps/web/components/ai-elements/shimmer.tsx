"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shimmer — animated loading text. One CSS trick: a horizontal linear
 * gradient ("mostly the foreground color, a brighter streak in the
 * middle, back to foreground"), sized 2× wider than the text, clipped
 * to the glyphs via `bg-clip-text text-transparent`, and the position
 * slid across by the `gs-shimmer` keyframes.
 *
 * Why this over the earlier version: the old one stacked a
 * `before:` pseudo-element on top of the text, which visually hid
 * whatever was behind it. This is pure `bg-clip-text`, so the text
 * stays readable — only the brightness sweeps. Matches the Cursor /
 * Claude "agent is thinking" shimmer feel.
 */
export interface ShimmerProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  /** Seconds per full sweep. Lower = faster. Default 2.4. */
  duration?: number;
  as?: "span" | "div";
}

export function Shimmer({
  duration = 2.4,
  as: Comp = "span",
  className,
  children,
  style,
  ...props
}: ShimmerProps) {
  return (
    <Comp
      className={cn(
        "inline-block bg-clip-text text-transparent",
        "[background-size:200%_100%]",
        className,
      )}
      style={{
        // `currentColor` resolves to `transparent` once `text-transparent`
        // kicks in (that's literally what the utility does), which would
        // make the whole shimmer invisible. Use `var(--foreground)`
        // directly so the gradient has real colors to clip against.
        backgroundImage:
          "linear-gradient(90deg, color-mix(in oklch, var(--foreground), transparent 55%) 0%, color-mix(in oklch, var(--foreground), transparent 55%) 35%, var(--foreground) 50%, color-mix(in oklch, var(--foreground), transparent 55%) 65%, color-mix(in oklch, var(--foreground), transparent 55%) 100%)",
        animation: `gs-shimmer-sweep ${duration}s linear infinite`,
        ...style,
      }}
      {...props}
    >
      {children}
      <style jsx>{`
        @keyframes gs-shimmer-sweep {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          :global(.gs-shimmer-static) {
            animation: none !important;
            background-image: none !important;
            color: currentColor !important;
          }
        }
      `}</style>
    </Comp>
  );
}
