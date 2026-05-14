import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for /app/resume — the list view.
 *
 * Mirrors the real layout: sticky title row at the top, then a grid
 * of card placeholders below. The aim is to occupy the same vertical
 * space the real page will, so the swap doesn't jump.
 */
export default function Loading() {
  return (
    <div>
      <div className="sticky top-14 z-10 flex items-center gap-3 border-b border-border/30 bg-background/85 backdrop-blur px-5 h-14">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="ml-auto h-8 w-28 rounded-md" />
      </div>
      <main className="mx-auto w-full max-w-5xl px-5 sm:px-6 py-6 sm:py-8">
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <div className="rounded-lg border border-border/40 bg-card/40 p-4 h-[120px] flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="mt-auto h-3 w-16" />
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
