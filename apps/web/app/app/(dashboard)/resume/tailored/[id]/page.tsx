import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProPage } from "@/lib/entitlements";
import {
  loadTailoredIndex,
  loadTailoredResume,
} from "@/lib/tailored-resume-io";
import { TailoredDetailView } from "./_detail";

/**
 * `/app/resume/tailored/[id]` — single tailored variant view. Loads
 * the full doc + the index so the tabs count stays accurate, and 404s
 * cleanly when the variant has been deleted.
 */

export const dynamic = "force-dynamic";

export default async function TailoredDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireProPage();
  const handle = session.user.login!;
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const [tailored, index] = await Promise.all([
    loadTailoredResume(env.BUCKET, handle, id),
    loadTailoredIndex(env.BUCKET, handle),
  ]);

  if (!tailored) {
    notFound();
  }

  return (
    <div className="gs-enter">
      <TailoredDetailView
        tailored={tailored}
        tailoredCount={index.items.length}
      />
    </div>
  );
}
