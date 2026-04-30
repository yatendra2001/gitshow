import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Privacy — gitshow",
  description:
    "What gitshow collects, where it lives, and how to delete it. Plain English, no dark patterns.",
};

/**
 * Plain-English privacy page. Not a 12-page legalese binder — the
 * goal is that a cautious developer can read this in two minutes and
 * know exactly what the scan does and where their data lives.
 *
 * Chrome matches /pricing and /changelog: sticky logo header, narrow
 * content column, marketing-style footer with cross-links to Terms.
 */
export default function PrivacyPage() {
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
            Privacy
          </div>
          <h1 className="text-[40px] sm:text-[48px] leading-[1.05] tracking-tight font-medium mb-4">
            What we see, what we keep.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            gitshow turns public developer activity into a portfolio.
            This page covers what we look at, where it lives, and how
            to make us forget you. Last updated April 25, 2026.
          </p>
        </div>
      </section>

      <article className="mx-auto w-full max-w-3xl px-4 sm:px-6 pb-24 prose prose-neutral dark:prose-invert prose-headings:tracking-tight prose-headings:font-medium prose-h2:text-[22px] prose-h2:mt-12 prose-h2:mb-3 prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-muted-foreground prose-li:text-[15px] prose-li:text-muted-foreground prose-strong:text-foreground prose-strong:font-medium prose-a:text-foreground prose-a:underline prose-a:decoration-border prose-a:underline-offset-4 hover:prose-a:decoration-foreground">
        <h2>What we scan</h2>
        <ul>
          <li>
            <strong>Your public GitHub account</strong> — repositories,
            commits you authored, README files, manifests, first-party
            source files, pinned projects. Source is analyzed in chunks:
            small and medium repositories are read end to end, while
            very large repositories are read in prioritized batches with
            coverage tracking. If you connect private repos or orgs via
            the OAuth flow, we only read repositories you explicitly
            grant access to.
          </li>
          <li>
            <strong>Your LinkedIn profile URL</strong>, if you provide
            one — fetched from the public page using a server-side
            headless browser with a Googlebot user agent. We never log
            into LinkedIn, and we don&apos;t ask for your password.
          </li>
          <li>
            <strong>Socials and blog URLs</strong> you give us during
            intake — Twitter / X, personal site, dev.to, Medium,
            Substack, etc.
          </li>
          <li>
            <strong>Public search results</strong> we fetch when
            corroborating claims — HN threads, conference pages,
            interviews you opted into.
          </li>
        </ul>

        <h2>Where it lives</h2>
        <ul>
          <li>
            <strong>Cloudflare R2</strong> — scan snapshots, structured
            analysis, images used in your portfolio, knowledge-graph
            JSON. Raw repository source chunks are pass-through inputs
            to inference; we don&apos;t retain them as portfolio
            content.
          </li>
          <li>
            <strong>Cloudflare D1</strong> — your account record, scan
            metadata, subscription state, and minimal analytics events.
          </li>
        </ul>
        <p>
          We don&apos;t sell data. We don&apos;t ship it to ad networks.
          The only third parties that see your data are the providers
          we use to deliver the product: Cloudflare (hosting, storage,
          auth), OpenRouter (LLM inference for scan stages), TinyFish
          (headless browser fetches), Resend (transactional email), and
          Dodo Payments (billing).
        </p>

        <h2>Visitor analytics</h2>
        <p>
          When someone reads your portfolio, we record the page,
          referrer, country, device, and browser. There&apos;s no
          third-party script and no reader-side identifier we can use
          to track the same person across the internet — visits are
          counted via a salted, non-reversible cookie scoped to your
          gitshow profile (<span className="font-mono">gs_v</span>),
          rotated regularly. No IP addresses or user agents are stored
          alongside events.
        </p>

        <h2>LinkedIn note</h2>
        <p>
          We don&apos;t use any LinkedIn OAuth product. We fetch your
          public profile page using a server-side headless browser and
          extract the text server-side. If your profile is
          login-walled, we fall back to a PDF you can upload from
          LinkedIn&apos;s built-in &quot;Save to PDF&quot; export.
        </p>

        <h2>Retention &amp; deletion</h2>
        <p>
          You can delete your account at any time from the app.
          Deletion purges your D1 rows and the R2 keys under your
          handle; scans are removed in a background job within ~24
          hours. If you cancel your subscription without deleting, your
          published portfolio stays live as a read-only page until you
          either re-subscribe or delete the account.
        </p>

        <h2>Children</h2>
        <p>
          gitshow is built for working developers and is not directed
          at children under 13. If you believe a child has signed up,
          email us and we&apos;ll remove the account.
        </p>

        <h2>Contact</h2>
        <p>
          Questions or a data request? Email{" "}
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
