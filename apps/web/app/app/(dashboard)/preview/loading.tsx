import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for /app/preview. Mirrors the draft strip + a
 * full-bleed template viewport so the page settles instantly while the
 * R2 read + chosen template chunk arrive.
 */
export default function Loading() {
  return (
    <div className="portfolio-theme relative">
      <div className="sticky top-14 z-20 -mx-4 sm:-mx-6 mb-2 flex h-9 items-center justify-between gap-3 border-b border-border/40 bg-background/85 px-4 sm:px-6 backdrop-blur">
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-3 w-32 hidden sm:block" />
      </div>
      <div className="px-4 sm:px-6 pb-24 pt-6">
        <Skeleton className="mx-auto h-12 w-2/3 max-w-md rounded-lg" />
        <Skeleton className="mx-auto mt-3 h-3 w-1/2 max-w-sm" />
        <div className="mx-auto mt-10 grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-3">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
        <div className="mx-auto mt-4 grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </div>
      <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2">
        <Skeleton className="h-11 w-32 rounded-full" />
      </div>
    </div>
  );
}
