"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FlickeringGrid } from "@/components/magicui/flickering-grid";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * Shared 404 hero used by the root `not-found.tsx` and the
 * `/{handle}/not-found.tsx` route. Renders:
 *
 *   - a subtle flickering-grid background (matches the public hero)
 *   - a big serif "404" + an animated blinking cursor
 *   - a git-output card that echoes the path the user hit (read from
 *     window.location on mount — Next.js doesn't pass it down)
 *   - a diff-style "your portfolio" suggestion that reads as a call to
 *     the core value prop
 *   - two CTAs: a muted "Back home" and a primary "Make yours →"
 *
 * Consumers pass `kind` so the copy adapts to the two call sites:
 *   - "generic" — "That path didn't land" (unknown URL)
 *   - "handle"  — "No portfolio for @handle yet" (reserved or unscanned
 *                 handle)
 */

export interface NotFoundHeroProps {
  kind: "generic" | "handle";
  /** Only used when kind="handle" — the attempted handle. */
  handle?: string;
}

export function NotFoundHero({ kind, handle }: NotFoundHeroProps) {
  // We only derive the handle client-side for the handle variant —
  // Next doesn't pipe `params` into `not-found.tsx`, so we read it
  // from the pathname. The raw URL is no longer surfaced; a previous
  // version echoed it in a git-output card but that read as
  // confusing noise.
  const [derivedHandle, setDerivedHandle] = useState<string | undefined>(
    handle,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (kind === "handle" && !handle) {
      const first = window.location.pathname.split("/").filter(Boolean)[0];
      if (first) setDerivedHandle(first);
    }
  }, [kind, handle]);
  const resolvedHandle = handle ?? derivedHandle;

  const eyebrow =
    kind === "handle" ? "HANDLE NOT FOUND" : "PAGE NOT FOUND";
  const title =
    kind === "handle"
      ? resolvedHandle
        ? `No portfolio for @${resolvedHandle} yet.`
        : `No portfolio for that handle yet.`
      : `That page didn't land.`;
  const subtitle =
    kind === "handle"
      ? `gitshow.io pages appear once someone has run a scan. Want to claim yours?`
      : `We couldn't find whatever you were after — make your own portfolio instead?`;

  return (
    <main className="relative min-h-svh bg-background text-foreground overflow-hidden">
      {/* Flickering grid — wrapped in a gradient mask so it fades toward
          the content and doesn't compete with the hero copy. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_center,black_40%,transparent_90%)]"
      >
        <FlickeringGrid
          className="size-full"
          squareSize={4}
          gridGap={6}
          flickerChance={0.2}
          maxOpacity={0.22}
        />
      </div>

      <div className="relative mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-between px-6 py-8">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-background/40 backdrop-blur px-1 py-1 pr-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Home"
          >
            <LogoMark size={18} />
            <span>gitshow.io</span>
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            {eyebrow}
          </span>
        </header>

        <section className="flex flex-col gap-8 py-12">
          {/* Big display mark — 404 paired with a blinking cursor that
              reads as a terminal prompt. Gives the page a living feel
              without a full animation. */}
          <div className="flex items-center gap-4">
            <span className="font-[var(--font-serif)] text-[min(22vw,140px)] leading-none tracking-tight">
              404
            </span>
            <span
              aria-hidden
              className={cn(
                "inline-block h-[0.8em] w-[0.08em] min-w-[4px]",
                "bg-[var(--primary)] gs-pulse",
              )}
            />
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="font-[var(--font-serif)] text-[clamp(26px,5vw,40px)] leading-tight">
              {title}
            </h1>
            <p className="max-w-xl text-[14px] leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/app"
              className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2.5 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11"
            >
              Make yours →
            </Link>
            <Link
              href="/"
              className="inline-flex items-center rounded-xl border border-border/40 bg-card/30 px-4 py-2.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors min-h-11"
            >
              Back home
            </Link>
          </div>
        </section>

        <footer className="flex items-center justify-between text-[11px] text-muted-foreground/70">
          <span className="font-mono">
            {kind === "handle" ? "status 404 · no-scan" : "status 404 · no-path"}
          </span>
          <span className="font-mono">gitshow.io</span>
        </footer>
      </div>
    </main>
  );
}
