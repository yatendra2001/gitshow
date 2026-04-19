/**
 * `@gitshow/shared` — the single source of truth for types and clients
 * shared between the Fly worker (Node) and the Next.js web app (Cloudflare
 * Workers).
 *
 * Subpath exports (preferred):
 *   - `@gitshow/shared/schemas`
 *   - `@gitshow/shared/events`
 *   - `@gitshow/shared/eta`
 *   - `@gitshow/shared/util`
 *   - `@gitshow/shared/cloud/d1`
 *   - `@gitshow/shared/cloud/r2`
 *   - `@gitshow/shared/cloud/fly`
 *   - `@gitshow/shared/cloud/do-client`
 *
 * The root export re-exports lightweight modules only. Cloud clients pull
 * in aws-sdk / S3 and are deliberately NOT re-exported here to avoid
 * bloating the Worker bundle when someone only needs `type Profile`.
 */
export * from "./schemas";
export * from "./events";
export * from "./eta";
export * from "./util";
