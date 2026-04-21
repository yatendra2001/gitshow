"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Client-side Better Auth handle. Used by <SignInButton/> and the
 * sign-out button in /app/page.tsx. `baseURL` is the current origin
 * so it works in prod + `wrangler dev` (localhost:8787) + `next dev`
 * without a build-time URL env.
 */
export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined" ? undefined : window.location.origin,
});

export const { signIn, signOut, useSession, getSession } = authClient;
