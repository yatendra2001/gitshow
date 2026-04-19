"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * HudPill — small labelled pill with an icon, used by the progress
 * pane header ("NOW Reading your code", "reviewer PASS 88/100").
 * Deliberately minimal. AI Elements has a full Context primitive with
 * token rings + hover cards; we don't need that here — cost + ETA
 * were removed from the HUD as user-facing noise.
 */
export function HudPill({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs",
        className,
      )}
    >
      <span className="text-muted-foreground [&>svg]:size-3.5">{icon}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}
