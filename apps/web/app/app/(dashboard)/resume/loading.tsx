import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for `/app/resume` — the row list.
 *
 * Mirrors the real layout: sticky title row up top, then a vertical
 * stack of full-width row placeholders. Container is `max-w-3xl` to
 * match the live list — anything wider would shift the layout on
 * swap.
 */
export default function Loading() {
  return (
    <div>
      <div className="sticky top-14 z-10 flex items-center gap-3 border-b border-border/30 bg-background/85 backdrop-blur px-5 h-14">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="ml-auto h-8 w-28 rounded-md" />
      </div>
      <main className="mx-auto w-full max-w-3xl px-5 sm:px-6 py-6 sm:py-8">
        <ul className="flex flex-col gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i}>
              <div className="rounded-lg border border-border/30 px-4 py-3 flex items-center gap-3.5 min-h-16">
                <Skeleton className="size-4 rounded-full" />
                <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-[42%]" />
                  <Skeleton className="h-3 w-[78%]" />
                </div>
                <Skeleton className="hidden sm:block h-3 w-12" />
                <Skeleton className="size-3 rounded" />
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
