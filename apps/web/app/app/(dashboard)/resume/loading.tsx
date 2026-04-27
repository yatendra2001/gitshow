import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for /app/resume. Two-column layout: form on the
 * left, printable page preview on the right. On mobile the right
 * column collapses below.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-2.5 h-7 w-44" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,520px)_1fr]">
        <div className="space-y-3">
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-32 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
        <div className="hidden lg:block">
          <Skeleton className="aspect-[8.5/11] w-full max-w-2xl rounded-md" />
        </div>
      </div>
    </div>
  );
}
