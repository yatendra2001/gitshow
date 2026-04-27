import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for /app/billing. Tiny page — just the plan card
 * silhouette so the click feels instant.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <section className="px-4 sm:px-6 lg:px-8 py-10">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="mt-2.5 h-8 w-56" />
        <div className="mt-6 rounded-2xl border border-border/40 bg-card/30 p-6">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <Skeleton className="h-5 w-28" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
            <Skeleton className="h-5 w-20" />
          </div>
          <div className="mt-6 border-t border-border/30 pt-4">
            <Skeleton className="h-3 w-44" />
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Skeleton className="h-11 w-44 rounded-xl" />
          </div>
        </div>
      </section>
    </div>
  );
}
