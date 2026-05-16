import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";

/**
 * /github-portfolio-generator — keyword landing for "github portfolio
 * generator" / "generate portfolio from github". Static, content-rich,
 * canonical-set. Funnels to /signin and cross-links the examples and
 * comparison pages so the SEO cluster reinforces itself.
 */

const BASE = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io"
).replace(/\/+$/, "");

export const metadata: Metadata = {
  title: "GitHub Portfolio Generator — turn your repos into a portfolio",
  description:
    "Free GitHub portfolio generator. Sign in with GitHub and gitshow reads your repos, commits, and source to build a portfolio site, ATS resume, and custom domain in ~20 minutes.",
  alternates: { canonical: `${BASE}/github-portfolio-generator` },
  openGraph: {
    title: "GitHub Portfolio Generator",
    description:
      "Turn your GitHub history into a portfolio site, ATS resume, and custom domain.",
    url: `${BASE}/github-portfolio-generator`,
    siteName: "gitshow",
    type: "website",
  },
};

export default function GithubPortfolioGeneratorPage() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border/30 bg-background/80 px-4 backdrop-blur sm:px-6">
        <Logo href="/" size={24} />
        <div className="flex items-center gap-2 text-[12px]">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/30 px-3 py-1.5 hover:bg-card/50 transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <span className="hidden sm:inline">Home</span>
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-4 sm:px-6 pt-16 pb-10">
        <div className="max-w-2xl">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
            GitHub portfolio generator
          </div>
          <h1 className="text-[40px] sm:text-[48px] leading-[1.05] tracking-tight font-medium mb-4">
            Turn your GitHub into a portfolio
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            gitshow is a free GitHub portfolio generator for software
            engineers. Sign in with GitHub, and it reads your repositories,
            commits, pull requests, and actual source — then writes and
            publishes a portfolio site for you. Live in about twenty
            minutes.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signin"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-foreground px-6 py-3 text-[14px] font-medium text-background select-none transition-[box-shadow,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[0_2px_8px_-3px_oklch(0_0_0_/_0.24)] active:scale-[0.97]"
            >
              Generate mine with GitHub
            </Link>
            <Link
              href="/developer-portfolio-examples"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border/60 bg-card/30 px-6 py-3 text-[14px] font-medium select-none transition-[background-color,border-color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-card/50 hover:border-foreground/25 active:scale-[0.97]"
            >
              See examples
            </Link>
          </div>
        </div>
      </section>

      <article className="mx-auto w-full max-w-3xl px-4 sm:px-6 pb-24 prose prose-neutral dark:prose-invert prose-headings:tracking-tight prose-headings:font-medium prose-h2:text-[22px] prose-h2:mt-12 prose-h2:mb-3 prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-muted-foreground prose-li:text-[15px] prose-li:text-muted-foreground prose-strong:text-foreground prose-strong:font-medium prose-a:text-foreground prose-a:underline prose-a:decoration-border prose-a:underline-offset-4 hover:prose-a:decoration-foreground">
        <h2>How the generator works</h2>
        <ol>
          <li>
            <strong>Sign in with GitHub.</strong> gitshow uses your
            GitHub identity and an access token you control. Grant the
            private-repo scope if you want private and org work counted.
          </li>
          <li>
            <strong>It reads your history.</strong> Repositories, commits
            you authored, PRs you shipped to other projects, reviews, and
            first-party source — small repos end to end, large ones in
            prioritized batches.
          </li>
          <li>
            <strong>It writes the portfolio.</strong> A senior-reviewer
            pass picks the work that signals most and drafts plain-English
            project write-ups, an about section, and a timeline.
          </li>
          <li>
            <strong>You publish.</strong> Edit any section, pick a
            template, and it goes live at{" "}
            <span className="font-mono">gitshow.io/&#123;you&#125;</span>.
          </li>
        </ol>

        <h2>What you get free</h2>
        <p>
          Publishing a hosted portfolio is free. You get the generated
          site at your gitshow URL, six templates, and a public page you
          can share anywhere. Free portfolios carry a small
          &ldquo;Built with gitshow&rdquo; badge.
        </p>

        <h2>What Pro adds</h2>
        <p>
          <Link href="/pricing">Pro</Link> ($10/month, or $7/month billed
          annually) adds a custom domain with managed SSL, built-in
          visitor analytics, an ATS-safe one-page PDF resume, unlimited
          refreshes as you ship more code, and removes the badge.
        </p>

        <h2>Why generated, not hand-built</h2>
        <p>
          Most engineers never ship a portfolio because writing about
          your own work is hard and stale within a quarter. A generator
          fixes the blank page and the staleness: the draft is done in
          minutes, and on Pro it refreshes as your GitHub grows. See{" "}
          <Link href="/compare/developer-portfolio-builders">
            how gitshow compares to other developer portfolio builders
          </Link>
          .
        </p>
      </article>

      <footer className="border-t border-border/30">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
            <Logo size={20} markOnly />
            <span>© {new Date().getFullYear()} gitshow. Built with commits.</span>
          </div>
          <div className="flex items-center gap-5 text-[12px]">
            <Link
              href="/developer-portfolio-examples"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Examples
            </Link>
            <Link
              href="/compare/developer-portfolio-builders"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Compare
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
