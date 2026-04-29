/**
 * Cloudflare environment bindings — hand-written augmentation that
 * mirrors `wrangler.jsonc`. Replace this file with the generated
 * version once linked to a live Cloudflare account:
 *
 *   bun run cf-typegen
 *
 * The `export {}` makes this a module so `declare global` augments
 * the ambient `CloudflareEnv` interface that `@cloudflare/workers-types`
 * defines as empty. Without `declare global`, TS treats it as a
 * sibling interface in this file's scope and CI Linux refuses to
 * merge — that's exactly what blew up on PR #2.
 */
export {};

declare global {
  // biome-ignore lint: augment the global CloudflareEnv from @cloudflare/workers-types
  interface CloudflareEnv {
    ASSETS: Fetcher;
    DB: D1Database;
    BUCKET: R2Bucket;
    SESSIONS?: KVNamespace;
    SCAN_LIVE_DO: DurableObjectNamespace;
    /**
     * Cloudflare Browser Rendering binding (headless Chromium). Wired
     * via the `[browser]` block in wrangler.jsonc and consumed by
     * `/api/resume/doc/pdf`. Optional so local dev (no binding) doesn't
     * blow up imports — the route handles the missing case.
     */
    BROWSER?: Fetcher;

    // Bound via `wrangler secret put`:
    AUTH_SECRET?: string;
    AUTH_GITHUB_ID?: string;
    AUTH_GITHUB_SECRET?: string;
    FLY_API_TOKEN?: string;
    FLY_APP_NAME?: string;
    FLY_REGION?: string;
    PIPELINE_SHARED_SECRET?: string;
    REALTIME_ENDPOINT?: string;
    GH_TOKEN?: string;
    OPENROUTER_API_KEY?: string;
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
    D1_DATABASE_ID?: string;
    R2_BUCKET_NAME?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;

    // Notification delivery (email + desktop push). Missing keys =
    // silent no-op, never a crash.
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;

    // Web scraping + search for the LinkedIn fetcher + DevEvidence
    // research phase. Pipeline falls back gracefully when missing.
    TINYFISH_API_KEY?: string;

    // ── Custom domains ────────────────────────────────────────────
    // Cloudflare for SaaS — scoped to a SINGLE zone, permission
    // `Custom Hostnames:Edit` only. If this leaks the blast radius
    // is "attacker can register hostnames on our zone" — they can't
    // pivot to other zones or modify code.
    CF_FOR_SAAS_ZONE_ID?: string;
    CF_FOR_SAAS_API_TOKEN?: string;
    // Shared secret for the daily re-resolution cron endpoint.
    CRON_SECRET?: string;

    // Billing (Dodo Payments). The Better Auth Dodo plugin reads API
    // key + webhook secret; product ids are consumed by lib/dodo.ts to
    // map slugs ('pro-monthly' / 'pro-yearly') → Dodo product ids.
    DODO_PAYMENTS_API_KEY?: string;
    DODO_PAYMENTS_WEBHOOK_SECRET?: string;
    DODO_PAYMENTS_ENVIRONMENT?: "test_mode" | "live_mode";
    DODO_PRODUCT_ID_MONTHLY?: string;
    DODO_PRODUCT_ID_YEARLY?: string;

    // Vars from wrangler.jsonc:
    NEXT_PUBLIC_APP_URL?: string;
    PUBLIC_APP_URL?: string;
    DEMO_HANDLE?: string;
  }
}
