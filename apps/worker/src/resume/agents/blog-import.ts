/**
 * blog-import agent — imports up to 5 user-provided blog URLs into the
 * Resume's `blog[]` array.
 *
 * Flow per URL:
 *   1. Fetch via Jina Reader (`https://r.jina.ai/<url>`). Jina handles
 *      Medium / dev.to / Hashnode / Substack / personal blogs, returning
 *      clean markdown with frontmatter-ish metadata headers.
 *   2. LLM call (Sonnet, low effort) extracts: title, summary (1-2
 *      sentences), publishedAt (ISO date), slug (kebab-case), body
 *      (verbatim markdown, whitespace-normalised).
 *   3. Body is NOT rewritten — the value is faithful preservation of the
 *      author's voice. The LLM strips site chrome (nav, footer, "you
 *      might also like" blocks) but leaves prose untouched.
 *   4. Source URL + platform are preserved for the canonical link at
 *      `/{handle}/blog/{slug}`.
 *
 * Parallel, bounded by `p-limit` so 5 URLs don't blow the OpenRouter
 * concurrent-session ceiling. Failures are logged and skipped — one
 * bad blog URL doesn't fail the scan.
 */

import * as z from "zod/v4";
import pLimit from "p-limit";
import { runAgentWithSubmit, type AgentEventEmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { BlogPost } from "@gitshow/shared/resume";
import { withTimeout, TimeoutError } from "../../util/timeout.js";

const BLOG_IMPORT_CONCURRENCY = 3;
const JINA_TIMEOUT_MS = 45_000;
const JINA_MAX_BYTES = 40_000;
/**
 * Hard wall-clock cap per URL: Jina (45s) + LLM call (90s) + retries.
 * If we can't extract a post in this window we drop the URL and move
 * on — one bad blog must NOT block the rest of the pipeline.
 */
const PER_URL_BUDGET_MS = 3 * 60_000;
/** OpenRouter HTTP timeout for the extractor. Kimi handles a typical
 * post in ~30s; 90s is a generous ceiling so a single slow call still
 * fails fast enough that retries (3×) stay inside PER_URL_BUDGET_MS. */
const LLM_HTTP_TIMEOUT_MS = 90_000;

export const BlogPostLLMSchema = z.object({
  slug: z
    .string()
    .max(120)
    .regex(/^[a-z0-9-]+$/, "slug must be kebab-case ASCII"),
  title: z.string().max(200),
  summary: z.string().max(400),
  publishedAt: z
    .string()
    .describe("ISO date. 'YYYY-MM-DD' minimum; full ISO preferred."),
  /**
   * Verbatim markdown of the post body. The agent should preserve the
   * author's prose unchanged and only strip site chrome (nav, share
   * buttons, recommended-reads, footer).
   */
  body: z.string(),
});
export type BlogPostLLM = z.infer<typeof BlogPostLLMSchema>;

export interface BlogImportAgentInput {
  session: ScanSession;
  usage: SessionUsage;
  /** URLs the user entered during intake. Up to 5 honoured. */
  urls: string[];
  onProgress?: (text: string) => void;
  /** Optional structured emit (reasoning + tool events). */
  emit?: AgentEventEmit;
}

const SYSTEM_PROMPT = `You extract one blog post from a fetched web page into structured JSON.

You'll receive the full Jina Reader output for a single URL — usually Markdown with some metadata at the top (title, author, site, date) followed by the article body, followed by noise like "more from this author" and a footer.

Produce submit_blog_post with:
  - slug: a kebab-case ASCII slug derived from the title (e.g. "how-we-built-the-gitshow-pipeline"). Max 120 chars.
  - title: the article's title. Plain text, no Markdown.
  - summary: a 1-2 sentence factual summary of what the post argues or describes. Do not add marketing voice — if the post is terse, your summary is terse.
  - publishedAt: ISO date. Use the page's stated publish date. If only a year is available, use "YYYY-01-01". If no date is given anywhere, use today's date (treat as last resort).
  - body: VERBATIM MARKDOWN of the article content. Strip:
      * nav / header / share / clap / recommended-reads / footer chrome
      * "By <Author>" bylines that don't belong in the body
      * platform-specific callouts ("Get the app", "Sign in to read more")
    Preserve:
      * headings, code blocks, lists, images, block quotes
      * links within the post
      * emphasis / bold
      * the author's exact wording
    Do NOT rewrite, paraphrase, or compress. If the post is 3000 words, the body is 3000 words.

If the Jina output looks like a login wall or an empty page (< 300 words of real content), still submit with your best-effort slug + title and a short summary saying "preview only — visit the source for full post".

Call submit_blog_post exactly once.`;

export async function runBlogImportAgent(
  input: BlogImportAgentInput,
): Promise<BlogPost[]> {
  const log = input.onProgress ?? (() => {});
  const urls = input.urls.slice(0, 5);
  if (urls.length === 0) {
    log(`\n[blog-import] no URLs provided — skipping.\n`);
    return [];
  }

  log(`\n[blog-import] importing ${urls.length} URL(s)\n`);
  const limit = pLimit(BLOG_IMPORT_CONCURRENCY);
  const imported = await Promise.all(
    urls.map((url) =>
      limit(async () => {
        try {
          return await withTimeout(
            importOne({
              url,
              session: input.session,
              usage: input.usage,
              log,
              emit: input.emit,
            }),
            PER_URL_BUDGET_MS,
            `blog-import:${url}`,
          );
        } catch (err) {
          if (err instanceof TimeoutError) {
            log(
              `[blog-import] ${url} — timed out after ${PER_URL_BUDGET_MS / 1000}s; skipping\n`,
            );
            return null;
          }
          log(
            `[blog-import] ${url} — unexpected error: ${(err as Error).message.slice(0, 120)}\n`,
          );
          return null;
        }
      }),
    ),
  );
  return imported.filter((p): p is BlogPost => !!p);
}

async function importOne(args: {
  url: string;
  session: ScanSession;
  usage: SessionUsage;
  log: (text: string) => void;
  emit?: AgentEventEmit;
}): Promise<BlogPost | null> {
  const { url, session, usage, log, emit } = args;
  log(`[blog-import] → ${url}\n`);

  const fetched = await fetchJinaReader(url);
  if (!fetched) {
    log(`[blog-import] ${url} — fetch failed; skipping\n`);
    return null;
  }

  try {
    const { result } = await runAgentWithSubmit({
      model: modelForRole("bulk"),
      systemPrompt: SYSTEM_PROMPT,
      input: buildInput(url, fetched),
      submitToolName: "submit_blog_post",
      submitToolDescription:
        "Submit the extracted blog post. Call exactly once.",
      submitSchema: BlogPostLLMSchema,
      reasoning: { effort: "low" },
      timeoutMs: LLM_HTTP_TIMEOUT_MS,
      session,
      usage,
      label: `resume:blog-import`,
      onProgress: log,
      emit,
    });

    return {
      slug: result.slug,
      title: result.title,
      summary: result.summary,
      publishedAt: result.publishedAt,
      sourceUrl: url,
      sourcePlatform: detectPlatform(url),
      body: result.body,
    };
  } catch (err) {
    log(`[blog-import] ${url} — agent failed: ${(err as Error).message.slice(0, 120)}\n`);
    return null;
  }
}

async function fetchJinaReader(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      redirect: "follow",
      headers: {
        Accept: "text/plain",
        "User-Agent": "GitShow/0.2 (+https://github.com/yatendrakumar/gitshow)",
      },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, JINA_MAX_BYTES);
  } catch {
    return null;
  }
}

function buildInput(url: string, content: string): string {
  return `## Source URL\n${url}\n\n## Jina Reader output\n\n${content}\n\n---\nExtract the post. Preserve body markdown verbatim (minus site chrome). Call submit_blog_post.`;
}

function detectPlatform(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("medium.com")) return "Medium";
    if (host.includes("dev.to")) return "dev.to";
    if (host.includes("hashnode.com") || host.includes("hashnode.dev")) return "Hashnode";
    if (host.includes("substack.com")) return "Substack";
    if (host.includes("ghost.io")) return "Ghost";
    return undefined;
  } catch {
    return undefined;
  }
}
