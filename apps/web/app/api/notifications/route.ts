import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import {
  listNotificationsForUser,
  markAllNotificationsRead,
  countUnreadForUser,
} from "@/lib/notifications";

/**
 * GET /api/notifications
 *
 * Lists the authenticated user's in-app inbox entries. Returns unread
 * first if `unread=1`. No cost / token data surfaces here — notifications
 * are purely what-happened, not how-much-did-it-cost.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50));

  const { env } = await getCloudflareContext({ async: true });
  const [notifications, unreadCount] = await Promise.all([
    listNotificationsForUser(env.DB, session.user.id, { unreadOnly, limit }),
    countUnreadForUser(env.DB, session.user.id),
  ]);

  return NextResponse.json({ notifications, unread_count: unreadCount });
}

/**
 * POST /api/notifications { action: "mark-all-read" }
 *
 * Currently only supports mark-all-read. Individual mark-read is at
 * /api/notifications/[id].
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { action?: string };
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (body.action !== "mark-all-read") {
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const changed = await markAllNotificationsRead(env.DB, session.user.id);
  return NextResponse.json({ marked: changed });
}
