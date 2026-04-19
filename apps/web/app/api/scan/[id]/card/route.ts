import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import { getScanByIdForUser } from "@/lib/scans";
import { getScanCard } from "@/lib/cards";

/**
 * GET /api/scan/[id]/card — the slim ProfileCard for a finished scan.
 * Returns 425 while the scan is still running (so the client knows to
 * keep polling / listening to the WS).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const scan = await getScanByIdForUser(env.DB, id, session.user.id);
  if (!scan) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const card = await getScanCard(id, env.BUCKET);
  if (!card) {
    return NextResponse.json(
      { error: "not_ready", status: scan.status },
      { status: 425 },
    );
  }

  return NextResponse.json({ card });
}
