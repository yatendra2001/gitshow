"use client";

/**
 * <Stagger> + <StaggerItem> — orchestrates a sequence of children
 * fading in with a per-item delay. Built on top of <Reveal> so it
 * inherits prefers-reduced-motion and the .reveal/.is-visible
 * utility set.
 *
 * Usage:
 *   <Stagger gap={60}>
 *     <StaggerItem>One</StaggerItem>
 *     <StaggerItem>Two</StaggerItem>
 *     <StaggerItem>Three</StaggerItem>
 *   </Stagger>
 *
 * `gap` is the ms between each child. Default 80ms (slow enough to
 * feel deliberate, fast enough that a long list doesn't crawl).
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

const StaggerCtx = React.createContext<{ gap: number; baseDelay: number }>({
  gap: 80,
  baseDelay: 0,
});

export function Stagger({
  gap = 80,
  baseDelay = 0,
  className,
  children,
  ...rest
}: {
  gap?: number;
  baseDelay?: number;
  className?: string;
  children?: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <StaggerCtx.Provider value={{ gap, baseDelay }}>
      <div className={cn(className)} {...rest}>
        {React.Children.map(children, (child, i) => {
          if (!React.isValidElement(child)) return child;
          // Only inject index into <StaggerItem>.
          if ((child.type as { __isStaggerItem?: boolean }).__isStaggerItem) {
            return React.cloneElement(child as React.ReactElement<{ index?: number }>, { index: i });
          }
          return child;
        })}
      </div>
    </StaggerCtx.Provider>
  );
}

export function StaggerItem({
  index = 0,
  className,
  children,
  ...rest
}: {
  index?: number;
  className?: string;
  children?: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { gap, baseDelay } = React.useContext(StaggerCtx);
  return (
    <Reveal delay={baseDelay + index * gap} className={className} {...rest}>
      {children}
    </Reveal>
  );
}
// Sentinel — Stagger checks this to know which children to index.
(StaggerItem as unknown as { __isStaggerItem: boolean }).__isStaggerItem = true;
