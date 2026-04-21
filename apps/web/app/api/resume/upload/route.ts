import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { getSession } from "@/auth";

/**
 * POST /api/resume/upload — multipart media upload to R2.
 *
 * Accepts a single `file` form field (images up to 10 MB, mp4 up to
 * 25 MB). Returns a public URL the editor can drop into Resume JSON
 * fields (`avatarUrl`, `projects[].image`, `projects[].video`,
 * `work[].logoUrl`, `education[].logoUrl`).
 *
 * Key layout: `assets/{userId}/{uuid}.{ext}` — user-scoped so a hostile
 * user can't clobber another user's assets, uuid-randomised so a
 * replaced file invalidates caches cleanly.
 */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
]);

function extFor(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    default:
      return "bin";
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return NextResponse.json({ error: "r2_not_bound" }, { status: 500 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "invalid_form" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "missing_file", detail: "Expected multipart field 'file'" },
      { status: 400 },
    );
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: "unsupported_type", detail: contentType },
      { status: 415 },
    );
  }

  const cap = contentType.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > cap) {
    return NextResponse.json(
      {
        error: "too_large",
        detail: `Max ${Math.round(cap / (1024 * 1024))} MB for ${contentType}`,
      },
      { status: 413 },
    );
  }

  const ext = extFor(contentType);
  const key = `assets/${session.user.id}/${nanoid(16)}.${ext}`;
  const buffer = await file.arrayBuffer();

  try {
    await env.BUCKET.put(key, buffer, {
      httpMetadata: { contentType },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "r2_write", detail: (err as Error).message.slice(0, 200) },
      { status: 500 },
    );
  }

  const publicBase = process.env.ASSETS_PUBLIC_BASE_URL;
  const url = publicBase ? `${publicBase.replace(/\/+$/, "")}/${key}` : `/r2/${key}`;

  return NextResponse.json({ ok: true, key, url, contentType });
}
