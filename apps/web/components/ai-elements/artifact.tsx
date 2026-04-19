"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Artifact — wraps a generated output (profile card, code, etc.) with
 * a header that exposes actions like Copy/Regenerate/Share. Everything
 * inside ArtifactContent renders live as soon as the first claim
 * lands; the header stays stable.
 */

export function Artifact({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ArtifactHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border bg-background/50 px-4 py-2",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ArtifactTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function ArtifactActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

export function ArtifactContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex-1 overflow-y-auto", className)}
      {...props}
    />
  );
}
