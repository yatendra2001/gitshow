import { initAuth } from "@/auth";

/**
 * Catch-all Better Auth handler: /api/auth/sign-in/social,
 * /api/auth/sign-out, /api/auth/get-session, /api/auth/callback/github,
 * etc. all funnel through here.
 *
 * We can't use `toNextJsHandler(auth)` because `auth` is an async
 * factory (D1 binding only available per-request). So we wire GET/POST
 * manually and call `auth.handler(req)` — the shape Better Auth
 * already expects.
 */
export async function GET(req: Request) {
  const auth = await initAuth();
  return auth.handler(req);
}

export async function POST(req: Request) {
  const auth = await initAuth();
  return auth.handler(req);
}
