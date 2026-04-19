/**
 * Thin re-export wrapper. The canonical schema definitions now live in
 * `packages/shared/src/schemas.ts` so the Next.js web app and the Fly
 * worker share one type source. This file exists only to keep the
 * existing `./schemas.js` imports across the pipeline working unchanged.
 */
export * from "@gitshow/shared/schemas";
