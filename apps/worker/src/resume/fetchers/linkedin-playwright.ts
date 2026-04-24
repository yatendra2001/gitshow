/**
 * linkedin-playwright fetcher — Tier 3.
 *
 * Launches headless Chromium with a Googlebot User-Agent. LinkedIn serves
 * a richer version of public profiles to search engines for SEO, so this
 * tier is the most reliable non-PDF source (~70% of public profiles).
 *
 * Runs only on Fly (Chromium is too heavy for CLI dev). If the
 * `playwright` package isn't installed, the dynamic import fails and we
 * return [] silently — making the whole worker typecheck locally without
 * a hard dep.
 */

import * as z from "zod/v4";
import {
  LinkedInExtractionSchema,
  buildFacts,
  emitFactsToTrace,
  LOGIN_WALL_TITLES,
  isUsable,
} from "./linkedin-public.js";
import { runAgentWithSubmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import type { TypedFact } from "@gitshow/shared/kg";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";

export interface FetcherInput {
  session: ScanSession;
  usage: SessionUsage;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
}

const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const NAV_TIMEOUT_MS = 20_000;
const SELECTOR_TIMEOUT_MS = 5_000;
const OVERALL_BUDGET_MS = 60_000;

const SYSTEM_PROMPT = `You extract a LinkedIn profile's structured data from rendered page text.
Return typed JSON with positions (experience), educations, skills, bio, location.

Rules:
- Extract ONLY facts stated in the text. Never invent a company.
- For "present" positions, set present=true and leave end empty.
- Skip nav/footer/sign-in chrome.
- Dates: preserve "May 2021", "2020 - Present" verbatim.

Call submit_linkedin_extraction exactly once.`;

export async function runLinkedInPlaywrightFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const label = "linkedin-playwright";
  const t0 = Date.now();
  const url = input.session.socials.linkedin;
  const log = input.onProgress ?? (() => {});
  const trace = input.trace;

  trace?.fetcherStart({ label, input: { url, hasUrl: !!url } });
  if (!url) {
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  // Dynamic import so the worker typechecks without playwright installed.
  let chromium: unknown = null;
  try {
    const pw = (await import("playwright")) as {
      chromium?: unknown;
    };
    chromium = pw.chromium ?? null;
  } catch {
    log(`[${label}] playwright not installed — skipping.\n`);
    trace?.linkedInTierAttempt({
      tier: 3,
      method: "playwright",
      ok: false,
      durationMs: Date.now() - t0,
      reason: "playwright-not-installed",
    });
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  if (!chromium) {
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  // Casting: playwright's type narrows happen inside the try so we do
  // them locally to avoid leaking types across the optional dep boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromiumAny = chromium as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;

  try {
    browser = await chromiumAny.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: GOOGLEBOT_UA,
      extraHTTPHeaders: { "X-Robots-Tag": "noindex" },
    });
    const page = await context.newPage();

    const fetchPromise = (async () => {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      // If LinkedIn redirected to /authwall, it's a wall.
      const finalUrl: string = page.url();
      if (/\/authwall/i.test(finalUrl)) {
        return { walled: true as const, reason: "authwall-redirect" };
      }

      // Wait for profile content selectors. If neither present, check
      // the title for known wall strings.
      let selectorOk = false;
      try {
        await Promise.race([
          page.waitForSelector(".pv-top-card", { timeout: SELECTOR_TIMEOUT_MS }),
          page.waitForSelector('[data-section="experience"]', {
            timeout: SELECTOR_TIMEOUT_MS,
          }),
        ]);
        selectorOk = true;
      } catch {
        // fall through; check title
      }

      const title: string = await page.title();
      if (!selectorOk) {
        if (title && LOGIN_WALL_TITLES.test(title.trim())) {
          return { walled: true as const, reason: `wall-title:${title}` };
        }
      }

      // `document` is Playwright's page context, not Node's — we cast to
      // any so this file typechecks without the dom lib configured.
      const innerText: string = await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => ((globalThis as any).document?.body?.innerText ?? "") as string,
      );
      if (!isUsable(innerText, title)) {
        return { walled: true as const, reason: "thin-or-walled-body" };
      }

      return { walled: false as const, text: innerText };
    })();

    const result = await Promise.race([
      fetchPromise,
      new Promise<{ walled: true; reason: string }>((resolve) =>
        setTimeout(
          () => resolve({ walled: true, reason: "overall-budget-exceeded" }),
          OVERALL_BUDGET_MS,
        ),
      ),
    ]);

    if (result.walled) {
      trace?.linkedInTierAttempt({
        tier: 3,
        method: "playwright",
        ok: false,
        durationMs: Date.now() - t0,
        reason: result.reason,
      });
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    trace?.linkedInTierAttempt({
      tier: 3,
      method: "playwright",
      ok: true,
      durationMs: Date.now() - t0,
    });

    // Extract
    const { result: extraction } = await runAgentWithSubmit({
      model: modelForRole("bulk"),
      systemPrompt: SYSTEM_PROMPT,
      input: `## Source URL\n${url}\n\n## Rendered text\n\n${result.text.slice(0, 40_000)}\n\n---\nExtract positions, educations, skills, bio, location. Call submit_linkedin_extraction.`,
      submitToolName: "submit_linkedin_extraction",
      submitToolDescription:
        "Submit the extracted LinkedIn profile data. Call exactly once.",
      submitSchema: LinkedInExtractionSchema,
      reasoning: { effort: "low" },
      session: input.session,
      usage: input.usage,
      label: "fetcher:linkedin-playwright",
      onProgress: log,
      trace,
    });

    const facts = buildFacts({
      extraction,
      url,
      label: "linkedin-playwright",
      confidence: "medium",
    });

    trace?.linkedInFactsEmitted({
      tier: 3,
      positions: extraction.positions.length,
      educations: extraction.educations.length,
      skills: extraction.skills.length,
    });
    emitFactsToTrace(trace, label, facts);

    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: facts.length,
      status: facts.length > 0 ? "ok" : "empty",
    });
    return facts;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[${label}] error: ${msg}\n`);
    trace?.fetcherError({
      label,
      error: msg,
      stack: err instanceof Error ? err.stack : undefined,
      retryable: false,
    });
    trace?.linkedInTierAttempt({
      tier: 3,
      method: "playwright",
      ok: false,
      durationMs: Date.now() - t0,
      reason: `threw: ${msg}`,
    });
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "error",
    });
    return [];
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}

// Keep z around so the import isn't pruned if the extraction schema
// grows. (Schema re-exported from linkedin-public.)
void z;
