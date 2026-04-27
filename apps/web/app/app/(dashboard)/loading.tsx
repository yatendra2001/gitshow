import { Skeleton, KpiCardSkeleton, SectionCardSkeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for /app while the analytics dashboard loads.
 *
 * Lays out the same boxes the published-state dashboard renders so the
 * shell snaps in instantly on click and the data slots fill in. The
 * empty / scanning / draft states are tiny enough that they replace
 * this fallback in well under a frame, so we don't try to be clever
 * about which state is loading.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-2.5 h-7 w-44" />
          <Skeleton className="mt-2 h-3 w-56" />
        </div>
        <Skeleton className="h-7 w-44 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-3">
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
      </div>

      <div className="mb-3">
        <SectionCardSkeleton title="Views over time" subtitle="Daily totals" height={260} />
      </div>
      <div className="mb-3">
        <SectionCardSkeleton title="Visit timing" subtitle="When readers show up, by hour of day" height={140} />
      </div>
      <div className="mb-3">
        <SectionCardSkeleton title="Top countries" subtitle="Geographic reach" height={300} />
      </div>
      <div className="mb-3">
        <SectionCardSkeleton title="Top sources" subtitle="Where visitors came from" height={220} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mb-3">
        <SectionCardSkeleton title="Devices" subtitle="What people read you on" height={200} />
        <SectionCardSkeleton title="Browsers" subtitle="Engines doing the rendering" height={200} />
      </div>
      <div className="grid grid-cols-1 gap-3">
        <SectionCardSkeleton title="Recent activity" subtitle="Latest visitors" height={240} />
      </div>
    </div>
  );
}
