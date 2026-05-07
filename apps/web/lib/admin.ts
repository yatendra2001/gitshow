import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getSession, type AppSession } from "@/auth";

/**
 * Admin gate. The admin panel at `/app/admin` is operator-only — used to
 * inspect every user's profile draft and scan logs. Scoped by GitHub
 * login (the OAuth username), not user_id, so the same allowlist works
 * even if a row in `users` ever gets reseeded.
 *
 * Single allowlist defined here. Extend by appending to `ADMIN_LOGINS`.
 */

const ADMIN_LOGINS = new Set(["yatendra2001"]);

export function isAdminLogin(login: string | null | undefined): boolean {
  if (!login) return false;
  return ADMIN_LOGINS.has(login.toLowerCase());
}

export function isAdminSession(session: AppSession | null): boolean {
  return isAdminLogin(session?.user?.login ?? null);
}

/**
 * Server-component guard. Bounces unauthenticated users to /signin and
 * non-admins to /app (the regular dashboard). Returns the live session
 * when access is ok.
 */
export async function requireAdminPage(): Promise<AppSession> {
  const session = await getSession();
  if (!session?.user?.id) redirect("/signin");
  if (!isAdminSession(session)) redirect("/app");
  return session;
}

export type AdminGate =
  | { ok: true; session: AppSession }
  | { ok: false; response: NextResponse };

/**
 * Route-handler variant. 401 unauthenticated, 403 non-admin. Mirrors the
 * shape of `requireProApi()` in lib/entitlements.ts so the calling
 * pattern is identical.
 */
export async function requireAdminApi(): Promise<AdminGate> {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthenticated" },
        { status: 401 },
      ),
    };
  }
  if (!isAdminSession(session)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "forbidden" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}
