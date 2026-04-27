"use client";

import { FlickeringGrid } from "@/components/magicui/flickering-grid";
import Navbar from "@/components/navbar";
import PortfolioPage from "@/components/portfolio-page";

/**
 * Classic — gitshow's original template.
 *
 * Friendly scrolling layout, max-w-2xl content column, FlickeringGrid
 * accent at the top, floating dock navbar. The default for new portfolios
 * and the safe choice for any developer.
 */
export default function ClassicTemplate() {
  return (
    <>
      <div className="absolute inset-0 top-0 left-0 right-0 h-[100px] overflow-hidden z-0 pointer-events-none">
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
        <PortfolioPage />
      </div>
      <Navbar />
    </>
  );
}
