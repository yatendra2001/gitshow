import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { requireProPage } from "@/lib/entitlements";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import PortfolioPage from "@/components/portfolio-page";
import { DataProvider } from "@/components/data-provider";
import { FlickeringGrid } from "@/components/magicui/flickering-grid";
import Navbar from "@/components/navbar";
import { PreviewPublishButton } from "./_publish-button-compact";

/**
 * /app/preview — owner-only draft preview.
 *
 * Renders inside the dashboard shell — the sidebar persists. The
 * preview surface itself is the actual portfolio template against the
 * authenticated user's draft so they can review before publishing.
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
    <div className="portfolio-theme relative">
      <DraftStrip handle={handle} isPublished={isPublished} />
      <DataProvider resume={draft} handle={handle}>
        <div className="absolute inset-x-0 top-[40px] h-[100px] overflow-hidden z-0 pointer-events-none">
          <FlickeringGrid
            className="h-full w-full"
            squareSize={2}
            gridGap={2}
            style={{
              maskImage: "linear-gradient(to bottom, black, transparent)",
              WebkitMaskImage:
                "linear-gradient(to bottom, black, transparent)",
            }}
          />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto pt-12 pb-24 sm:pt-20 px-6">
          <PortfolioPage />
        </div>
        <Navbar />
      </DataProvider>
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
      <PreviewPublishButton isPublished={isPublished} />
    </div>
  );
}
