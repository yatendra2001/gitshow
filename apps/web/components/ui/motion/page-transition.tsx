"use client";

/**
 * <PageTransition> — keyed reveal that runs whenever the
 * `pathname` changes. Wraps the dashboard <main> so navigating
 * between Analytics → Edit → Resume etc. fades + slides 6px instead
 * of snap-replacing.
 *
 * Why not motion's `AnimatePresence` mode="wait"?
 *   Pages in our app render their own loading skeletons; pausing
 *   the unmount delays skeleton paint and feels sluggish. The
 *   keyed-mount approach swaps content immediately and reveals it
 *   in 200ms. Net feel: snappy + intentional.
 *
 * Reduced-motion: the reveal is skipped entirely (children appear
 * instantly).
 */

import * as React from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export function PageTransition({ children, className }: PageTransitionProps) {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        ease: [0.215, 0.61, 0.355, 1] as [number, number, number, number],
      }}
      className={cn("will-change-transform", className)}
    >
      {children}
    </motion.div>
  );
}
