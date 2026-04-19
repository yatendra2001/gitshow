import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext-Cloudflare configuration. MVP keeps this minimal — no
 * incremental cache / queue / tag cache yet. Our pages are mostly
 * dynamic (live scan views) or static-rendered-from-R2 (/p/[handle]),
 * so the default behavior is fine until we need revalidateTag.
 *
 * When we add ISR, uncomment the R2 incremental cache + DO queue + D1
 * tag cache block below.
 */
export default defineCloudflareConfig({
  // incrementalCache: r2IncrementalCache,
  // queue: doQueue,
  // tagCache: d1NextTagCache,
});
