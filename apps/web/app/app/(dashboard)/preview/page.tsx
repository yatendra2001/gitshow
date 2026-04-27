import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProPage } from "@/lib/entitlements";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import { TemplatePreview } from "./_template-preview";

/**
 * /app/preview — owner-only draft preview.
 *
 * Loads the user's draft and renders it inside the TemplatePreview
 * client wrapper. The wrapper owns the sticky top strip (handle info
 * + templates trigger + save actions) and the full-bleed template
 * itself, so this server component is purely a data-fetch shell.
 *
 * Auth gate: unauthenticated → /signin. No draft → redirect back to
 * /app so the dashboard surfaces the appropriate empty / scan state.
 */

export const dynamic = "force-dynamic";

export default async function PreviewPage() {
  const session = await requireProPage();
  const handle = session.user.login!;
  const { env } = await getCloudflareContext({ async: true });
  const [draft, published] = await Promise.all([
    loadDraftResume(env.BUCKET, handle),
    loadPublishedResume(env.BUCKET, handle),
  ]);
  if (!draft) redirect("/app");
  const isPublished = Boolean(published);

  return (
    <div className="portfolio-theme relative gs-enter">
      <TemplatePreview
        initialResume={draft}
        handle={handle}
        isPublished={isPublished}
      />
    </div>
  );
}
