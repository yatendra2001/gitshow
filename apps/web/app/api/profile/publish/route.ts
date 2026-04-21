import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { getSession } from "@/auth";
import { getScanByIdForUser } from "@/lib/scans";

/**
 * POST /api/profile/publish — make `/{handle}` serve this scan's card.
 * DELETE /api/profile/publish — unpublish (remove the row).
 *
 * Scan completion used to auto-write the user_profiles row. Now the
 * /s/<scanId> view is the editing surface; the user reviews, edits,
 * and only then clicks Publish. The upsert lives here (Cloudflare
 * side, native DB binding) instead of in the Fly worker's REST client.
 *
 * `user_profiles.user_id` is a primary key — publishing a newer scan
 * replaces the older one, so "Publish" on a fresh scan always wins.
 */

const BodySchema = z.object({
  scanId: z.string(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { scanId } = parse.data;

  const { env } = await getCloudflareContext({ async: true });
  const scan = await getScanByIdForUser(env.DB, scanId, session.user.id);
  if (!scan) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (scan.status !== "succeeded") {
    return NextResponse.json(
      { error: "not_succeeded", detail: `Scan is ${scan.status}.` },
      { status: 409 },
    );
  }

  const now = Date.now();
  const slug = scan.handle.toLowerCase();
  // R2 uploads go through R2Client.uploadStageFile which prefixes with
  // `scans/`, so the canonical key is `scans/<scanId>/14-card.json`.
  // Writing the bare `<scanId>/14-card.json` variant here meant the
  // /{handle} route couldn't resolve the object and 404'd even after
  // a successful publish.
  const cardKey = `scans/${scanId}/14-card.json`;

  try {
    await env.DB.prepare(
      `INSERT INTO user_profiles
         (user_id, handle, public_slug, current_scan_id, current_profile_r2_key,
          first_scan_at, last_scan_at, revision_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         handle = excluded.handle,
         public_slug = excluded.public_slug,
         current_scan_id = excluded.current_scan_id,
         current_profile_r2_key = excluded.current_profile_r2_key,
         last_scan_at = excluded.last_scan_at,
         updated_at = excluded.updated_at`,
    )
      .bind(
        session.user.id,
        scan.handle,
        slug,
        scanId,
        cardKey,
        now,
        now,
        now,
        now,
      )
      .run();
  } catch (err) {
    return NextResponse.json(
      { error: "db", detail: (err as Error).message.slice(0, 200) },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, handle: scan.handle, slug });
}

export async function DELETE() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { env } = await getCloudflareContext({ async: true });
  try {
    await env.DB.prepare(`DELETE FROM user_profiles WHERE user_id = ?`)
      .bind(session.user.id)
      .run();
  } catch (err) {
    return NextResponse.json(
      { error: "db", detail: (err as Error).message.slice(0, 200) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/profile/publish?scanId=… — is this scan the one currently
 * pointed at by /{handle}? Lets the client render the "Published" vs
 * "Publish" button state without leaking other user-level fields.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const scanId = new URL(req.url).searchParams.get("scanId");
  if (!scanId) {
    return NextResponse.json({ error: "missing scanId" }, { status: 400 });
  }
  const { env } = await getCloudflareContext({ async: true });
  const row = await env.DB.prepare(
    `SELECT current_scan_id, handle FROM user_profiles WHERE user_id = ? LIMIT 1`,
  )
    .bind(session.user.id)
    .first<{ current_scan_id: string; handle: string }>();
  return NextResponse.json({
    published: row?.current_scan_id === scanId,
    handle: row?.handle ?? null,
  });
}
