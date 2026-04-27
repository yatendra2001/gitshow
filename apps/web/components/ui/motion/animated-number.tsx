"use client";

/**
 * <AnimatedNumber> — animates between numeric values with tabular
 * digits so the surrounding layout never shifts.
 *
 * Used in dashboard stat cards. Honours prefers-reduced-motion by
 * jumping directly to the new value.
 *
 * Usage:
 *   <AnimatedNumber value={count} format={(n) => n.toLocaleString()} />
 */

import * as React from "react";
import { cn } from "@/lib/utils";

interface AnimatedNumberProps {
  value: number;
  /** Animation duration in ms. Default 700. */
  duration?: number;
  /** Format function (e.g. n => `${n}%`). Default: toLocaleString(). */
  format?: (n: number) => string;
  className?: string;
}

export function AnimatedNumber({
  value,
  duration = 700,
  format = (n) => Math.round(n).toLocaleString(),
  className,
}: AnimatedNumberProps) {
  const [displayed, setDisplayed] = React.useState(value);
  const fromRef = React.useRef(value);
  const startRef = React.useRef<number | null>(null);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce || value === fromRef.current) {
      setDisplayed(value);
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    const to = value;
    startRef.current = null;

    const tick = (ts: number) => {
      if (startRef.current == null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // ease-out-cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplayed(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return (
    <span className={cn("tabular", className)} aria-live="polite">
      {format(displayed)}
    </span>
  );
}
