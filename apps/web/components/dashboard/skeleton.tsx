/**
 * Skeleton primitives for dashboard loading states.
 *
 * Calmer than the default shadcn skeleton: a single soft pulse on a
 * muted token, no gradient sheen. Matches the dashboard's "uniform
 * hairline + bg-card/60" surface so swap-in is invisible — the
 * skeleton lays out the same boxes the real content fills.
 *
 * Animation runs on `opacity` only (composited, no paint), and
 * `motion-reduce:animate-none` respects user preferences.
 */

import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-md bg-foreground/[0.06]",
        "motion-safe:animate-pulse",
        className,
      )}
      {...rest}
    />
  );
}

/**
 * Card-shell skeleton mirroring `SectionCard` from analytics-cards.
 * Use as the placeholder inside a Suspense boundary that wraps a
 * SectionCard's children.
 */
export function SectionCardSkeleton({
  height = 220,
  title,
  subtitle,
  className,
}: {
  height?: number;
  title?: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/50 bg-card/60 p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {title ? (
            <h3 className="text-[13px] font-semibold leading-tight tracking-tight">
              {title}
            </h3>
          ) : (
            <Skeleton className="h-3 w-28" />
          )}
          {subtitle ? (
            <p className="mt-1 text-[11.5px] text-muted-foreground/80 leading-tight">
              {subtitle}
            </p>
          ) : (
            <Skeleton className="mt-2 h-2.5 w-40" />
          )}
        </div>
      </div>
      <Skeleton style={{ height }} className="w-full rounded-xl" />
    </div>
  );
}

/**
 * KPI card skeleton mirroring `KpiCard`. The four KPI cards on the
 * analytics page use this so the grid layout settles instantly.
 */
export function KpiCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-4">
      <Skeleton className="h-2.5 w-16" />
      <Skeleton className="mt-3 h-7 w-24" />
      <div className="mt-3 flex items-end gap-1">
        <Skeleton className="h-1.5 w-2" />
        <Skeleton className="h-2.5 w-2" />
        <Skeleton className="h-3.5 w-2" />
        <Skeleton className="h-2 w-2" />
        <Skeleton className="h-3 w-2" />
        <Skeleton className="h-4 w-2" />
        <Skeleton className="h-2.5 w-2" />
      </div>
    </div>
  );
}
