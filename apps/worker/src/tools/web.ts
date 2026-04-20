/**
 * Web tools for workers — browse_web, search_web, search_github, query_artifacts.
 *
 * Every tool:
 *  - returns plain text the LLM can reason about
 *  - writes any fetched external content into the shared artifact store as
 *    a `web` artifact with a stable id (workers reference these in claims)
 *  - caches results on disk under `profiles/<handle>/web-cache/` so repeat
 *    calls across workers don't hammer origins
 *  - respects a per-scan budget via SessionUsage
 *
 * Philosophy (from the Manus-lead Reddit post): presentation layer ≠
 * execution layer. The LLM sees a clean, trimmed, metadata-stamped string;
 * the raw bytes stay on disk, discoverable via the returned cache path.
 */

import { tool } from "@openrouter/agent";
import * as z from "zod/v4";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Artifact, ScanSession } from "../schemas.js";
import type { SessionUsage } from "../session.js";
import { webArtifactId } from "../normalize.js";
import { createCodeTools } from "./code.js";
import { createFetchPrReviewsTool } from "./reviews.js";

const execFileAsync = promisify(execFile);

// ──────────────────────────────────────────────────────────────
// Shared context passed to tools
// ──────────────────────────────────────────────────────────────

/**
 * Tools write discovered artifacts into this sink so the orchestrator
 * can merge them into the global artifact table.
 */
export interface ToolContext {
  session: ScanSession;
  usage: SessionUsage;
  /** Artifact sink — tools push new `web` artifacts here. */
  artifactSink: Record<string, Artifact>;
  /** Existing artifact table (read-only for `query_artifacts`). */
  artifacts: Record<string, Artifact>;
  /**
   * Profile-level directory, e.g. `profiles/<handle>/`. Tools choose
   * subdirs inside it:
   *   web tools → `<profileDir>/web-cache/`
   *   code tools → `<profileDir>/repos/`
   */
  profileDir: string;
  /**
   * Per-agent soft budget for web calls. `Infinity` = unlimited.
   * Counter is still tracked for reporting.
   */
  webBudget: number;
  /** Per-agent soft budget for github-search calls. `Infinity` = unlimited. */
  githubSearchBudget: number;
  /** Progress logger. */
  log: (text: string) => void;
}

// ──────────────────────────────────────────────────────────────
// Budget tracking (per-tool-instance)
// ──────────────────────────────────────────────────────────────

interface ToolCounters {
  web: number;
  github: number;
}

// ──────────────────────────────────────────────────────────────
// browse_web — fetch a URL and return readable text
// ──────────────────────────────────────────────────────────────

const BROWSE_SCHEMA = z.object({
  url: z.string().describe("Absolute URL to fetch (https:// preferred)"),
  reason: z
    .string()
    .max(200)
    .describe("One sentence: why are you fetching this URL?"),
});

export function createBrowseTool(ctx: ToolContext, counters: ToolCounters) {
  return tool({
    name: "browse_web",
    description:
      "Fetch the text content of a specific URL. Use when you need to verify a " +
      "fact or enrich a specific source (the dev's personal site home page, a " +
      "LinkedIn URL, a specific blog post, a conference talk page). Returns " +
      "readable text + stores the artifact under a stable id you MUST cite in " +
      "any claim drawn from it. Budget-limited per worker.",
    inputSchema: BROWSE_SCHEMA,
    execute: async (input) => {
      if (counters.web >= ctx.webBudget) {
        return `[error] web budget exceeded (${ctx.webBudget} calls). Use the artifacts you've already gathered.`;
      }
      counters.web += 1;
      ctx.usage.recordWebCall();
      ctx.log(`[web] browse ${input.url} (${input.reason})\n`);
      return await browseWeb(input.url, ctx);
    },
  });
}

async function browseWeb(url: string, ctx: ToolContext): Promise<string> {
  const webCacheDir = join(ctx.profileDir, "web-cache");
  await mkdir(webCacheDir, { recursive: true });
  const id = webArtifactId(url);
  const cachePath = join(webCacheDir, `${id}.txt`);

  // Short-circuit on cache
  if (existsSync(cachePath)) {
    const cached = await readFile(cachePath, "utf-8");
    ensureSinkArtifact(ctx, id, url, cached);
    return formatBrowseResult(url, cached, { cached: true });
  }

  // Jina Reader is the default: it renders JS, strips chrome, returns
  // clean markdown, and gets past most bot-protection that blocks a
  // raw fetch (LinkedIn public pages, Cloudflare-fronted blogs, SPA
  // sites). Direct is the fallback for the rare case Jina rate-limits
  // or is down — it also covers static sites where Jina adds latency
  // without winning on quality.
  const jina = await fetchJina(url);
  if (jina.kind === "ok") {
    const trimmed = jina.text.slice(0, 40_000);
    await writeFile(cachePath, trimmed, "utf-8");
    ensureSinkArtifact(ctx, id, url, trimmed);
    return formatBrowseResult(url, trimmed, { cached: false });
  }

  const direct = await fetchDirect(url);
  if (direct.kind === "ok") {
    const trimmed = direct.text.slice(0, 40_000);
    await writeFile(cachePath, trimmed, "utf-8");
    ensureSinkArtifact(ctx, id, url, trimmed);
    ctx.log(`[web] direct-fetch rescued ${url} (jina: ${jina.reason})\n`);
    return formatBrowseResult(url, trimmed, { cached: false });
  }

  return `[error] failed to fetch ${url}: jina=${jina.reason}; direct=${direct.reason}. Skip or try a different URL.`;
}

