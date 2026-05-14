import { Skeleton } from "@/components/dashboard/skeleton";

/**
 * Streaming fallback for `/app/edit`. Mirrors the editor shell: a
 * page header with title + save chip + publish button, then a
 * 200px-sidebar + content-card layout matching `_editor.tsx`. Snaps
 * in instantly so the click feels responsive.
 *
 * Stays in sync with the real `<Header>` + `<Sidebar>` + `<SectionView>`
 * structure — any layout drift there means this needs touching too.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 flex flex-col gap-5">
      {/* Header — title block + save chip + publish */}
      <header className="flex items-end justify-between gap-3">
        <div>
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-2.5 h-7 w-44" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-24 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
        {/* Sidebar — vertical list of section nav items */}
        <nav className="flex flex-col gap-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md" />
          ))}
        </nav>

        {/* Content card — section view */}
        <div className="rounded-2xl border border-border/40 bg-card/40 p-5 sm:p-6 min-h-[60vh] space-y-4">
          <div>
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-2 h-5 w-40" />
          </div>
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-32 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}
