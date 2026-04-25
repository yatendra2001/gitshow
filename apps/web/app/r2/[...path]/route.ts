import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * GET /r2/[...path] — proxy reads from the R2 bucket by key.
 *
 * Serves two key spaces:
 *   - `assets/{userId}/{nanoid}.ext` — user-uploaded media (cover
 *     images, video clips). Returned by `/api/resume/upload`.
 *   - `media/{handle}/{kind}/{entityId}/{file}.webp` — pipeline-
 *     generated media (project hero banners, company/school logos
 *     fetched by the media stage). Written by the worker, embedded
 *     in `Resume.projects[].image`. Without this prefix being
 *     allowed, every generated banner 404'd and the project grid
 *     showed grey placeholders.
 *
 * In production callers can set `ASSETS_PUBLIC_BASE_URL` to point
 * directly at a public R2 / CDN origin and bypass this route — but
 * when that's unset (dev, early deploys) this handler closes the gap.
 *
 * Public read: keys are unguessable (nanoid suffix on uploads, KG
 * entity IDs that include scan-bound prefixes on pipeline media), and
 * portfolio pages are public anyway.
 */

const ALLOWED_CONTENT_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const key = path.join("/");

  if (!key.startsWith("assets/") && !key.startsWith("media/")) {
    return new Response("not found", { status: 404 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return new Response("bucket unbound", { status: 500 });
  }

  const object = await env.BUCKET.get(key);
  if (!object) {
    return new Response("not found", { status: 404 });
  }

  const contentType =
    object.httpMetadata?.contentType || "application/octet-stream";

  // Refuse to serve types we never intended to upload; protects against
  // a stale scan or manual bucket write leaking a non-image asset
  // through the same route.
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return new Response("forbidden", { status: 403 });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      ETag: object.httpEtag,
    },
  });
}
