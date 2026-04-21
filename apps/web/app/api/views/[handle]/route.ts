import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isReservedHandle } from "@/lib/profiles";

/**
 * GET  /api/views/{handle} — returns the current view_count.
 * POST /api/views/{handle} — fire-and-forget +1 for the handle's
 * published profile. Called from the /{handle} layout on mount.
 *
 * No auth — anyone can increment, which is accurate for a "page views"
 * counter. No dedup — this is a low-stakes vanity metric on the
 * owner's dashboard. If it ever becomes abusable we'll add IP/day
 * dedup via a second table.
 *
 * Uses `public_slug` for the lookup so the normalized URL form matches
 * what the user pasted. Rejects reserved handles up-front so crawlers
 * hitting /api or /app don't spam the row.
 */

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  if (isReservedHandle(handle)) {
    return NextResponse.json({ error: "reserved" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  try {
    const slug = handle.toLowerCase();
    // UPDATE-with-WHERE is a no-op for unpublished / nonexistent
    // profiles. We don't create rows from here — the publish endpoint
    // owns row creation.
    await env.DB.prepare(
      `UPDATE user_profiles
         SET view_count = view_count + 1
         WHERE public_slug = ? AND current_profile_r2_key IS NOT NULL`,
    )
      .bind(slug)
      .run();
  } catch {
    // Never 500 a view-tracking request — it's best-effort.
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  if (isReservedHandle(handle)) {
    return NextResponse.json({ views: 0 }, { status: 200 });
  }
  const { env } = await getCloudflareContext({ async: true });
  const slug = handle.toLowerCase();
  const row = await env.DB.prepare(
    `SELECT view_count FROM user_profiles
       WHERE public_slug = ? LIMIT 1`,
  )
    .bind(slug)
    .first<{ view_count: number }>();
  return NextResponse.json({ views: row?.view_count ?? 0 });
}
