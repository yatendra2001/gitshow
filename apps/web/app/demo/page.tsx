import type { Metadata } from "next";
import PortfolioPage from "@/components/portfolio-page";

/**
 * Public demo portfolio at `/demo`. Renders the same template used for
 * `/{handle}`, backed by a canned Resume in `lib/constants.ts`. Linked
 * from the marketing landing so prospects can see a real portfolio
 * before signing up.
 */

export const metadata: Metadata = {
  title: "GitShow demo — a sample portfolio",
  description:
    "See what a GitShow portfolio looks like. Generated from a real GitHub history, every claim linked to the commit it came from.",
};

export default function DemoPage() {
  return <PortfolioPage />;
}