type FetchOutcome =
  | { kind: "ok"; text: string }
  | { kind: "err"; reason: string };

async function fetchDirect(url: string): Promise<FetchOutcome> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "GitShow/0.2 (+https://github.com/yatendrakumar/gitshow)",
        Accept:
          "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { kind: "err", reason: `HTTP ${res.status}` };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      return { kind: "ok", text: JSON.stringify(json, null, 2) };
    }
    const html = await res.text();
    return { kind: "ok", text: htmlToText(html) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "err", reason: msg.slice(0, 120) };
  }
}

/**
 * Jina Reader — free anonymous endpoint that fetches a URL, renders JS
 * if needed, and returns clean markdown. Handles most bot-protected
 * sites (LinkedIn public pages, Cloudflare-fronted blogs) that refuse
 * our direct fetch. No API key; rate-limited, which is fine for our
 * per-worker budgets.
 *
 * Docs: https://jina.ai/reader
 */
async function fetchJina(url: string): Promise<FetchOutcome> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      redirect: "follow",
      headers: {
        Accept: "text/plain",
        "User-Agent": "GitShow/0.2 (+https://github.com/yatendrakumar/gitshow)",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { kind: "err", reason: `HTTP ${res.status}` };
    const text = await res.text();
    if (!text.trim()) return { kind: "err", reason: "empty body" };
    return { kind: "ok", text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "err", reason: msg.slice(0, 120) };
  }
}

function ensureSinkArtifact(
  ctx: ToolContext,
  id: string,
  url: string,
  text: string,
): void {
  if (ctx.artifactSink[id] || ctx.artifacts[id]) return;
  const firstLine = text.split("\n").find((l) => l.trim()) ?? url;
  ctx.artifactSink[id] = {
    id,
    type: "web",
    source_url: url,
    title: firstLine.slice(0, 200),
    excerpt: text.slice(0, 2000),
    metadata: { cached_bytes: text.length },
    recorded_at: new Date().toISOString(),
  };
}

function formatBrowseResult(
  url: string,
  text: string,
  meta: { cached: boolean },
): string {
  const id = webArtifactId(url);
  const slice = text.slice(0, 8_000);
  const truncated = text.length > slice.length;
  const header = `artifact_id: ${id}\nurl: ${url}\n${meta.cached ? "cached: true\n" : ""}`;
  const foot = truncated
    ? `\n\n--- truncated (${text.length.toLocaleString()} chars total) ---\nCite [${id}] in any claim drawn from this content.`
    : `\nCite [${id}] in any claim drawn from this content.`;
  return `${header}\n${slice}${foot}`;
}

/**
 * Minimal HTML→text — no deps. Strips scripts/styles, collapses whitespace.
 */
export function htmlToText(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const decoded = noScript
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

// ──────────────────────────────────────────────────────────────
// search_web — DuckDuckGo HTML search (no API key required)
// ──────────────────────────────────────────────────────────────

const SEARCH_SCHEMA = z.object({
  query: z.string().describe("Search query — be specific (include the handle, org, or project)"),
  reason: z.string().max(200).describe("One sentence: what are you looking for?"),
});

export function createSearchTool(ctx: ToolContext, counters: ToolCounters) {
  return tool({
    name: "search_web",
    description:
      "Search the web and return the top 5 results as title+url+snippet. Use to find " +
      "mentions of the developer beyond the profile links you already have — hackathons, " +
      "conference talks, blog posts written about them, social media threads. NOT for general " +
      "info lookup. Budget-limited per worker.",
    inputSchema: SEARCH_SCHEMA,
    execute: async (input) => {
      if (counters.web >= ctx.webBudget) {
        return `[error] web budget exceeded (${ctx.webBudget} calls). Work with what you have.`;
      }
      counters.web += 1;
      ctx.usage.recordWebCall();
      ctx.log(`[web] search "${input.query}" (${input.reason})\n`);
      return await searchWeb(input.query);
    },
  });
}

async function searchWeb(query: string): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return `[error] search returned HTTP ${res.status}`;
    const html = await res.text();
    const results = parseDuckDuckGo(html).slice(0, 5);
    if (results.length === 0) {
      return `[info] no results for "${query}". Try different keywords.`;
    }
    return results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[error] search failed: ${msg.slice(0, 200)}`;
  }
}

function parseDuckDuckGo(html: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = resultRegex.exec(html)) !== null && results.length < 10) {
    const rawUrl = m[1];
    const title = stripTags(m[2]).trim();
    const snippet = stripTags(m[3]).trim();
    const url = cleanDuckRedirect(rawUrl);
    if (title && url) results.push({ title, url, snippet });
  }
  return results;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDuckRedirect(rawUrl: string): string {
  // DuckDuckGo wraps results in `//duckduckgo.com/l/?uddg=<encoded>`
  const m = /[?&]uddg=([^&]+)/.exec(rawUrl);
  if (m) return decodeURIComponent(m[1]);
  if (rawUrl.startsWith("//")) return `https:${rawUrl}`;
  return rawUrl;
}

