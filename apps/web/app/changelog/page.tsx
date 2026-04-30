import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Github } from "lucide-react";
import { Logo } from "@/components/logo";
import { CHANGELOG, type ChangelogTag } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog — gitshow",
  description:
    "What's new in gitshow. Every notable feature, fix, and polish pass since the first commit.",
};

/**
 * /changelog — the public release feed.
 *
 * Entries live in `lib/changelog.ts` (hand-curated; not auto-derived
 * from `git log`). Layout is a single vertical timeline: a thin rail
 * runs down the left edge, each entry is a card pinned to a date.
 *
 * The page is intentionally chrome-light — same sticky logo header
 * the pricing page uses, and the marketing footer at the bottom for
 * navigation parity. No nav menu, no testimonials, no animation
 * slides. The content does the work.
 */

const TAG_LABEL: Record<ChangelogTag, string> = {
  release: "Release",
  feature: "Feature",
  fix: "Fix",
  polish: "Polish",
};

const TAG_CLASS: Record<ChangelogTag, string> = {
  release:
    "border-[var(--gradient-primary)]/40 bg-[var(--gradient-primary)]/10 text-[var(--gradient-primary)]",
  feature:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400",
  fix:
    "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  polish:
    "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function dateAnchor(iso: string): string {
  return iso;
}

export default function ChangelogPage() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border/30 bg-background/80 px-4 backdrop-blur sm:px-6">
        <Logo href="/" size={24} />
        <div className="flex items-center gap-2 text-[12px]">
          <Link
            href="/"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/30 px-3 py-1.5 hover:bg-card/50 transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Home
          </Link>
          <a
            href="https://github.com/yatendra2001/gitshow"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/30 px-3 py-1.5 hover:bg-card/50 transition-colors"
          >
            <Github className="size-3.5" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </header>

      <section className="mx-auto w-full max-w-4xl px-4 sm:px-6 pt-16 pb-10">
        <div className="max-w-2xl">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
            Changelog
          </div>
          <h1 className="text-[40px] sm:text-[48px] leading-[1.05] tracking-tight font-medium mb-4">
            Built in the open.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            gitshow ships almost every day. This is the curated record
            of what changed — features you can actually feel, not the
            240 commits behind them. The full git history lives on{" "}
            <a
              href="https://github.com/yatendra2001/gitshow"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              GitHub
            </a>
            .
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl px-4 sm:px-6 pb-24">
        <ol className="relative">
          {/* Single vertical rail. Sits behind the date markers. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-[10px] top-2 bottom-2 w-px bg-linear-to-b from-border/0 via-border to-border/0 sm:left-[calc(8rem+10px)]"
          />
          {CHANGELOG.map((entry, idx) => (
            <li
              key={entry.date + entry.title}
              id={dateAnchor(entry.date)}
              className="relative grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-y-2 sm:gap-x-8 pb-12 last:pb-0"
            >
              {/* Date marker — dot lives on the rail */}
              <div className="relative pl-7 sm:pl-0 sm:text-right">
                <span
                  aria-hidden
                  className="absolute left-[5px] top-[6px] size-[11px] rounded-full border-2 border-background bg-foreground sm:left-auto sm:-right-11"
                />
                <a
                  href={`#${dateAnchor(entry.date)}`}
                  className="inline-flex flex-col gap-0.5 group"
                >
                  <span className="text-[13px] font-mono text-foreground tabular-nums">
                    {formatDate(entry.date)}
                  </span>
                  <span
                    className={
                      "text-[10px] uppercase tracking-wider font-mono text-muted-foreground/70 " +
                      "group-hover:text-foreground transition-colors"
                    }
                  >
                    {idx === 0 ? "Latest" : `#${dateAnchor(entry.date)}`}
                  </span>
                </a>
              </div>

              {/* Entry card */}
              <article className="rounded-2xl border border-border/60 bg-card/30 p-6 sm:p-7">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span
                    className={
                      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider " +
                      TAG_CLASS[entry.tag]
                    }
                  >
                    {TAG_LABEL[entry.tag]}
                  </span>
                </div>
                <h2 className="text-[20px] sm:text-[22px] font-medium tracking-tight mb-4 text-balance">
                  {entry.title}
                </h2>
                <ul className="flex flex-col gap-3">
                  {entry.highlights.map((highlight, i) => (
                    <li
                      key={i}
                      className="flex gap-3 text-[14px] leading-relaxed text-muted-foreground"
                    >
                      <span
                        aria-hidden
                        className="mt-[9px] inline-block size-[5px] shrink-0 rounded-full bg-foreground/30"
                      />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-border/30">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
            <Logo size={20} markOnly />
            <span>
              © {new Date().getFullYear()} gitshow. Built with commits.
            </span>
          </div>
          <div className="flex items-center gap-5 text-[12px]">
            <Link
              href="/privacy"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/pricing"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
