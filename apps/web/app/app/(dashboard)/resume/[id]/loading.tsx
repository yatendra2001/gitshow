import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for `/app/resume/[id]` — the editor.
 *
 * Two-column layout: form on the left, scaled preview on the right.
 * On mobile the right column collapses below.
 */
export default function Loading() {
  return (
    <div>
      <div className="sticky top-14 z-10 flex items-center gap-3 border-b border-border/30 bg-background/85 backdrop-blur px-5 h-14">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-40" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-7 w-16 rounded-md" />
          <Skeleton className="h-8 w-32 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        <div className="border-r border-border/30 px-5 py-6 space-y-4">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-32 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
        <div className="hidden lg:flex bg-foreground/[0.015] dark:bg-foreground/[0.04] justify-center px-6 py-8">
          <Skeleton className="aspect-[8.5/11] w-full max-w-2xl rounded-md" />
        </div>
      </div>
    </div>
  );
}
