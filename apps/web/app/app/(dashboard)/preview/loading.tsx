import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for /app/preview. Mirrors the new top strip
 * (templates trigger on the left, handle context in the middle) and
 * the full-bleed template viewport beneath it. The bottom-right
 * floating button is gone — actions live in the strip now.
 */
export default function Loading() {
  return (
    <div className="portfolio-theme relative">
      <div className="sticky top-14 z-30 -mx-4 sm:-mx-6 mb-2 border-b border-border/40 bg-background/85 backdrop-blur">
        <div className="flex h-10 items-center gap-2 sm:gap-3 px-4 sm:px-6">
          <Skeleton className="h-7 w-32 rounded-full" />
          <Skeleton className="hidden sm:block h-3 w-56" />
          <Skeleton className="ml-auto h-3 w-16 sm:hidden" />
        </div>
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
    </div>
  );
}
