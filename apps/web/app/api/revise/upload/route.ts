import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { getSession } from "@/auth";
import { getScanByIdForUser } from "@/lib/scans";

/**
 * POST /api/revise/upload
 *
 * multipart/form-data with fields: file, scanId.
 *
 * Uploads an image attachment for a revise message into R2 and
 * returns the R2 key. The web client stores keys in state until
 * submit, at which point they're sent alongside the guidance text
 * to /api/revise and propagated to the worker via env.
 *
 * Safeguards:
 *   - auth required, scan must be owned by the user.
 *   - only image/* content-types accepted.
 *   - 5MB hard cap (matches Sonnet 4.6's per-image limit).
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "bad_multipart" }, { status: 400 });
  }
  const file = form.get("file");
  const scanId = form.get("scanId");
  if (!(file instanceof File) || typeof scanId !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "bad_type", allowed: ALLOWED_TYPES },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const scan = await getScanByIdForUser(env.DB, scanId, session.user.id);
  if (!scan) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const ext = file.type.split("/")[1] ?? "bin";
  const key = `revise-uploads/${scanId}/${nanoid(12)}.${ext}`;
  try {
    await env.BUCKET.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "r2_put_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ r2_key: key });
}
