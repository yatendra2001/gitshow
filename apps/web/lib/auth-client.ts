"use client";

import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth";
import { dodopaymentsClient } from "@dodopayments/better-auth";

/**
 * Client-side Better Auth handle. Used by <SignInButton/> and the
 * sign-out button in /app/page.tsx. `baseURL` is the current origin
 * so it works in prod + `wrangler dev` (localhost:8787) + `next dev`
 * without a build-time URL env.
 *
 * The `dodopaymentsClient()` plugin exposes:
 *   - authClient.dodopayments.checkoutSession({ slug | product_cart })
 *   - authClient.dodopayments.customer.portal()
 *   - authClient.dodopayments.customer.subscriptions.list({ query })
 *   - authClient.dodopayments.customer.payments.list({ query })
 *
 * Each call wraps a POST to the server plugin, which holds the Dodo
 * API key. No secrets ever reach the browser.
 */
export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined" ? undefined : window.location.origin,
  // Cast bridges the same better-auth/Dodo version skew as in auth.ts.
  plugins: [dodopaymentsClient() as unknown as BetterAuthClientPlugin],
});

export const { signIn, signOut, useSession, getSession } = authClient;
