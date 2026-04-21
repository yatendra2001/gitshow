import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { markNotificationRead } from "@/lib/notifications";

/**
 * PATCH /api/notifications/[id] { read: true }
 *
 * Marks a single inbox entry read. Idempotent — already-read entries
 * return 200 with marked: false so the UI can treat it as a no-op.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { read?: boolean };
  try {
    body = (await req.json()) as { read?: boolean };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (body.read !== true) {
    return NextResponse.json({ error: "unsupported_update" }, { status: 400 });
  }

  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const marked = await markNotificationRead(env.DB, id, session.user.id);
  return NextResponse.json({ marked });
}
