import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProPage } from "@/lib/entitlements";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import { loadTailoredIndex } from "@/lib/tailored-resume-io";
import { ResumeList } from "./_list";

/**
 * `/app/resume` — list of every resume the user has generated.
 *
 * Every resume is JD-tied. There's no "base resume" concept anymore;
 * the only way to generate is via the "New resume" dialog (paste a
 * JD → stream → land on the new variant's editor).
 *
 * Server-loads:
 *   - The tailored index (one R2 GET, cheap).
 *   - Whether the user has a portfolio (published or draft) — needed
 *     so the empty state can nudge them to run a scan if they haven't.
 */

export const dynamic = "force-dynamic";

export default async function ResumePage() {
  const session = await requireProPage();
  const handle = session.user.login!;
  const { env } = await getCloudflareContext({ async: true });

  const [index, published, draft] = await Promise.all([
    loadTailoredIndex(env.BUCKET, handle),
    loadPublishedResume(env.BUCKET, handle),
    loadDraftResume(env.BUCKET, handle),
  ]);

  return (
    <div className="gs-enter">
      <ResumeList
        initialItems={index.items}
        hasPortfolio={Boolean(published || draft)}
      />
    </div>
  );
}
