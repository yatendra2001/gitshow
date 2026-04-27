import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — gitshow",
  description:
    "What gitshow collects, where it's stored, and how to delete it.",
};

/**
 * Plain-English privacy page. Not legally exhaustive — the intent is
 * a short, honest description of what the scan does and where data
 * lives so a cautious user can make a real decision.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <article className="prose prose-neutral dark:prose-invert max-w-none">
        <h1>Privacy</h1>
        <p className="text-muted-foreground">Last updated: April 25, 2026.</p>

        <p>
          gitshow turns public developer activity into a portfolio. This
          page covers what we look at, where we store it, and how to make
          us forget you.
        </p>

        <h2>What we scan</h2>
        <ul>
          <li>
            <strong>Your public GitHub account</strong> — repositories,
            commits you authored, README files, pinned projects. If you
            connect private repos or orgs via the OAuth flow, we only
            read repositories you explicitly grant access to.
          </li>
          <li>
            <strong>Your LinkedIn profile URL</strong>, if you provide
            one — scraped from the public page using a headless browser
            with a Googlebot user agent. We never log into LinkedIn and
            we don&apos;t ask for your password.
          </li>
          <li>
            <strong>Your socials and blog URLs</strong> you provide
            during intake — Twitter/X, personal site, dev.to, Medium,
            Substack, etc.
          </li>
          <li>
            <strong>Public search results</strong> about you when
            corroborating claims — HN, conference pages, interviews you
            opted into.
          </li>
        </ul>

        <h2>Where we store it</h2>
        <ul>
          <li>
            <strong>Cloudflare R2</strong> — scan snapshots, extracted
            text, images used in your portfolio, knowledge-graph JSON.
          </li>
          <li>
            <strong>Cloudflare D1</strong> — scan metadata, your
            account record, subscription state, and minimal analytics.
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
          You can delete your account at any time from the app. Deletion
          purges your D1 rows and the R2 keys under your handle; scans
          are removed in a background job within ~24 hours. If you
          cancel your subscription without deleting, your published
          portfolio stays live as a read-only page until you either
          re-subscribe or delete the account.
        </p>

        <h2>Contact</h2>
        <p>
          Questions or a data request? Email{" "}
          <a href="mailto:yatendra@gitshow.io">
            yatendra@gitshow.io
          </a>
          .
        </p>
      </article>
    </main>
  );
}