// ──────────────────────────────────────────────────────────────
// search_github — cross-org PR/issue/commit search via gh CLI
// ──────────────────────────────────────────────────────────────

const GITHUB_SCHEMA = z.object({
  query: z
    .string()
    .describe(
      "GitHub search syntax. Examples:\n" +
      "  'author:@HANDLE is:pr is:merged' — PRs merged by the user across all repos\n" +
      "  'author:@HANDLE org:<org-name> is:pr' — PRs in a specific org\n" +
      "  'author:@HANDLE is:issue' — issues filed by the user\n" +
      "The orchestrator replaces @HANDLE with the actual GitHub handle automatically.",
    ),
  kind: z.enum(["prs", "issues", "commits"]).default("prs"),
  reason: z.string().max(200),
});

export function createGithubSearchTool(
  ctx: ToolContext,
  counters: ToolCounters,
  handle: string,
) {
  return tool({
    name: "search_github",
    description:
      "Search GitHub for PRs, issues, or commits by this developer across all public " +
      "repos. Use to find external contributions that aren't in the pre-fetched data " +
      "(merged PRs to orgs you don't own). Always include `author:@HANDLE` in the query. " +
      "Budget-limited per worker.",
    inputSchema: GITHUB_SCHEMA,
    execute: async (input) => {
      if (counters.github >= ctx.githubSearchBudget) {
        return `[error] github-search budget exceeded (${ctx.githubSearchBudget} calls).`;
      }
      counters.github += 1;
      ctx.usage.recordGithubSearchCall();
      const resolved = input.query.replace(/@HANDLE/g, handle);
      ctx.log(`[gh] search "${resolved}" (${input.reason})\n`);
      return await searchGithub(resolved, input.kind, ctx);
    },
  });
}

