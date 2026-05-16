import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";

/**
 * /compare/developer-portfolio-builders — comparison/listicle SEO,
 * the highest-intent keyword set ("best developer portfolio
 * builders"). Honest, content-rich (a real comparison table + prose),
 * not a thin doorway. Cross-links the rest of the SEO cluster.
 */

const BASE = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io"
).replace(/\/+$/, "");

export const metadata: Metadata = {
  title: "Best Developer Portfolio Builders (2026) — an honest comparison",
  description:
    "Hand-coded site vs. site builders vs. link-in-bio vs. resume tools vs. gitshow. An honest comparison of the ways software engineers build a portfolio in 2026.",
  alternates: {
    canonical: `${BASE}/compare/developer-portfolio-builders`,
  },
  openGraph: {
    title: "Best Developer Portfolio Builders (2026)",
    description:
      "An honest comparison of the ways software engineers build a portfolio.",
    url: `${BASE}/compare/developer-portfolio-builders`,
    siteName: "gitshow",
    type: "website",
  },
};

const ROWS: Array<{
  approach: string;
  effort: string;
  staysFresh: string;
  proof: string;
}> = [
  {
    approach: "Hand-coded site",
    effort: "Days–weeks",
    staysFresh: "No — stale in a quarter",
    proof: "Whatever you remember to add",
  },
  {
    approach: "Generic site builder",
    effort: "Hours",
    staysFresh: "Manual",
    proof: "You write everything",
  },
  {
    approach: "Link-in-bio page",
    effort: "Minutes",
    staysFresh: "Manual",
    proof: "Links only — no substance",
  },
  {
    approach: "Resume builder",
    effort: "~1 hour",
    staysFresh: "Manual",
    proof: "Self-reported bullets",
  },
  {
    approach: "gitshow",
    effort: "~20 min, automated",
    staysFresh: "Yes — refresh from GitHub (Pro)",
    proof: "Read from your real commits & source",
  },
];

export default function CompareDeveloperPortfolioBuildersPage() {
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
            Comparison
          </div>
          <h1 className="text-[40px] sm:text-[48px] leading-[1.05] tracking-tight font-medium mb-4">
            Best developer portfolio builders, honestly
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            There are five common ways a software engineer ends up with a
            portfolio. None is wrong — they trade off time, freshness, and
            how much real proof of work they carry. Here&apos;s the
            straight version, including where gitshow fits and where it
            doesn&apos;t.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-4 sm:px-6 pb-4">
        <div className="overflow-x-auto rounded-2xl border border-border/40">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-border/40 bg-card/40">
                <th className="px-4 py-3 font-medium">Approach</th>
                <th className="px-4 py-3 font-medium">Effort</th>
                <th className="px-4 py-3 font-medium">Stays fresh?</th>
                <th className="px-4 py-3 font-medium">Proof of work</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const us = r.approach === "gitshow";
                return (
                  <tr
                    key={r.approach}
                    className={
                      "border-b border-border/30 last:border-0 " +
                      (us ? "bg-[var(--primary)]/[0.06]" : "")
                    }
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {r.approach}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.effort}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.staysFresh}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.proof}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <article className="mx-auto w-full max-w-3xl px-4 sm:px-6 pb-24 prose prose-neutral dark:prose-invert prose-headings:tracking-tight prose-headings:font-medium prose-h2:text-[22px] prose-h2:mt-12 prose-h2:mb-3 prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-muted-foreground prose-li:text-[15px] prose-li:text-muted-foreground prose-strong:text-foreground prose-strong:font-medium prose-a:text-foreground prose-a:underline prose-a:decoration-border prose-a:underline-offset-4 hover:prose-a:decoration-foreground">
        <h2>Hand-coding it</h2>
        <p>
          The most flexible option and the best learning project. The
          catch is survivorship: most hand-built portfolios ship once,
          then go stale because updating them is friction nobody budgets
          for. Worth it if the portfolio <em>is</em> the demo (you&apos;re
          a front-end or design engineer). Otherwise it&apos;s a lot of
          yak-shaving to restate what your GitHub already proves.
        </p>

        <h2>Site builders &amp; link-in-bio</h2>
        <p>
          Fast to stand up, but you still write all the content, and a
          link-in-bio page is a list of links — it carries no evidence of
          what you actually built. Fine as a hub, weak as a portfolio for
          an engineering hire.
        </p>

        <h2>Resume builders</h2>
        <p>
          Great for the document you attach to an application. But a
          resume is self-reported and episodic — you rebuild it every job
          hunt. It isn&apos;t a living, linkable artifact.
        </p>

        <h2>Where gitshow fits</h2>
        <p>
          gitshow is the right tool when your GitHub history already
          contains the proof and you don&apos;t want to spend a weekend
          restating it. It reads your repos, commits, PRs, and source,
          drafts the write-ups, and publishes — and on{" "}
          <Link href="/pricing">Pro</Link> it refreshes from GitHub so it
          never goes stale, the failure mode of every other option here.
          It is <strong>not</strong> the right tool if you want a fully
          bespoke, pixel-controlled site — hand-code that.
        </p>
        <p>
          See{" "}
          <Link href="/developer-portfolio-examples">
            real portfolio examples
          </Link>{" "}
          or read{" "}
          <Link href="/github-portfolio-generator">
            how the generator works
          </Link>
          . Publishing is free.
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
              href="/github-portfolio-generator"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              How it works
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
