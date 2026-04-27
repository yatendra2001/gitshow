import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { requireProPage } from "@/lib/entitlements";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import { TemplatePreview } from "./_template-preview";

/**
 * /app/preview — owner-only draft preview.
 *
 * Loads the user's draft and renders it inside the TemplatePreview
 * client wrapper, which:
 *   - Renders the chosen template (defaults to whatever's saved on the
 *     draft) full-bleed.
 *   - Floats a template chooser dock at the bottom for switching variants
 *     and persisting the choice via PATCH/publish.
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
      <DraftStrip handle={handle} isPublished={isPublished} />
      <TemplatePreview
        initialResume={draft}
        handle={handle}
        isPublished={isPublished}
      />
    </div>
  );
}

function DraftStrip({
  handle,
  isPublished,
}: {
  handle: string;
  isPublished: boolean;
}) {
  return (
    <div className="sticky top-14 z-20 -mx-4 sm:-mx-6 mb-2 flex h-9 items-center justify-between gap-3 border-b border-border/40 bg-background/85 px-4 sm:px-6 backdrop-blur">
      <span className="text-[12px] text-muted-foreground">
        Draft preview · <span className="text-foreground">@{handle}</span>
        {isPublished ? (
          <>
            {" · "}
            <Link
              href={`/${handle}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-foreground underline-offset-2 hover:underline"
            >
              live at gitshow.io/{handle} ↗
            </Link>
          </>
        ) : (
          <> · not public yet</>
        )}
      </span>
      <span className="text-[11px] text-muted-foreground hidden sm:inline">
        Pick a template below ↓
      </span>
    </div>
  );
}
