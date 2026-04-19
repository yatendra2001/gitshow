import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import { getScanByIdForUser, listEventsSince, parseEventRow } from "@/lib/scans";
import type { ScanEventEnvelope } from "@gitshow/shared/events";

/**
 * GET /api/scan/[id]/events?since=<id>&limit=<n>
 *
 * Backfill endpoint. The live channel is the WebSocket at
 * /api/ws/scan/[id] powered by ScanLiveDO; this endpoint fills in
 * everything that happened BEFORE the WS connected, plus acts as the
 * polling fallback when the WS can't hold (mobile Safari, office
 * proxies, whatever).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? 0);
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 200));

  const { env } = await getCloudflareContext({ async: true });
  const scan = await getScanByIdForUser(env.DB, id, session.user.id);
  if (!scan) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rows = await listEventsSince(env.DB, id, since, limit);
  const events: ScanEventEnvelope[] = rows.map((r) => ({
    id: r.id,
    scan_id: r.scan_id,
    at: r.at,
    event: parseEventRow(r),
  }));

  return NextResponse.json({
    events,
    // Terminal? UI can stop polling if the scan is in a final state and
    // no new events arrived.
    terminal:
      scan.status === "succeeded" ||
      scan.status === "failed" ||
      scan.status === "cancelled",
  });
}
