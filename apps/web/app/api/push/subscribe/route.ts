import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import {
  addPushSubscription,
  removePushSubscription,
} from "@/lib/notifications";

/**
 * POST /api/push/subscribe
 *
 * Body: the PushSubscription JSON the browser produces, plus an
 * optional user_agent string for debugging. Upserts into
 * push_subscriptions keyed by (user_id, endpoint).
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    user_agent?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  await addPushSubscription(env.DB, {
    user_id: session.user.id,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth_token: body.keys.auth,
    user_agent: body.user_agent ?? req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/push/subscribe?endpoint=<...>
 *
 * Drops a stored subscription. Called from the client when the user
 * revokes permission or from the push sender after a 410 Gone from
 * the push service.
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const url = new URL(req.url);
  const endpoint = url.searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "missing_endpoint" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  await removePushSubscription(env.DB, session.user.id, endpoint);
  return NextResponse.json({ ok: true });
}
