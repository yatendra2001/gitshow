import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { LeanProfileCard } from "@/components/profile/lean-card";
import { getProfileBySlug, isReservedHandle } from "@/lib/profiles";

/**
 * Public profile page at /{handle}.
 *
 * Server-rendered, unauthenticated read. Cached at the edge via
 * Cache-Control headers (set in middleware or the response). The
 * ProfileCard JSON lives in R2; we pull it once per render.
 *
 * Reserved-word check keeps /{handle} from colliding with /app, /api,
 * /s, etc. Missing profile → 404.
 */

export const dynamic = "force-dynamic";

interface Params {
  handle: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { handle } = await params;
  if (isReservedHandle(handle)) return { title: "gitshow" };

  const { env } = await getCloudflareContext({ async: true });
  const data = await getProfileBySlug(env.DB, env.BUCKET, handle);
  if (!data) {
    return {
      title: `@${handle} — gitshow`,
      description: `No public profile found for @${handle}.`,
    };
  }
  const { card } = data;

  const title = card.hook
    ? `${card.hook.text} — @${card.handle} on gitshow`
    : `@${card.handle} on gitshow`;
  const description =
    card.primary_shape ??
    card.distinctive_paragraph?.slice(0, 160) ??
    `Engineering profile for @${card.handle}.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "profile",
      url: `/${card.handle}`,
      siteName: "gitshow",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: { index: true, follow: true },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { handle } = await params;

  if (isReservedHandle(handle)) notFound();

  const { env } = await getCloudflareContext({ async: true });
  const data = await getProfileBySlug(env.DB, env.BUCKET, handle);
  if (!data) notFound();

  return (
    <main className="min-h-svh bg-background text-foreground">
      <LeanProfileCard card={data.card} />
    </main>
  );
}
