import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for `/app/preview`.
 *
 * Matches `_template-preview.tsx`: a sticky strip at the top (handle
 * context · save actions · templates trigger), then the chosen
 * template renders FULL-BLEED beneath it. The earlier iteration of
 * this skeleton mocked a grid of template tiles, but the real page
 * doesn't show tiles at all — picking a template happens inside the
 * popover trigger. The grid was visual debt from an older layout.
 */
export default function Loading() {
  return (
    <div className="portfolio-theme relative">
      {/* Sticky strip */}
      <div className="sticky top-14 z-50 -mx-4 sm:-mx-6 mb-3 border-b border-border/40 bg-background/85 backdrop-blur">
        <div className="flex h-12 items-center gap-3 sm:gap-4 px-4 sm:px-6 lg:px-8">
          <Skeleton className="hidden sm:block h-3 w-56" />
          <Skeleton className="h-3 w-20 sm:hidden" />
          <Skeleton className="ml-auto h-7 w-32 rounded-full" />
        </div>
      </div>

      {/* Template body — one full-bleed silhouette, not a grid. */}
      <div className="px-4 sm:px-6 pb-24 pt-6">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          {/* Hero block */}
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="size-16 rounded-full" />
            <Skeleton className="h-7 w-2/3 max-w-md rounded-md" />
            <Skeleton className="h-3 w-1/2 max-w-sm" />
            <div className="mt-1 flex gap-2">
              <Skeleton className="h-7 w-24 rounded-md" />
              <Skeleton className="h-7 w-20 rounded-md" />
              <Skeleton className="h-7 w-28 rounded-md" />
            </div>
          </div>

          {/* Content section — about / intro */}
          <div className="space-y-2.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-[92%]" />
            <Skeleton className="h-3 w-[78%]" />
          </div>

          {/* Projects / work grid */}
          <div className="space-y-2.5">
            <Skeleton className="h-3 w-24" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
            </div>
          </div>

          {/* Skills row */}
          <div className="space-y-2.5">
            <Skeleton className="h-3 w-20" />
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-20 rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
