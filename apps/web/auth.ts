import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { cache } from "react";
import DodoPayments from "dodopayments";
import {
  dodopayments,
  checkout,
  portal,
  webhooks,
} from "@dodopayments/better-auth";
import { syncSubscriptionFromWebhook } from "@/lib/billing-sync";

/**
 * Better Auth wired up for OpenNext + Cloudflare D1.
 *
 * Why a factory: Cloudflare bindings (`env.DB`, secrets) are only
 * available inside the request async-local-storage context that
 * OpenNext establishes. Constructing `betterAuth()` at module load
 * would fail in SSG and at cold-start. We build it lazily on first
 * use per request and memoize it after — `getCloudflareContext()` is
 * request-scoped, but the returned `env` reference is stable for the
 * life of the isolate, so one instance per isolate is fine.
 *
 * Path: `d1Native` in `better-auth-cloudflare` hands the D1 binding
 * directly to Better Auth's built-in Kysely adapter. No Drizzle, no
 * schema files — just the SQL in `migrations/0006_better_auth_schema.sql`.
 *
 * Model mapping: we keep the existing `users` table (FK'd by
 * scans/user_profiles/messages/notifications/push_subscriptions) and
 * tell Better Auth to read/write it under that plural name. The three
 * other tables (`account`, `session`, `verification`) are singular
 * Better Auth defaults — created fresh in migration 0006.
 */

type BetterAuthInstance = Awaited<ReturnType<typeof buildAuth>>;

let cached: BetterAuthInstance | null = null;

export async function initAuth(): Promise<BetterAuthInstance> {
  if (cached) return cached;
  cached = await buildAuth();
  return cached;
}

