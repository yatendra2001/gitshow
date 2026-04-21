import PortfolioPage from "@/components/portfolio-page";

/**
 * Public portfolio render at `/{handle}`. The parent
 * `app/[handle]/layout.tsx` loads the Resume from R2 and wires the
 * DataProvider; we just render the template sections.
 */
export default function Page() {
  return <PortfolioPage />;
}
