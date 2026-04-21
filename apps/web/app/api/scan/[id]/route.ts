import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import {
  getScanByIdForUser,
  listClaimsForScan,
  claimRowToCardShape,
} from "@/lib/scans";

/**
 * GET /api/scan/[id] — scan status + claim snapshot.
 *
 * Returns:
 *   { scan: {...}, claims: [{id, beat, text, ...}, ...] }
 *
 * Claims carry whatever the pipeline has persisted so far — callers
 * render them live into the JSXPreview artifact.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const scan = await getScanByIdForUser(env.DB, id, session.user.id);
  if (!scan) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const claimRows = await listClaimsForScan(env.DB, id);
  const claims = claimRows.map(claimRowToCardShape);

  return NextResponse.json({ scan, claims });
}
