"use client";

/**
 * `/app/resume/tailored` client surface — header + card grid + tailor
 * dialog. Owns the optimistic insert when the dialog produces a new
 * variant, so the new card lands in the grid before the navigation to
 * its detail page completes.
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
import { ResumeShellToolbar } from "../_shell";
import { TailorDialog } from "./_tailor-dialog";
import { cn } from "@/lib/utils";

export function TailoredListPage({
  initialItems,
  hasBaseResume,
}: {
  initialItems: TailoredResumeMeta[];
  hasBaseResume: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<TailoredResumeMeta[]>(initialItems);
  const [dialogOpen, setDialogOpen] = useState(false);

  const onTailored = useCallback(
    (tailored: TailoredResume) => {
      setItems((prev) => [
        tailored.meta,
        ...prev.filter((it) => it.id !== tailored.meta.id),
      ]);
      setDialogOpen(false);
      router.push(`/app/resume/tailored/${tailored.meta.id}`);
    },
    [router],
  );

  const trailing = (
    <button
      type="button"
      onClick={() => setDialogOpen(true)}
      disabled={!hasBaseResume}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md h-8 px-3 text-[12.5px] font-medium",
        "bg-foreground text-background min-h-9",
        "transition-[opacity] duration-150 ease",
        "hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed",
      )}
      title={
        hasBaseResume
          ? undefined
          : "Generate your base resume first — tailoring builds on top of it."
      }
    >
      <HugeiconsIcon icon={MagicWand01Icon} size={13} strokeWidth={2} />
      Tailor for job
    </button>
  );

  return (
    <div className="flex flex-col min-h-[calc(100svh-3.5rem)]">
      <ResumeShellToolbar
        active="tailored"
        tailoredCount={items.length}
        trailing={trailing}
      />

      <main className="mx-auto w-full max-w-5xl px-5 sm:px-6 py-8 sm:py-10">
        <header className="mb-6 sm:mb-8">
          <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70 mb-1">
            Tailored versions
          </div>
          <h1 className="text-[20px] sm:text-[24px] font-semibold tracking-tight leading-tight">
            Variants of your resume, tailored to specific jobs
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground max-w-prose">
            Drop a job description and we&apos;ll spin up a tailored copy of
            your resume — reordered bullets, prioritized projects, JD-aligned
            skills — using only facts already in your base resume. Your base
            stays untouched.
          </p>
        </header>

        {!hasBaseResume ? (
          <NoBaseResumeState />
        ) : items.length === 0 ? (
          <EmptyState onTailor={() => setDialogOpen(true)} />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((meta) => (
              <li key={meta.id}>
                <TailoredCard meta={meta} />
              </li>
            ))}
          </ul>
        )}
      </main>

      <TailorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onTailored={onTailored}
      />
    </div>
  );
}

function TailoredCard({ meta }: { meta: TailoredResumeMeta }) {
  const label = tailoredDisplayLabel(meta);
  const rel = useRelativeTime(meta.createdAt);
  return (
    <Link
      href={`/app/resume/tailored/${meta.id}`}
      className={cn(
        "group block rounded-lg border border-border/40 bg-card/40",
        "p-4 h-full flex flex-col gap-2",
        "transition-[background-color,border-color] duration-150 ease",
        "hover:border-border/60 hover:bg-card/70",
        "outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
        "min-h-[120px]",
      )}
      aria-label={`Open tailored resume: ${label}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="inline-flex items-center gap-2 min-w-0">
          <HugeiconsIcon
            icon={JobSearchIcon}
            size={14}
            strokeWidth={2}
            className="shrink-0 text-muted-foreground/70 group-hover:text-foreground/80 transition-colors duration-150"
          />
          <span className="truncate text-[13.5px] font-medium text-foreground">
            {label}
          </span>
        </div>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={13}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-muted-foreground/40 transition-transform duration-150 ease group-hover:translate-x-0.5 group-hover:text-foreground/70"
        />
      </div>
      <p className="flex-1 line-clamp-3 text-[12.5px] leading-snug text-muted-foreground/85">
        {meta.jdExcerpt}
      </p>
      <div className="mt-1 text-[11px] tabular-nums text-muted-foreground/70">
        {rel}
      </div>
    </Link>
  );
}

function EmptyState({ onTailor }: { onTailor: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/50 bg-foreground/[0.015] py-12 px-6 flex flex-col items-center text-center">
      <div className="mb-3 inline-flex size-9 items-center justify-center rounded-full bg-foreground/[0.05]">
        <HugeiconsIcon icon={MagicWand01Icon} size={16} strokeWidth={2} />
      </div>
      <h2 className="text-[15px] font-semibold tracking-tight">
        No tailored versions yet
      </h2>
      <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
        Drop your first job description and we&apos;ll build a JD-aligned
        variant for it — every version stays here for one-click download
        whenever you need it.
      </p>
      <button
        type="button"
        onClick={onTailor}
        className={cn(
          "mt-4 inline-flex items-center gap-1.5 rounded-md h-9 px-3.5 text-[13px] font-medium",
          "bg-foreground text-background min-h-9",
          "transition-[opacity] duration-150 ease",
          "hover:opacity-90",
        )}
      >
        <HugeiconsIcon icon={MagicWand01Icon} size={14} strokeWidth={2} />
        Tailor for a job
      </button>
    </div>
  );
}

function NoBaseResumeState() {
  return (
    <div className="rounded-xl border border-dashed border-border/50 bg-foreground/[0.015] py-12 px-6 flex flex-col items-center text-center">
      <h2 className="text-[15px] font-semibold tracking-tight">
        Generate your base resume first
      </h2>
      <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
        Tailoring builds on top of your base resume — generate it from
        your portfolio, then come back here to spin up JD-specific
        variants.
      </p>
      <Link
        href="/app/resume"
        className={cn(
          "mt-4 inline-flex items-center gap-1.5 rounded-md h-9 px-3.5 text-[13px] font-medium",
          "bg-foreground text-background min-h-9",
          "transition-[opacity] duration-150 ease",
          "hover:opacity-90",
        )}
      >
        Go to base resume
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
