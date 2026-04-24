/**
 * Public surface for the media pipeline. Callers (pipeline.ts) import
 * only the top-level entrypoint; the other modules stay internal but
 * are re-exported here for tests + audit scripts.
 */

export { resizeToWebP } from "./image-resize.js";
export {
  extractOgImage,
  extractReadmeHeroImages,
  extractYouTubeThumbnail,
} from "./og-image.js";
export {
  clearbitLogoUrl,
  googleFaviconUrl,
  downloadFirstAvailable,
} from "./clearbit.js";
export { generateProjectBanner } from "./banner-gen.js";
export type { BannerGenInput, BannerGenResult } from "./banner-gen.js";
export { fetchMediaForKG } from "./media-fetch.js";
export type { MediaFetchOptions } from "./media-fetch.js";
