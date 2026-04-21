import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * GET /r2/[...path] — proxy reads from the R2 bucket by key.
 *
 * The upload endpoint (`POST /api/resume/upload`) returns a URL under
 * `/r2/assets/{userId}/{id}.ext`. In production the caller can set
 * `ASSETS_PUBLIC_BASE_URL` to point directly at a public R2 / CDN
 * origin and bypass this route entirely — but when that's unset
 * (dev, early deploys) the uploaded object was just 404'ing because
 * no route actually served `/r2/*`. This handler closes that gap.
 *
 * Public read: keys are `assets/{userId}/{nanoid(16)}.ext`; without
 * the exact randomised suffix you can't guess a URL, and portfolio
 * pages are public so the assets they embed must be fetchable
 * unauthenticated anyway.
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

  if (!key.startsWith("assets/")) {
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
