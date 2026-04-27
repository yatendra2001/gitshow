"use client";

/**
 * <Reveal> — IntersectionObserver-driven reveal-on-scroll wrapper.
 *
 * CSS-only motion (uses .reveal/.is-visible utilities defined in
 * globals.css). Avoids motion/react when all we need is a one-shot
 * fade + translate. Keeps bundle smaller and ssr-friendly.
 *
 * Usage:
 *   <Reveal>...</Reveal>
 *   <Reveal as="section" delay={120}>...</Reveal>
 *   <Reveal once={false}>...</Reveal>   // re-trigger on every entry
 *
 * Don't use this inside the dashboard — see DESIGN.md §9. Marketing
 * surfaces only.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

type AsTag = "div" | "section" | "article" | "header" | "footer" | "main" | "aside" | "nav" | "ul" | "ol" | "li" | "p" | "span";

export interface RevealProps extends React.HTMLAttributes<HTMLElement> {
  /** HTML tag to render. Default `div`. */
  as?: AsTag;
  /** Delay before the reveal triggers, in ms. 0 = immediate. */
  delay?: number;
  /** Re-run the animation each time the element re-enters view. */
  once?: boolean;
  /** Threshold (0–1) of element visible before triggering. */
  amount?: number;
  /** Skip the animation entirely (e.g. when inside a parent already
   *  orchestrating motion). */
  disabled?: boolean;
}

export function Reveal({
  as = "div",
  delay = 0,
  once = true,
  amount = 0.2,
  disabled = false,
  className,
  children,
  ...rest
}: RevealProps) {
  // React.createElement avoids the polymorphic-tag generic dance —
  // works for any HTML tag without TS jumping through hoops.
  const ref = React.useRef<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = React.useState(disabled);

  React.useEffect(() => {
    if (disabled) {
      setIsVisible(true);
      return;
    }
    const node = ref.current;
    if (!node) return;

    // Respect prefers-reduced-motion — skip observer, show immediately.
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setIsVisible(true);
      return;
    }

    // Fallback: if IntersectionObserver isn't supported (or never
    // fires — e.g. background tabs in some headless browsers),
    // reveal everything after a short timeout. Keeps the UI from
    // ever staying invisible.
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    // If the element is already in view at mount time (above the
    // fold), reveal immediately — don't wait for the observer's
    // first async fire, which can flash empty content.
    const rect = node.getBoundingClientRect();
    const inViewportNow =
      rect.top < window.innerHeight && rect.bottom > 0;

    if (inViewportNow) {
      if (delay > 0) {
        const id = window.setTimeout(() => setIsVisible(true), delay);
        return () => window.clearTimeout(id);
      }
      setIsVisible(true);
      if (once) return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (delay > 0) {
              const id = window.setTimeout(() => setIsVisible(true), delay);
              if (once) observer.disconnect();
              return () => window.clearTimeout(id);
            }
            setIsVisible(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setIsVisible(false);
          }
        }
      },
      { threshold: amount, rootMargin: "0px 0px -10% 0px" },
    );

    observer.observe(node);

    // Safety net — if the observer hasn't fired in 1.2s
    // (background tab, observer bug, etc.), force-reveal so the
    // user never sees a stuck-empty section when they scroll to it.
    const safetyId = window.setTimeout(() => {
      setIsVisible(true);
      observer.disconnect();
    }, 1200);

    return () => {
      observer.disconnect();
      window.clearTimeout(safetyId);
    };
  }, [delay, once, amount, disabled]);

  return React.createElement(
    as,
    {
      ref,
      className: cn("reveal", isVisible && "is-visible", className),
      ...rest,
    },
    children,
  );
}
