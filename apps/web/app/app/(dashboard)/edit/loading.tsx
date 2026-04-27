import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for /app/edit. Mirrors the editor shell: tab
 * strip across the top + a column of section forms below. Snaps in
 * the moment the user clicks "Edit" so the click feels instant.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-2.5 h-7 w-40" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5 border-b border-border/40 pb-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-16 rounded-md" />
        ))}
      </div>

      <div className="space-y-4">
        <FormFieldSkeleton lines={1} />
        <FormFieldSkeleton lines={3} />
        <FormFieldSkeleton lines={1} />
        <FormFieldSkeleton lines={2} />
      </div>
    </div>
  );
}

function FormFieldSkeleton({ lines }: { lines: number }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2.5 h-9 w-full rounded-md" />
      {lines > 1
        ? Array.from({ length: lines - 1 }).map((_, i) => (
            <Skeleton key={i} className="mt-1.5 h-9 w-full rounded-md" />
          ))
        : null}
    </div>
  );
}
