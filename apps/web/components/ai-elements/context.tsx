"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Activity, Clock } from "lucide-react";

/**
 * Context — the live cost / LLM-calls / ETA HUD pill. Drops into the
 * top of the progress pane. Not the full AI Elements Context (with
 * token ring + hover card) — a minimal readable version tuned for
 * our scan loop. We can upgrade later.
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

export function CostPill({
  costCents,
  llmCalls,
}: {
  costCents: number;
  llmCalls: number;
}) {
  return (
    <HudPill
      icon={<Activity />}
      label="cost"
      value={`$${(costCents / 100).toFixed(2)} · ${llmCalls} calls`}
    />
  );
}

export function EtaPill({ etaMs }: { etaMs: number }) {
  const minutes = Math.max(0, Math.round(etaMs / 60000));
  const text = minutes < 1 ? "<1m" : `${minutes}m`;
  return <HudPill icon={<Clock />} label="eta" value={text} />;
}
