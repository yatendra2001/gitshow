import { NextResponse } from "next/server";

/**
 * GET /api/push/vapid-key
 *
 * Returns the VAPID public key so the client-side subscription flow
 * (PushManager.subscribe) can identify this app to the browser's push
 * service. Public key — safe to expose. Private key stays on the
 * worker that signs outbound pushes.
 *
 * Gracefully returns { enabled: false } when VAPID_PUBLIC_KEY isn't
 * configured — the UI then hides the "enable desktop alerts" prompt
 * rather than breaking.
 */
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ enabled: false });
  }
  return NextResponse.json({ enabled: true, public_key: publicKey });
}
