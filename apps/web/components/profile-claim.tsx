import Link from "next/link";
import { ArrowRight, Github } from "lucide-react";
import { Logo } from "@/components/logo";

/* eslint-disable @next/next/no-img-element */

/**
 * Rendered at `/{handle}` when no portfolio exists there yet — the
 * old behaviour was a dead 404. This is the growth surface: every
 * `gitshow.io/{anyGitHubUser}` is a live, shareable, GitHub-templated
 * pitch. The marketing line writes itself — "change github.com/you
 * to gitshow.io/you".
 *
 * Generation always runs against the *signed-in* user's own GitHub
 * (their OAuth token, their repos), so the CTA just routes to
 * `/signin`; the visited handle is persuasion, not an input. The page
 * is `noindex` (set in the layout's generateMetadata) so we never
 * feed Google infinite thin claim pages — only real published
 * profiles get indexed.
 */
export function ProfileClaim({ handle }: { handle: string }) {
  const avatar = `https://github.com/${encodeURIComponent(handle)}.png?size=200`;

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
        <Logo href="/" size={24} />
        <Link
          href="/signin"
          className="rounded-lg border border-border/60 bg-card/30 px-3 py-1.5 text-[12px] hover:bg-card/50 transition-colors"
        >
          Sign in
        </Link>
      </header>

      <section className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 sm:px-6 pt-16 pb-24 text-center">
        <span
          className="relative mb-8 inline-block size-20 overflow-hidden rounded-full border border-border/50 bg-card/40"
          aria-hidden
        >
          <img
            src={avatar}
            alt=""
            width={80}
            height={80}
            className="size-full object-cover"
          />
        </span>

        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/40 bg-card/40 px-3 py-1 font-mono text-[12px] text-muted-foreground">
          <span>github.com/{handle}</span>
          <ArrowRight className="size-3.5 text-foreground/60" />
          <span className="font-semibold text-foreground">
            gitshow.io/{handle}
          </span>
        </div>

        <h1 className="text-[34px] sm:text-[44px] leading-[1.05] tracking-tight font-medium text-balance">
          {handle}, this could be your portfolio.
        </h1>
        <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted-foreground text-balance">
          gitshow reads your GitHub history — repos, commits, PRs,
          actual source — and writes you a portfolio site, an ATS
          resume, and a custom-domain setup. Free to publish. Live in
          about twenty minutes.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/signin"
            className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-foreground px-6 py-3 text-[14px] font-medium text-background select-none shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)] transition-[background-color,box-shadow,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(0_0_0_/_0.24)] active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Github className="size-4" />
            Generate mine with GitHub
          </Link>
          <Link
            href="/yatendra2001"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border/60 bg-card/30 px-6 py-3 text-[14px] font-medium select-none transition-[background-color,border-color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-card/50 hover:border-foreground/25 active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            See a real example
          </Link>
        </div>

        <p className="mt-6 text-[12px] text-muted-foreground/80">
          Signing in scans <span className="font-medium">your own</span>{" "}
          GitHub account. The free plan publishes a live portfolio with
          a small gitshow badge —{" "}
          <Link
            href="/pricing"
            className="underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            Pro
          </Link>{" "}
          adds a custom domain, analytics, and the PDF resume.
        </p>
      </section>
    </main>
  );
}
