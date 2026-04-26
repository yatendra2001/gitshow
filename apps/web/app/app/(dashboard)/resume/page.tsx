import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProPage } from "@/lib/entitlements";
import { loadResumeDoc } from "@/lib/resume-doc-io";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import { ResumeEditor } from "./_resume-editor";
import { ResumeEmpty } from "./_resume-empty";

/**
 * /app/resume — printable, ATS-friendly resume editor.
 *
 * Three states:
 *   1. No portfolio Resume yet → user must run a scan first.
 *   2. Resume exists but no ResumeDoc generated → show "Generate" CTA.
 *   3. ResumeDoc exists → render the full editor.
 */

export const dynamic = "force-dynamic";

export default async function ResumePage() {
  const session = await requireProPage();
  const handle = session.user.login!;
  const { env } = await getCloudflareContext({ async: true });

  const [doc, published, draft] = await Promise.all([
    loadResumeDoc(env.BUCKET, handle),
    loadPublishedResume(env.BUCKET, handle),
    loadDraftResume(env.BUCKET, handle),
  ]);

  if (!doc) {
    return (
      <ResumeEmpty
        hasResume={Boolean(published || draft)}
      />
    );
  }

  return <ResumeEditor initialDoc={doc} />;
}
