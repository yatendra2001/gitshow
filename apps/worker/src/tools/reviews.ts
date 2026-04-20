/**
 * fetch_pr_reviews tool — pulls review body + inline comments from a PR,
 * filtered to comments authored by OTHER people (not the developer themselves).
 *
 * This is the external-voice signal: what teammates actually said about
 * this developer's work. Bot comments (dependabot, github-actions) are
 * dropped. Single-word approvals ("LGTM") are kept but rate-limited.
 */

import { tool } from "@openrouter/agent";
import * as z from "zod/v4";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolContext } from "./web.js";

const execFileAsync = promisify(execFile);

const FETCH_REVIEWS_SCHEMA = z.object({
  repo: z.string().describe("Full repo name, e.g. 'owner/name'"),
  pr_number: z.number().int().positive(),
  reason: z.string().max(200),
});

interface GhReview {
  id?: number;
  user?: { login?: string; type?: string };
  body?: string | null;
  state?: string;
  submitted_at?: string;
}
interface GhReviewComment {
  id?: number;
  user?: { login?: string; type?: string };
  body?: string | null;
  path?: string;
  line?: number;
  position?: number;
  diff_hunk?: string;
  created_at?: string;
}

/**
 * Fetches both review-level summaries AND inline code comments on a PR.
 * Filters out:
 *   - comments from the PR author (handle === user's handle)
 *   - bot comments (user.type === 'Bot' or login ends with [bot])
 */
export function createFetchPrReviewsTool(ctx: ToolContext) {
  return tool({
    name: "fetch_pr_reviews",
    description:
      "Fetch the review summaries and inline code comments from a specific PR. " +
      "Automatically filters out comments by the PR author and by bots, so what's " +
      "returned is what TEAMMATES said about the developer's code. Use to gather " +
      "external-voice signals — maintainer approvals, substantive critique, " +
      "respect/trust from peers. Creates `review:` artifacts you can cite.",
    inputSchema: FETCH_REVIEWS_SCHEMA,
    execute: async (input) => {
      const handle = ctx.session.handle.toLowerCase();
      const out: string[] = [];
      const byRepo = input.repo;
      const num = input.pr_number;

      // Reviews on other-org PUBLIC repos don't need auth at all, and
      // user OAuth tokens can get rejected on cross-org calls (401 Bad
      // credentials). We try auth'd first for the rate limit; on 401
      // we retry unauth'd so the tool degrades gracefully instead of
      // killing every review fetch mid-scan.
      const ghApi = async (
        path: string,
      ): Promise<{ stdout: string }> => {
        try {
          return await execFileAsync(
            "gh",
            ["api", path, "--paginate"],
            { maxBuffer: 30 * 1024 * 1024, timeout: 60_000 },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/401|Bad credentials/i.test(msg)) throw err;
          // Retry without the user's token for public-repo fallback.
          return await execFileAsync(
            "gh",
            ["api", path, "--paginate"],
            {
              maxBuffer: 30 * 1024 * 1024,
              timeout: 60_000,
              env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "" },
            },
          );
        }
      };

      try {
        // Summary reviews (approved / changes_requested / commented + body)
        const { stdout: reviewsRaw } = await ghApi(
          `/repos/${byRepo}/pulls/${num}/reviews`,
        );
        const reviews = safeJsonArray<GhReview>(reviewsRaw);

        for (const r of reviews) {
          const login = r.user?.login ?? "";
          if (isBotOrSelf(login, r.user?.type, handle)) continue;
          const body = (r.body ?? "").trim();
          const stateLabel = (r.state ?? "").toLowerCase();
          const id = `review:${byRepo}#${num}:${r.id ?? stateLabel}`;
          const title = `${login} ${stateLabel || "commented"} on PR #${num}`;
          ctx.artifactSink[id] ??= {
            id,
            type: "review",
            source_url: `https://github.com/${byRepo}/pull/${num}#pullrequestreview-${r.id ?? ""}`,
            title,
            excerpt: body.slice(0, 1500),
            metadata: {
              repo: byRepo,
              pr_number: num,
              reviewer: login,
              state: stateLabel,
              submitted_at: r.submitted_at,
              kind: "review",
            },
            recorded_at: new Date().toISOString(),
          };
          const excerpt = body ? ` "${body.slice(0, 300)}"` : "";
          out.push(`[${id}] ${title}${excerpt}`);
        }

        // Inline code comments on specific lines
        const { stdout: commentsRaw } = await ghApi(
          `/repos/${byRepo}/pulls/${num}/comments`,
        );
        const comments = safeJsonArray<GhReviewComment>(commentsRaw);

        for (const c of comments) {
          const login = c.user?.login ?? "";
          if (isBotOrSelf(login, c.user?.type, handle)) continue;
          const body = (c.body ?? "").trim();
          if (body.length === 0) continue;
          const id = `review-comment:${byRepo}#${num}:${c.id ?? ""}`;
          const title = `${login} inline on ${c.path ?? ""}:${c.line ?? c.position ?? ""}`;
          ctx.artifactSink[id] ??= {
            id,
            type: "review",
            source_url: `https://github.com/${byRepo}/pull/${num}#discussion_r${c.id ?? ""}`,
            title,
            excerpt: body.slice(0, 1500),
            metadata: {
              repo: byRepo,
              pr_number: num,
              reviewer: login,
              path: c.path,
              line: c.line ?? c.position,
              created_at: c.created_at,
              kind: "inline",
            },
            recorded_at: new Date().toISOString(),
          };
          out.push(`[${id}] ${title}  "${body.slice(0, 300)}"`);
        }

        if (out.length === 0) {
          return `[info] PR ${byRepo}#${num} has no non-author, non-bot reviews or comments.`;
        }
        return out.slice(0, 60).join("\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[error] fetch_pr_reviews failed: ${msg.slice(0, 300)}`;
      }
    },
  });
}

function safeJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // --paginate concatenates multiple JSON arrays; try line-split + merge
    const out: T[] = [];
    for (const chunk of raw.split(/\]\s*\[/)) {
      try {
        const wrapped = chunk.startsWith("[") ? chunk : "[" + chunk;
        const closed = wrapped.endsWith("]") ? wrapped : wrapped + "]";
        const arr = JSON.parse(closed);
        if (Array.isArray(arr)) out.push(...(arr as T[]));
      } catch {
        /* skip */
      }
    }
    return out;
  }
}

function isBotOrSelf(
  login: string,
  type: string | undefined,
  lowerHandle: string,
): boolean {
  if (!login) return true;
  const lower = login.toLowerCase();
  if (lower === lowerHandle) return true;
  if (type === "Bot") return true;
  if (lower.endsWith("[bot]")) return true;
  if (lower.includes("dependabot") || lower.includes("renovate")) return true;
  return false;
}
