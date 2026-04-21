import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { getSession } from "@/auth";
import { loadDraftResume } from "@/lib/resume-io";
import PortfolioPage from "@/components/portfolio-page";
import { DataProvider } from "@/components/data-provider";
import { FlickeringGrid } from "@/components/magicui/flickering-grid";
import Navbar from "@/components/navbar";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * /app/preview — owner-only draft preview.
 *
 * Renders the template against the authenticated user's
 * `resumes/{handle}/draft.json` so they can review before publishing.
 * Mirrors `/{handle}`'s layout (FlickeringGrid header, max-w-2xl, dock)
 * plus a "Draft · not public yet" strip at the top with back + publish
 * affordances.
 *
 * Auth gate: unauthenticated → /signin. No draft → redirect back to
 * /app so the dashboard surfaces the appropriate empty / scan state.
 */

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const dynamic = "force-dynamic";

export default async function PreviewPage() {
  const session = await getSession();
  if (!session?.user?.id || !session.user.login) redirect("/signin");

  const handle = session.user.login;
  const { env } = await getCloudflareContext({ async: true });
  const draft = await loadDraftResume(env.BUCKET, handle);
  if (!draft) redirect("/app");

  return (
    <div
      className={cn(
        "portfolio-theme",
        geistSans.variable,
        geistMono.variable,
        "font-sans min-h-dvh bg-background text-foreground relative antialiased",
      )}
    >
      <DraftBanner handle={handle} />
      <DataProvider resume={draft} handle={handle}>
        <div className="absolute inset-x-0 top-[40px] h-[100px] overflow-hidden z-0">
          <FlickeringGrid
            className="h-full w-full"
            squareSize={2}
            gridGap={2}
            style={{
              maskImage: "linear-gradient(to bottom, black, transparent)",
              WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
            }}
          />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto pt-12 pb-24 sm:pt-20 px-6">
          <PortfolioPageSections />
        </div>
        <Navbar />
      </DataProvider>
    </div>
  );
}

function DraftBanner({ handle }: { handle: string }) {
  return (
    <div className="sticky top-0 z-30 flex h-10 items-center justify-between gap-3 border-b border-border/40 bg-background/85 px-4 backdrop-blur">
      <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
        <Link
          href="/app"
          className="inline-flex items-center gap-1.5 font-mono text-foreground underline-offset-2 hover:underline"
          aria-label="Back to dashboard"
        >
          <LogoMark size={18} />
          <span>← /app</span>
        </Link>
        <span>
          Draft preview · <span className="text-foreground">@{handle}</span> · not public yet
        </span>
      </div>
    </div>
  );
}

/**
 * Inline the PortfolioPage render rather than using the default export,
 * so we can tweak top-offset for the preview banner without forking
 * the shared component.
 */
function PortfolioPageSections() {
  // The default PortfolioPage already renders TooltipProvider + sections;
  // we import it rather than re-implementing. Left as a wrapper so
  // future preview-specific UI (Publish CTA overlay, etc.) has a home.
  return <PortfolioPage />;
}
