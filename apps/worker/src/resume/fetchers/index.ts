/**
 * Fetcher registry — re-exports every run* function so the pipeline can
 * compose them from one import.
 *
 * Each fetcher:
 *   - Takes a shared `FetcherInput` shape (session, usage, trace,
 *     onProgress). Some fetchers extend it (linkedin-pdf adds pdfText;
 *     semantic-scholar + arxiv add personName).
 *   - Emits `TypedFact[]`.
 *   - Wraps its body in try/catch; on error returns [] and records a
 *     `fetcher.error` trace event. Never throws.
 *
 * The merger fuses facts from all fetchers into one KnowledgeGraph.
 */

export {
  runLinkedInPublicFetcher,
  LOGIN_WALL_PATTERN,
  LOGIN_WALL_TITLES,
  MIN_TEXT_CHARS,
  isUsable,
  buildFacts as buildLinkedInFacts,
  emitFactsToTrace,
  LinkedInExtractionSchema,
} from "./linkedin-public.js";

export { runLinkedInPlaywrightFetcher } from "./linkedin-playwright.js";
export { runLinkedInPdfFetcher } from "./linkedin-pdf.js";
export { runPersonalSiteFetcher } from "./personal-site.js";
export { runTwitterBioFetcher } from "./twitter-bio.js";
export { runHnProfileFetcher } from "./hn-profile.js";
export { runDevtoProfileFetcher } from "./devto-profile.js";
export { runMediumProfileFetcher } from "./medium-profile.js";
export { runOrcidFetcher } from "./orcid.js";
export { runSemanticScholarFetcher } from "./semantic-scholar.js";
export { runArxivFetcher } from "./arxiv.js";
export { runStackoverflowFetcher } from "./stackoverflow.js";
export { emitGithubFacts } from "./github-facts.js";
