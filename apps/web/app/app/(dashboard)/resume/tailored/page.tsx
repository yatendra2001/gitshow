import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProPage } from "@/lib/entitlements";
import { loadTailoredIndex } from "@/lib/tailored-resume-io";
import { loadResumeDoc } from "@/lib/resume-doc-io";
import { TailoredListPage } from "./_list-page";

/**
 * `/app/resume/tailored` — list of every JD-tailored resume the user
 * has generated, with a "+ Tailor for job" CTA at the top.
 *
 * Tailoring requires a base `ResumeDoc` — we surface that prereq in
 * the page itself rather than letting the dialog fail late.
 */

export const dynamic = "force-dynamic";

export default async function TailoredPage() {
  const session = await requireProPage();
  const handle = session.user.login!;
  const { env } = await getCloudflareContext({ async: true });

  const [baseDoc, index] = await Promise.all([
    loadResumeDoc(env.BUCKET, handle),
    loadTailoredIndex(env.BUCKET, handle),
  ]);

  return (
    <div className="gs-enter">
      <TailoredListPage
        initialItems={index.items}
        hasBaseResume={Boolean(baseDoc)}
      />
    </div>
  );
}
