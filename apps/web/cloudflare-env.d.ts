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

    // Vars from wrangler.jsonc:
    NEXT_PUBLIC_APP_URL?: string;
    DEMO_HANDLE?: string;
  }
}
