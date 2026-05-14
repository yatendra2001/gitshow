import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for `/app/domain` — custom domain settings.
 *
 * Without this file the route inherited the parent
 * `(dashboard)/loading.tsx` (the analytics KPI dashboard skeleton),
 * which has nothing to do with this surface — the user clicked
 * "Custom domain" and saw the dashboard silhouette flash before the
 * real page swapped in.
 *
 * Mirrors `page.tsx`: max-w-3xl container, an eyebrow + h1 + sub
 * header (with a right-aligned link slot), then the `<DomainPanel>`
 * card silhouette underneath (header strip + input row + helper line).
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
        <div>
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="mt-2 h-8 w-56" />
          <Skeleton className="mt-3 h-3 w-72" />
        </div>
        <Skeleton className="h-7 w-44 self-start rounded-md" />
      </header>

      <div className="rounded-2xl border border-border/40 bg-card/30">
        <div className="px-5 py-4 border-b border-border/30">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
        <div className="px-5 py-5 space-y-3">
          <Skeleton className="h-2.5 w-24" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-10 flex-1 rounded-md" />
            <Skeleton className="h-10 w-32 rounded-md" />
          </div>
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </div>
  );
}
