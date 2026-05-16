import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DataProvider } from "@/components/data-provider";
import { TrackView } from "@/components/track-view";
import { ShareButton } from "@/components/share-button";
import { BuiltWithGitShow } from "@/components/built-with-gitshow";
import { ProfileClaim } from "@/components/profile-claim";
import { loadPublishedResume } from "@/lib/resume-io";
import { isReservedHandle } from "@/lib/profiles";
import { isHandleOwnerPro } from "@/lib/entitlements";

/**
 * Portfolio subtree layout.
 *
 * Three outcomes for `/{handle}`:
 *   - reserved word / malformed handle → 404
 *   - published portfolio              → render it (DataProvider tree)
 *   - non-existent but valid handle    → ProfileClaim (the growth
 *     surface: "this could be your portfolio"), NOT a 404
 *
 * SEO: `generateMetadata` gives every real profile a unique title,
 * description, canonical, and OG; claim pages are `noindex` so Google
 * never gets fed infinite thin pages (the Linktree trap).
 */

const BASE = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io"
).replace(/\/+$/, "");

/**
 * GitHub username rules: 1–39 chars, alphanumeric or single hyphens,
 * cannot start/end with a hyphen or contain consecutive hyphens.
 * Anything else isn't a real handle — 404 rather than render a claim
 * page for `/wp-admin.php` and friends.
 */
const GITHUB_HANDLE_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

function isValidHandle(handle: string): boolean {
  return GITHUB_HANDLE_RE.test(handle);
}

function absolutize(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `${BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;

  if (isReservedHandle(handle) || !isValidHandle(handle)) {
    return { robots: { index: false, follow: false } };
  }

  const { env } = await getCloudflareContext({ async: true });
  const resume = await loadPublishedResume(env.BUCKET, handle);
  const canonical = `${BASE}/${handle.toLowerCase()}`;

  if (!resume) {
    // Claim page — persuasive title for the tab, but never indexed.
    return {
      title: `${handle} — create your developer portfolio · gitshow`,
      description: `Turn github.com/${handle} into a portfolio site, ATS resume, and custom domain. Free to publish, live in ~20 minutes.`,
      robots: { index: false, follow: true },
    };
  }

  const name = resume.person.name || handle;
  const description =
    resume.person.description?.trim() ||
    `${name}'s developer portfolio — projects, work, and open-source contributions, generated from GitHub.`;
  const title = `${name} — Developer Portfolio`;

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "profile",
      title,
      description,
      url: canonical,
      siteName: "gitshow",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PortfolioLayout({
  params,
  children,
}: {
  params: Promise<{ handle: string }>;
  children: React.ReactNode;
}) {
  const { handle } = await params;

  if (isReservedHandle(handle) || !isValidHandle(handle)) notFound();

  const { env } = await getCloudflareContext({ async: true });
  const resume = await loadPublishedResume(env.BUCKET, handle);

  // No portfolio here yet → the growth surface, not a dead 404. We
  // deliberately don't render `children` (the page would crash on a
  // missing DataProvider) — ProfileClaim is the whole response.
  if (!resume) {
    return <ProfileClaim handle={handle} />;
  }

  // Custom-domain awareness — middleware forwards `x-gs-custom-domain`
  // as a request header when the request landed on a customer's own
  // hostname (e.g. yatendrakumar.com). When set, every internal link
  // in this subtree should render handle-less (`/blog` not `/{handle}/blog`)
  // so navigation stays on the custom domain instead of leaking the
  // canonical slug into the URL bar.
  const headerStore = await headers();
  const isCustomDomain = headerStore.get("x-gs-custom-domain") === "1";

  // The viral badge only shows for free owners. Removing it is a Pro
  // perk. Owner Pro state is resolved by handle (one indexed query,
  // React.cache-shared with any other subscription read this request).
  const ownerIsPro = await isHandleOwnerPro(env.DB, handle);

  const personLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    dateModified: resume.meta?.updatedAt,
    mainEntity: {
      "@type": "Person",
      name: resume.person.name,
      description: resume.person.description,
      url: `${BASE}/${handle.toLowerCase()}`,
      image: absolutize(resume.person.avatarUrl),
    },
  };

  return (
    <DataProvider
      resume={resume}
      handle={handle}
      isCustomDomain={isCustomDomain}
    >
      <script
        type="application/ld+json"
        // Our own serialized data, not user HTML — safe to inline.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }}
      />
      <TrackView handle={handle} />
      <ShareButton handle={handle} name={resume.person.name} />
      {children}
      {!ownerIsPro ? <BuiltWithGitShow /> : null}
    </DataProvider>
  );
}
