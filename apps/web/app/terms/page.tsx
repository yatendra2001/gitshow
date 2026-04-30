import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Terms — gitshow",
  description: "Short terms of service for gitshow. Read in a minute.",
};

/**
 * Plain-English terms of service. Short by design — a developer
 * clicking through should be able to read this in a minute and know
 * what they&apos;re agreeing to.
 *
 * Chrome matches /privacy and /changelog so the legal pages look
 * like a coherent set, not three different layouts.
 */
export default function TermsPage() {
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
            Terms
          </div>
          <h1 className="text-[40px] sm:text-[48px] leading-[1.05] tracking-tight font-medium mb-4">
            The deal, in a minute.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Using gitshow means agreeing to what&apos;s on this page.
            If any of this doesn&apos;t work for you, don&apos;t create
            an account — you can&apos;t agree to these terms partially.
            Last updated April 25, 2026.
          </p>
        </div>
      </section>

      <article className="mx-auto w-full max-w-3xl px-4 sm:px-6 pb-24 prose prose-neutral dark:prose-invert prose-headings:tracking-tight prose-headings:font-medium prose-h2:text-[22px] prose-h2:mt-12 prose-h2:mb-3 prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-muted-foreground prose-li:text-[15px] prose-li:text-muted-foreground prose-strong:text-foreground prose-strong:font-medium prose-a:text-foreground prose-a:underline prose-a:decoration-border prose-a:underline-offset-4 hover:prose-a:decoration-foreground">
        <h2>The service, as-is</h2>
        <p>
          gitshow is provided &quot;as is&quot; with no warranties. We
          do our best to keep scans accurate and the site up, but we
          can&apos;t guarantee any particular uptime, output quality,
          or absence of bugs. If something is broken, email us and
          we&apos;ll fix it — usually the same day.
        </p>

        <h2>Your account</h2>
        <ul>
          <li>
            You must be the owner of the GitHub account you scan.
            Don&apos;t use someone else&apos;s handle.
          </li>
          <li>
            Don&apos;t pretend to be someone you&apos;re not.
            Portfolios that impersonate another real person will be
            removed and the account suspended.
          </li>
          <li>
            Keep your login credentials safe. You&apos;re responsible
            for activity under your account.
          </li>
        </ul>

        <h2>What you give us permission to do</h2>
        <p>
          When you sign in with GitHub and run a scan, you grant us a
          temporary, revocable license to read the repositories you
          authorize, fetch your public LinkedIn page, scrape any URLs
          you provide, and pass the resulting text through inference
          providers (currently OpenRouter) to draft your portfolio.
          The license is scoped to producing your portfolio — not to
          training models, not to selling data, not to anything else.
        </p>

        <h2>Abuse</h2>
        <p>
          We may suspend or delete accounts that abuse the service —
          spam, automated scraping of our site, harassment, or any
          activity that puts other users or our infrastructure at
          risk.
        </p>

        <h2>Pricing</h2>
        <p>
          Pro is a subscription billed via Dodo Payments. Current
          pricing lives on{" "}
          <a href="/pricing">the pricing page</a>. Subscriptions renew
          at the end of each billing period unless you cancel;
          cancelled subscriptions keep access until the end of the
          period you paid for. Refunds are handled on a case-by-case
          basis — email us within 14 days of being charged and
          we&apos;ll sort it out.
        </p>

        <h2>Intellectual property</h2>
        <p>
          The code behind gitshow is ours. The content we generate
          from your data — your portfolio, PDF exports, summaries —
          is yours to use however you want. We claim no ownership of
          the output. Your published portfolio stays live as a
          read-only page even if you cancel, until you delete the
          account yourself.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the extent permitted by law, gitshow&apos;s total
          liability for any claim relating to the service is capped
          at the greater of $100 or the amount you&apos;ve paid us in
          the 12 months before the claim. We&apos;re a small team —
          please don&apos;t sue us into oblivion over a typo on a
          generated portfolio.
        </p>

        <h2>Changes</h2>
        <p>
          We&apos;ll edit this page when something material changes.
          The &quot;Last updated&quot; date at the top tells you when.
          Substantive changes get an email; cosmetic edits don&apos;t.
        </p>

        <h2>Contact</h2>
        <p>
          Questions? Email{" "}
          <a href="mailto:yatendra@gitshow.io">yatendra@gitshow.io</a>
          .
        </p>
      </article>

      <footer className="border-t border-border/30">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
            <Logo size={20} markOnly />
            <span>
              © {new Date().getFullYear()} gitshow. Built with commits.
            </span>
          </div>
          <div className="flex items-center gap-5 text-[12px]">
            <Link
              href="/changelog"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Changelog
            </Link>
            <Link
              href="/privacy"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy
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
