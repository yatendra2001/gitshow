import { notFound, redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import { getScanByIdForUser } from "@/lib/scans";
import { getScanCard, mergeUserEdits } from "@/lib/cards";
import { SplitPane } from "@/components/scan/split-pane";
import { Toaster } from "sonner";

export const dynamic = "force-dynamic";

export default async function ScanPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const { scanId } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const scan = await getScanByIdForUser(env.DB, scanId, session.user.id);
  if (!scan) notFound();

  const raw = await getScanCard(scanId, env.BUCKET);
  const card = raw ? await mergeUserEdits(raw, scanId, env.DB) : null;

  // Check if this scan is the one currently published to /{handle}.
  const published = await env.DB.prepare(
    `SELECT current_scan_id FROM user_profiles WHERE user_id = ? LIMIT 1`,
  )
    .bind(session.user.id)
    .first<{ current_scan_id: string }>();
  const isPublished = published?.current_scan_id === scanId;

  return (
    <>
      <SplitPane
        scan={scan}
        initialCard={card}
        initialIsPublished={isPublished}
      />
      <Toaster richColors position="bottom-center" />
    </>
  );
}

export async function generateMetadata() {
  return {
    title: "Your profile · gitshow",
  };
}
