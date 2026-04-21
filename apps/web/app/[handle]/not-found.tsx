import { NotFoundHero } from "@/components/not-found-hero";

/**
 * Fires when `/{handle}` has no published.json in R2, either because
 * the handle has never been scanned or the owner deleted the profile.
 * Reuses the shared `NotFoundHero` — the handle itself is derived
 * client-side from the pathname since Next.js doesn't pipe `params`
 * into `not-found.tsx`.
 */
export default function HandleNotFound() {
  return <NotFoundHero kind="handle" />;
}
