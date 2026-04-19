import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getPublicCardByHandle, getDemoCard } from "@/lib/cards";
import { ProfileCardView } from "@/components/scan/profile-card";

/**
 * Public, crawlable profile view — the "share this with a hiring manager"
 * surface. Reads the handle's latest succeeded scan card from R2
 * (served direct, no auth) and renders the same ProfileCardView the
 * builder uses.
 *
 * Fallback: when no scan exists yet for a handle, we serve the demo
 * card for `yatendra2001` and 404 for anyone else.
 */
export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  let card;
  try {
    const { env } = await getCloudflareContext({ async: true });
    card = await getPublicCardByHandle(handle, env);
  } catch {
    // Cloudflare context may be unavailable during SSG — fall back to
    // the bundled demo card when the handle matches.
    if (handle === "yatendra2001" || handle === "demo") {
      card = getDemoCard();
    }
  }

  if (!card) notFound();

  return <ProfileCardView card={card} chrome={true} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return {
    title: `${handle} · gitshow`,
    description: `${handle}'s engineering portfolio, backed by every commit.`,
    openGraph: {
      title: `${handle} · gitshow`,
      description: `Portfolio for @${handle} — every claim links to a commit.`,
      type: "profile",
    },
  };
}