async function searchGithub(
  query: string,
  kind: "prs" | "issues" | "commits",
  ctx: ToolContext,
): Promise<string> {
  // gh search accepts the query minus the `is:pr`/`is:issue` for some subcommands
  const cleanedQuery = query
    .replace(/\bis:pr\b/g, "")
    .replace(/\bis:issue\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Determine which subcommand
  const sub =
    kind === "commits" ? "commits" : kind === "issues" ? "issues" : "prs";

  const args = [
    "search",
    sub,
    ...cleanedQuery.split(" ").filter(Boolean),
    "--limit",
    "20",
    "--json",
    sub === "commits"
      ? "sha,repository,url,commit"
      : "repository,number,state,title,url,author,createdAt,closedAt,isPullRequest",
  ];

  try {
    const { stdout } = await execFileAsync("gh", args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });
    const parsed = JSON.parse(stdout) as unknown[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return `[info] no github results for "${query}".`;
    }

    // Convert each hit into an artifact + a compact text line
    const lines: string[] = [];
    for (const raw of parsed.slice(0, 20)) {
      const entry = raw as Record<string, unknown>;
      const repoObj = entry.repository as { nameWithOwner?: string } | undefined;
      const repoName = repoObj?.nameWithOwner ?? "?";
      if (sub === "commits") {
        const commitObj = entry.commit as
          | { message?: string; author?: { date?: string } }
          | undefined;
        const msg = (commitObj?.message ?? "").split("\n")[0];
        const sha = (entry.sha as string) ?? "?";
        const date = commitObj?.author?.date ?? "?";
        const id = `commit:${repoName}@${sha.slice(0, 7)}`;
        lines.push(`[${id}] ${repoName}@${sha.slice(0, 7)} ${date} "${msg.slice(0, 120)}"`);
        if (!ctx.artifactSink[id] && !ctx.artifacts[id]) {
          ctx.artifactSink[id] = {
            id,
            type: "commit",
            source_url: (entry.url as string) ?? `https://github.com/${repoName}/commit/${sha}`,
            title: msg.slice(0, 200),
            metadata: { repo: repoName, sha, short_sha: sha.slice(0, 7), date },
            recorded_at: new Date().toISOString(),
          };
        }
      } else {
        const num = entry.number as number;
        const state = entry.state as string;
        const title = (entry.title as string) ?? "";
        const url =
          (entry.url as string) ??
          `https://github.com/${repoName}/${sub === "prs" ? "pull" : "issues"}/${num}`;
        const created = entry.createdAt as string;
        const id = sub === "prs" ? `pr:${repoName}#${num}` : `issue:${repoName}#${num}`;
        lines.push(`[${id}] ${state} ${created} "${title.slice(0, 120)}"`);
        if (!ctx.artifactSink[id] && !ctx.artifacts[id]) {
          ctx.artifactSink[id] = {
            id,
            type: sub === "prs" ? "pr" : "issue",
            source_url: url,
            title,
            metadata: {
              repo: repoName,
              number: num,
              state,
              created_at: created,
              closed_at: entry.closedAt,
              is_external: true, // discovered via cross-org search
            },
            recorded_at: new Date().toISOString(),
          };
        }
      }
    }
    return lines.join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[error] gh search failed: ${msg.slice(0, 300)}`;
  }
}

// ──────────────────────────────────────────────────────────────
// query_artifacts — read-only filtered view for workers
// ──────────────────────────────────────────────────────────────

const QUERY_SCHEMA = z.object({
  type: z
    .enum(["commit", "pr", "repo", "release", "issue", "review", "web", "any"])
    .default("any"),
  repo: z.string().optional().describe("Filter to a specific repo fullName"),
  search: z
    .string()
    .optional()
    .describe("Case-insensitive substring match against title/excerpt"),
  external_only: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(25),
});

export function createQueryArtifactsTool(ctx: ToolContext) {
  return tool({
    name: "query_artifacts",
    description:
      "Query the pre-fetched artifact table (commits, PRs, repos, reviews) by type, " +
      "repo, text search, or external flag. Use this to inspect the raw evidence before " +
      "drafting claims. Always prefer this over asking the user — the data is right here.",
    inputSchema: QUERY_SCHEMA,
    execute: async (input) => {
      const matches: string[] = [];
      for (const [id, a] of Object.entries(ctx.artifacts)) {
        if (input.type !== "any" && a.type !== input.type) continue;
        const m = a.metadata as Record<string, unknown>;
        if (input.repo && m.repo !== input.repo && m.full_name !== input.repo) continue;
        if (input.external_only && !m.is_external) continue;
        if (input.search) {
          const q = input.search.toLowerCase();
          const hay = `${a.title} ${a.excerpt ?? ""}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        matches.push(id);
        if (matches.length >= input.limit) break;
      }
      if (matches.length === 0) return `[info] no artifacts match.`;
      // Lazy-require formatter to avoid circular import at module load
      const { formatArtifactForPrompt } = await import("../normalize.js");
      return matches
        .map((id) => formatArtifactForPrompt(ctx.artifacts[id]))
        .join("\n");
    },
  });
}

// ──────────────────────────────────────────────────────────────
// Convenience: build the standard tool set for a worker
// ──────────────────────────────────────────────────────────────

export interface WorkerToolsOptions {
  session: ScanSession;
  usage: SessionUsage;
  artifacts: Record<string, Artifact>;
  artifactSink: Record<string, Artifact>;
  /** Profile-level dir, e.g. `profiles/<handle>`. */
  profileDir: string;
  webBudget?: number;
  githubSearchBudget?: number;
  log?: (text: string) => void;
  handle: string;
  /** Include code-reading tools (list_tree, read_file, git_log, git_show). */
  includeCodeTools?: boolean;
}

/** Create the standard worker tool set sharing one budget counter. */
export function createWorkerTools(opts: WorkerToolsOptions) {
  const ctx: ToolContext = {
    session: opts.session,
    usage: opts.usage,
    artifacts: opts.artifacts,
    artifactSink: opts.artifactSink,
    profileDir: opts.profileDir,
    // Default: unlimited. Accuracy matters more than throttling.
    webBudget: opts.webBudget ?? Number.POSITIVE_INFINITY,
    githubSearchBudget: opts.githubSearchBudget ?? Number.POSITIVE_INFINITY,
    log: opts.log ?? (() => {}),
  };
  const counters: ToolCounters = { web: 0, github: 0 };
  const base = [
    createBrowseTool(ctx, counters),
    createSearchTool(ctx, counters),
    createGithubSearchTool(ctx, counters, opts.handle),
    createQueryArtifactsTool(ctx),
  ];
  if (opts.includeCodeTools) {
    return [...base, ...createCodeTools(ctx), createFetchPrReviewsTool(ctx)];
  }
  return base;
}
