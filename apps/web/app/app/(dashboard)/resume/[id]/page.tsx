import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProPage } from "@/lib/entitlements";
import { loadTailoredResume } from "@/lib/tailored-resume-io";
import { ResumeEditor } from "./_editor";

/**
 * `/app/resume/[id]` — full editor for one resume.
 *
 * Every resume in gitshow is JD-tied; this surface is the only one
 * that lets the user edit the underlying ResumeDoc. The form pane
 * autosaves to `/api/resume/tailored/[id]` per-keystroke (debounced).
 *
 * 404s cleanly when the variant has been deleted or never existed.
 */

export const dynamic = "force-dynamic";

export default async function ResumeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireProPage();
  const handle = session.user.login!;
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const tailored = await loadTailoredResume(env.BUCKET, handle, id);
  if (!tailored) notFound();

  return (
    <div className="gs-enter">
      <ResumeEditor initialTailored={tailored} />
    </div>
  );
}
