import { notFound, redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import { getScanByIdForUser } from "@/lib/scans";
import { getScanCard } from "@/lib/cards";
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

  const card = await getScanCard(scanId, env.BUCKET);

  return (
    <>
      <SplitPane scan={scan} initialCard={card} />
      <Toaster richColors position="bottom-center" />
    </>
  );
}

export async function generateMetadata() {
  return {
    title: "Your profile · gitshow",
  };
}
