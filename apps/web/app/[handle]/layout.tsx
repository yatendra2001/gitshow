import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DataProvider } from "@/components/data-provider";
import { TrackView } from "@/components/track-view";
import { ShareButton } from "@/components/share-button";
import { loadPublishedResume } from "@/lib/resume-io";
import { isReservedHandle } from "@/lib/profiles";

/**
 * Portfolio subtree layout — wires the per-handle Resume into the
 * DataProvider so every downstream section renders the right user's
 * data. The actual page chrome (background, max-width column, dock,
 * fonts) is the *template's* responsibility — this layout deliberately
 * stays empty so each template can render fullbleed if it wants.
 *
 * 404s for reserved-word handles (`/app`, `/api`, …) and for handles with
 * no published Resume.
 */
export default async function PortfolioLayout({
  params,
  children,
}: {
  params: Promise<{ handle: string }>;
  children: React.ReactNode;
}) {
  const { handle } = await params;

  if (isReservedHandle(handle)) notFound();

  const { env } = await getCloudflareContext({ async: true });
  const resume = await loadPublishedResume(env.BUCKET, handle);
  if (!resume) notFound();

  return (
    <DataProvider resume={resume} handle={handle}>
      <TrackView handle={handle} />
      <ShareButton handle={handle} name={resume.person.name} />
      {children}
    </DataProvider>
  );
}
