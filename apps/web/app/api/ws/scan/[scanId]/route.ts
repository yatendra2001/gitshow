import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { getScanByIdForUser } from "@/lib/scans";

/**
 * GET /api/ws/scan/[scanId]  (Upgrade: websocket)
 *
 * Upgrades an HTTP request into a WebSocket connection to the scan's
 * ScanLiveDO instance. Auth is checked once at upgrade time — after
 * the socket is open, no per-message re-auth (typical).
 *
 * Runtime: Workers (OpenNext wraps Node route handlers but the
 * underlying runtime is Workers; `req.headers.get('Upgrade')` and the
 * WebSocketPair-returning stub.fetch pattern work here).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ scanId: string }> },
) {
  if (req.headers.get("Upgrade") !== "websocket") {
    return new Response("expected websocket upgrade", { status: 426 });
  }

  const session = await getSession();
  if (!session?.user?.id) {
    return new Response("unauthenticated", { status: 401 });
  }

  const { scanId } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const scan = await getScanByIdForUser(env.DB, scanId, session.user.id);
  if (!scan) {
    return new Response("not found", { status: 404 });
  }

  // Forward the upgrade to the DO. The DO accepts and hibernates.
  const id = env.SCAN_LIVE_DO.idFromName(scanId);
  const stub = env.SCAN_LIVE_DO.get(id);

  // Rewrite the URL path so the DO can parse the scan_id out of it
  // (its fetch handler expects /scans/:scan_id/ws).
  const proxied = new Request(
    new URL(`/scans/${encodeURIComponent(scanId)}/ws`, req.url).toString(),
    {
      method: "GET",
      headers: req.headers,
    },
  );
  return stub.fetch(proxied);
}
