import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupRoutingByHostname } from "@/lib/domains/repo";

/**
 * Internal lookup endpoint. ONLY called by the edge middleware via
 * same-origin fetch. Returns `{ slug }` (or `{ slug: null }` if the
 * hostname isn't registered).
 *
 * Security: the only callers of this endpoint should be our own
 * middleware. We don't actively block external callers (CF for SaaS
 * already 404s anything that arrives without a registered hostname),
 * but the `x-internal-route` header acts as a soft tripwire — if we
 * ever see traffic without it in logs, it's worth investigating.
 *
 * The response is fast: a single indexed query against custom_domains
 * joined to user_profiles. No auth, no session, no work beyond the
 * one row.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const host = (url.searchParams.get("h") ?? "").toLowerCase().trim();
  if (!host) return NextResponse.json({ slug: null });
  // Reject anything that doesn't look like a hostname — defense
  // against bizarre input.
  if (!/^[a-z0-9.-]+$/.test(host)) return NextResponse.json({ slug: null });

  const { env } = await getCloudflareContext({ async: true });
  const row = await lookupRoutingByHostname(env.DB, host);
  if (!row || !row.is_published) {
    return NextResponse.json({ slug: null });
  }
  return NextResponse.json({ slug: row.public_slug });
}
