import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { loadPublicHiringByHandle } from "@/lib/bip-data";

/**
 * GET /api/public/hiring/[handle] — public lookup for portfolio badges.
 *
 * Returns the open-to-work surface for a portfolio if the user has
 * (a) discoverable=1 in users, and (b) status != 'not_looking'.
 * Returns 404 otherwise so the badge component can render nothing.
 *
 * Comp range is conditionally included based on settings.show_comp.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ handle: string }> },
) {
  const { handle } = await ctx.params;
  if (!handle || handle.length > 80) {
    return NextResponse.json({ error: "bad_handle" }, { status: 400 });
  }
  const { env } = await getCloudflareContext({ async: true });
  const payload = await loadPublicHiringByHandle(env.DB, handle);
  if (!payload) {
    return NextResponse.json({ error: "not_open" }, { status: 404 });
  }
  const s = payload.settings;
  return NextResponse.json({
    handle: payload.handle,
    publicSlug: payload.publicSlug,
    status: s.status,
    roles: s.roles,
    locations: s.locations,
    blurb: s.blurb,
    comp: s.show_comp
      ? { minUsd: s.comp_min_usd, maxUsd: s.comp_max_usd }
      : null,
  });
}
