import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — gitshow",
  description: "Short terms of service for gitshow.",
};

/**
 * Plain-English terms of service. Short by design — a developer
 * clicking through should be able to read this in a minute and know
 * what they&apos;re agreeing to.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <article className="prose prose-neutral dark:prose-invert max-w-none">
        <h1>Terms of Service</h1>
        <p className="text-muted-foreground">Last updated: April 25, 2026.</p>

        <p>
          Using gitshow means agreeing to what&apos;s on this page. If
          any of this doesn&apos;t work for you, don&apos;t create an
          account — you can&apos;t agree to these terms partially.
        </p>

        <h2>The service, as-is</h2>
        <p>
          gitshow is provided &quot;as is&quot; with no warranties. We
          do our best to keep scans accurate and the site up, but we
          can&apos;t guarantee any particular uptime, output quality,
          or absence of bugs.
        </p>

        <h2>Your account</h2>
        <ul>
          <li>
            You must be the owner of the GitHub account you scan. Don&apos;t
            use someone else&apos;s handle.
          </li>
          <li>
            Don&apos;t pretend to be someone you&apos;re not. Portfolios that
            impersonate another real person will be removed and the
            account suspended.
          </li>
          <li>
            Keep your login credentials safe. You&apos;re responsible for
            activity under your account.
          </li>
        </ul>

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
          at the end of each billing period unless you cancel; cancelled
          subscriptions keep access until the end of the period you
          paid for.
        </p>

        <h2>Intellectual property</h2>
        <p>
          The code behind gitshow is ours. The content we generate from
          your data — your portfolio, PDF exports, summaries — is
          yours to use however you want. We claim no ownership of the
          output.
        </p>

        <h2>Contact</h2>
        <p>
          Questions? Email{" "}
          <a href="mailto:yatendra@gitshow.io">
            yatendra@gitshow.io
          </a>
          .
        </p>
      </article>
    </main>
  );
}
