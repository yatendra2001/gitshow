"use client";

/**
 * `/app/resume` client surface — the home of resumes.
 *
 * Layout: sticky title row with "+ New resume" CTA, then a grid of
 * cards (one per JD). Click a card → that resume's editor. Empty
 * state nudges the user with one line of copy.
 *
 * Copy is intentionally terse — no marketing paragraphs, no
 * reassurance prose. The product speaks for itself.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MagicWand01Icon,
  JobSearchIcon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import type {
  TailoredResume,
  TailoredResumeMeta,
} from "@gitshow/shared/tailored-resume";
import { tailoredDisplayLabel } from "@gitshow/shared/tailored-resume";
import { NewResumeDialog } from "./_dialog";
import { cn } from "@/lib/utils";

export function ResumeList({
  initialItems,
  hasPortfolio,
}: {
  initialItems: TailoredResumeMeta[];
  hasPortfolio: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<TailoredResumeMeta[]>(initialItems);
  const [dialogOpen, setDialogOpen] = useState(false);

  const onCreated = useCallback(
    (tailored: TailoredResume) => {
      // Optimistically prepend so the new card flashes in even before
      // the navigation resolves.
      setItems((prev) => [
        tailored.meta,
        ...prev.filter((it) => it.id !== tailored.meta.id),
      ]);
      setDialogOpen(false);
      router.push(`/app/resume/${tailored.meta.id}`);
    },
    [router],
  );

  return (
    <div className="flex flex-col min-h-[calc(100svh-3.5rem)]">
      <div className="sticky top-14 z-10 flex items-center gap-3 border-b border-border/30 bg-background/85 backdrop-blur px-5 h-14">
        <h1 className="text-[13px] font-medium tracking-tight">Resumes</h1>
        {items.length > 0 ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {items.length}
          </span>
        ) : null}
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={!hasPortfolio}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md h-8 px-3 text-[12.5px] font-medium",
              "bg-foreground text-background min-h-9",
              "transition-[opacity] duration-150 ease",
              "hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed",
            )}
            title={
              hasPortfolio
                ? undefined
                : "Run a portfolio scan first — every resume is built from it."
            }
          >
            <HugeiconsIcon icon={MagicWand01Icon} size={13} strokeWidth={2} />
            New resume
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-3xl px-5 sm:px-6 py-6 sm:py-8">
        {!hasPortfolio ? (
          <NoPortfolioState />
        ) : items.length === 0 ? (
          <EmptyState onNew={() => setDialogOpen(true)} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((meta) => (
              <li key={meta.id}>
                <ResumeRow meta={meta} />
              </li>
            ))}
          </ul>
        )}
      </main>

      <NewResumeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={onCreated}
      />
    </div>
  );
}

/**
 * Horizontal list row. One row per resume, full-width, tight vertical
 * stack. Hover is a triple-subtle move — bg fades in, the chevron
 * nudges + brightens, the leading icon lifts in color — each step
 * faint enough to read as polish rather than chrome.
 */
function ResumeRow({ meta }: { meta: TailoredResumeMeta }) {
  const label = tailoredDisplayLabel(meta);
  const rel = useRelativeTime(meta.createdAt);
  return (
    <Link
      href={`/app/resume/${meta.id}`}
      className={cn(
        "group block rounded-lg border border-border/30",
        "px-4 py-3 flex items-center gap-3.5",
        "transition-[background-color,border-color] duration-150 ease",
        "hover:border-border/60 hover:bg-foreground/[0.025]",
        "outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
        "min-h-16",
      )}
      aria-label={`Open resume: ${label}`}
    >
      <HugeiconsIcon
        icon={JobSearchIcon}
        size={15}
        strokeWidth={2}
        className="shrink-0 text-muted-foreground/60 transition-colors duration-150 ease group-hover:text-foreground/85"
      />
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <span className="truncate text-[13.5px] font-medium text-foreground">
          {label}
        </span>
        <span className="truncate text-[12px] text-muted-foreground/75">
          {meta.jdExcerpt}
        </span>
      </div>
      <span className="hidden sm:inline-block shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
        {rel}
      </span>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={13}
        strokeWidth={2}
        className="shrink-0 text-muted-foreground/30 transition-[transform,color] duration-150 ease group-hover:translate-x-0.5 group-hover:text-foreground/70"
      />
    </Link>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/50 bg-foreground/[0.015] py-14 px-6 flex flex-col items-center text-center">
      <div className="mb-3 inline-flex size-9 items-center justify-center rounded-full bg-foreground/[0.05]">
        <HugeiconsIcon icon={MagicWand01Icon} size={16} strokeWidth={2} />
      </div>
      <p className="text-[13.5px] text-foreground">
        Drop a job description to build your first resume.
      </p>
      <button
        type="button"
        onClick={onNew}
        className={cn(
          "mt-4 inline-flex items-center gap-1.5 rounded-md h-9 px-3.5 text-[13px] font-medium",
          "bg-foreground text-background min-h-9",
          "transition-[opacity] duration-150 ease",
          "hover:opacity-90",
        )}
      >
        <HugeiconsIcon icon={MagicWand01Icon} size={14} strokeWidth={2} />
        New resume
      </button>
    </div>
  );
}

function NoPortfolioState() {
  return (
    <div className="rounded-xl border border-dashed border-border/50 bg-foreground/[0.015] py-14 px-6 flex flex-col items-center text-center">
      <p className="text-[13.5px] text-foreground">
        Run a portfolio scan to begin.
      </p>
      <Link
        href="/app"
        className={cn(
          "mt-4 inline-flex items-center gap-1.5 rounded-md h-9 px-3.5 text-[13px] font-medium",
          "bg-foreground text-background min-h-9",
          "transition-[opacity] duration-150 ease",
          "hover:opacity-90",
        )}
      >
        Go to dashboard
      </Link>
    </div>
  );
}

function useRelativeTime(iso: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(
    () => formatRelative(new Date(iso).getTime(), now),
    [iso, now],
  );
}

function formatRelative(then: number, now: number): string {
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
