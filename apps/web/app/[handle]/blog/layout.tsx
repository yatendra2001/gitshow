import { FlickeringGrid } from "@/components/magicui/flickering-grid";
import Navbar from "@/components/navbar";

/**
 * Blog reading shell — gives `/{handle}/blog` and `/{handle}/blog/{slug}`
 * the same chrome the reference portfolio uses for its blog: a centred
 * max-w-2xl column, the FlickeringGrid accent at the very top, and the
 * floating dock navbar at the bottom.
 *
 * Why a dedicated layout instead of letting each template own this:
 * blog reading is a long-form text surface, and a clean reader chrome
 * works regardless of which template the user picked for their landing
 * page (glow, spotlight, terminal, …). The portfolio reference deliberately
 * uses this exact shell, and keeping parity with it is the user's goal.
 *
 * The outer `[handle]/layout.tsx` still owns DataProvider + TrackView +
 * ShareButton, so this layout only adds the visual frame.
 */
export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="absolute inset-0 top-0 left-0 right-0 h-[100px] overflow-hidden z-0 pointer-events-none">
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
      <div className="relative z-10 max-w-2xl mx-auto py-12 pb-24 sm:py-24 px-6">
        {children}
      </div>
      <Navbar />
    </>
  );
}
