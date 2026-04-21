import { NotFoundHero } from "@/components/not-found-hero";

/**
 * Root 404 — fires for any unmatched path outside the `[handle]`
 * route. Uses the shared `NotFoundHero` to surface the attempted path
 * and nudge the user into creating a portfolio.
 */
export default function NotFound() {
  return <NotFoundHero kind="generic" />;
}
