import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { FlickeringGrid } from "@/components/magicui/flickering-grid";
import Navbar from "@/components/navbar";
import { DataProvider } from "@/components/data-provider";
import { loadPublishedResume } from "@/lib/resume-io";
import { isReservedHandle } from "@/lib/profiles";

/**
 * Portfolio subtree layout — matches the reference template's root
 * `layout.tsx` (FlickeringGrid header, max-w-2xl content column, floating
 * Navbar dock), and injects the per-handle Resume via `<DataProvider>` so
 * every downstream section renders the right user's data.
 *
 * 404s for reserved-word handles (`/app`, `/api`, …) and for handles with
 * no published Resume.
 */
export default async function PortfolioLayout({
  params,
  children,
}: {
  params: Promise<{ handle: string }>;
  children: React.ReactNode;
}) {
  const { handle } = await params;

  if (isReservedHandle(handle)) notFound();

  const { env } = await getCloudflareContext({ async: true });
  const resume = await loadPublishedResume(env.BUCKET, handle);
  if (!resume) notFound();

  return (
    <DataProvider resume={resume} handle={handle}>
      <div className="absolute inset-0 top-0 left-0 right-0 h-[100px] overflow-hidden z-0">
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
      <div className="relative z-10 max-w-2xl mx-auto py-12 pb-24 sm:py-24 px-6">
        {children}
      </div>
      <Navbar />
    </DataProvider>
  );
}