async function buildAuth() {
  const { env } = await getCloudflareContext({ async: true });

  if (!env.AUTH_SECRET) {
    // Missing secret = unusable. Fail loudly so we notice in logs,
    // rather than issuing unsigned cookies.
    throw new Error("AUTH_SECRET is not set. Run `wrangler secret put AUTH_SECRET`.");
  }
  if (!env.AUTH_GITHUB_ID || !env.AUTH_GITHUB_SECRET) {
    throw new Error(
      "AUTH_GITHUB_ID / AUTH_GITHUB_SECRET are not set. See LOCAL_DEV.md.",
    );
  }

  // Dodo Payments client — single instance per isolate. Missing keys
  // aren't fatal at construct time (the SDK only throws when a request
  // is actually made), which means the auth surface stays usable for
  // dev flows that don't hit billing. The checkout/portal endpoints
  // below will 500 with a readable error if the key is truly absent.
  const dodo = new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY ?? "missing",
    environment: env.DODO_PAYMENTS_ENVIRONMENT ?? "test_mode",
  });

  // Product slugs are the stable identifiers the pricing page passes
  // to `authClient.dodopayments.checkoutSession({ slug })`. Actual
  // Dodo product ids come from env so test-mode + live-mode can use
  // the same code path with different ids.
  const checkoutProducts = [
    env.DODO_PRODUCT_ID_MONTHLY && {
      productId: env.DODO_PRODUCT_ID_MONTHLY,
      slug: "pro-monthly",
    },
    env.DODO_PRODUCT_ID_YEARLY && {
      productId: env.DODO_PRODUCT_ID_YEARLY,
      slug: "pro-yearly",
    },
  ].filter(Boolean) as { productId: string; slug: string }[];

  return betterAuth(
    withCloudflare(
      {
        // Turn both off: we don't render per-request geolocation and
        // Cloudflare's `cf` object requires plumbing that doesn't
        // currently exist on the OpenNext request path. Keeping them
        // enabled would add columns + require the `cf` context.
        autoDetectIpAddress: false,
        geolocationTracking: false,
        // `cf` is required to be defined even if unused; empty is fine
        // with both features off (withCloudflare only validates it
        // when at least one of the two above is on).
        cf: {},
        d1Native: env.DB,
      },
      {
        baseURL: env.NEXT_PUBLIC_APP_URL ?? "http://localhost:8787",
        secret: env.AUTH_SECRET,
        // Accept sign-ins from localhost during `preview` AND prod.
        // Production host is added explicitly so the deployed worker
        // URL (gitshow-web.*.workers.dev) isn't silently refused.
        trustedOrigins: [
          "http://localhost:8787",
          "http://localhost:3000",
          env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io",
          "https://gitshow-web.yatendra2001kumar.workers.dev",
        ].filter(Boolean) as string[],
        // Billing plugin. The Dodo Better Auth plugin:
        //   - auto-creates a Dodo customer on GitHub signup (linked
        //     via the `account` table by the plugin itself)
        //   - exposes POST /api/auth/dodopayments/checkout for the
        //     pricing page (`authClient.dodopayments.checkoutSession`)
        //   - exposes GET  /api/auth/dodopayments/customer/portal
        //     for the billing page's "Manage subscription" button
        //   - exposes POST /api/auth/dodopayments/webhooks which
        //     verifies signature + dispatches to our callbacks below.
        //
        // The webhook URL you register in the Dodo dashboard is:
        //   {NEXT_PUBLIC_APP_URL}/api/auth/dodopayments/webhooks
        // Cast: @dodopayments/better-auth v1.6.2 was built against a
        // slightly older better-auth User shape than what better-auth
        // ^1.6.5 exports. The runtime contract is compatible (plugin
        // only reads `user.id`); the cast bridges the structural
        // mismatch on init()'s `databaseHooks.user.create.after` type.
        plugins: [
          dodopayments({
            client: dodo,
            createCustomerOnSignUp: true,
            // Stamp our internal user_id onto the Dodo customer as
            // metadata. Dodo echoes this back on every webhook under
            // `data.customer.metadata.userId` — that's how the sync
            // function ties a subscription event to a gitshow user
            // without a second lookup.
            getCustomerParams: (user) => ({
              metadata: { userId: (user as { id: string }).id },
            }),
            use: [
              checkout({
                products: checkoutProducts,
                // Customer lands here after a successful checkout.
                // /app reads the subscription table and flips to the
                // Pro dashboard.
                successUrl: "/app?checkout=success",
                authenticatedUsersOnly: true,
              }),
              portal(),
              webhooks({
                webhookKey: env.DODO_PAYMENTS_WEBHOOK_SECRET ?? "missing",
                // Single sync function fans out to the D1 mirror.
                // Dedicated `onSubscription*` callbacks below handle
                // the specific state transitions on top of the sync.
                onPayload: async (payload) => {
                  await syncSubscriptionFromWebhook(env.DB, payload);
                },
              }),
            ],
          }) as unknown as BetterAuthPlugin,
        ],
        socialProviders: {
          github: {
            clientId: env.AUTH_GITHUB_ID,
            clientSecret: env.AUTH_GITHUB_SECRET,
            // Scope rationale:
            //   repo       → private repos the user owns + collaborator + org-
            //                member access under /user/repos (visibility=all).
            //   read:org   → enumerate private org memberships so we can
            //                detect org-level locked state and surface it in
            //                the UI (see github-fetcher.probeOrgAccess).
            //   read:user  → unlocks contributionsCollection private-detail
            //                (respects the user's "Include private
            //                contributions on my profile" setting).
            //   user:email → verified emails used by commit-search to find
            //                drive-by contributions to third-party repos.
            scope: ["read:user", "user:email", "repo", "read:org"],
            mapProfileToUser(profile) {
              return {
                login: typeof profile.login === "string" ? profile.login : null,
              };
            },
          },
        },
        account: {
          // Auto-link GitHub re-signs-in to the existing `users` row
          // by matching verified email. Keeps scans + profiles tied
          // to the same user_id across the auth rewrite.
          accountLinking: {
            enabled: true,
            trustedProviders: ["github"],
          },
        },
        user: {
          modelName: "users",
          additionalFields: {
            // GitHub username (e.g. "yatendra2001"). Backfilled from
            // the OAuth profile via `mapProfileToUser` above; read in
            // the /app header + used as the default profile handle.
            login: {
              type: "string",
              required: false,
              input: false,
            },
          },
        },
        session: {
          expiresIn: 60 * 60 * 24 * 30, // 30 days
          updateAge: 60 * 60 * 24, // refresh the row at most daily
          cookieCache: {
            enabled: true,
            maxAge: 60 * 5, // 5 min in-memory cache on the server
          },
        },
        advanced: {
          // Prefix every auth cookie with "gitshow." so we can't
          // collide with any future first-party cookies.
          cookiePrefix: "gitshow",
        },
      },
    ),
  );
}

/**
 * Shape of the server-side session. Better Auth's `auth.api.getSession`
 * typing doesn't propagate `additionalFields.login` (the GithubProfile
 * mapping happens at runtime, not in the inferred types), so we widen
 * the user here. Keep in sync with `additionalFields` in buildAuth()
 * and `types/better-auth.d.ts`.
 */
export interface AppSession {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string | null;
    login?: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}

/**
 * Convenience: read the current session on the server. Returns
 * `{ user, session } | null`. All authenticated API routes go
 * through this — no cookie parsing sprinkled around the codebase.
 *
 * Wrapped in `React.cache` so layout + page + pro-gate (each
 * independently calling `getSession()` during the same request)
 * share one Better-Auth lookup. Better Auth has its own 5-min
 * in-memory cookie cache, but the `headers()` parse + plugin
 * pipeline still costs ~1-3ms per call — multiplied across the
 * dashboard request graph, that adds up.
 */
export const getSession = cache(
  async (): Promise<AppSession | null> => {
    const auth = await initAuth();
    const raw = await auth.api.getSession({ headers: await headers() });
    return (raw as AppSession | null) ?? null;
  },
);
