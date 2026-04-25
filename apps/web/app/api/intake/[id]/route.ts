import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { getIntakeForUser } from "@/lib/intake";

/**
 * GET /api/intake/[id]
 *
 * Returns the intake row for the authed user. The intake page no
 * longer polls this (it just shows the URL form immediately), but
 * the route stays for status checks (e.g. resuming a consumed
 * intake to surface its scan_id).
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
  const intake = await getIntakeForUser(env.DB, id, session.user.id);
  if (!intake) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(intake);
}
