/**
 * Code-reading tools — let workers inspect actual source code, not just
 * git metadata. Workers can:
 *   - list_tree      (see the file structure of a repo)
 *   - read_file      (read a specific file, optionally at a specific sha)
 *   - git_log        (list commits by the user touching a path)
 *   - git_show       (see the full diff of a specific commit)
 *
 * Repos are lazily cloned into `profiles/<handle>/repos/<safe_name>/` and
 * reused across tool calls + across scans (until the user deletes the dir).
 * If a repo was already cloned during the inventory stage, we reuse it;
 * otherwise we clone on first use.
 */

import { tool } from "@openrouter/agent";
import * as z from "zod/v4";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { ToolContext } from "./web.js";

const execFileAsync = promisify(execFile);

// Safe filename for a repo ("owner/name" → "owner-name")
function safeRepoDir(fullName: string): string {
  return fullName.replace(/\//g, "-");
}

/**
 * Ensure a repo is cloned locally. Returns the absolute path to the clone.
 * Uses `gh repo clone` (preferred, handles auth) with --no-checkout for speed;
 * then `git checkout` only when we need file contents.
 */
async function ensureCloned(
  repoFullName: string,
  profileDir: string,
  log: (text: string) => void,
): Promise<string> {
  const target = join(profileDir, "repos", safeRepoDir(repoFullName));
  if (existsSync(join(target, ".git"))) return target;

  log(`[code] cloning ${repoFullName}...\n`);
  await mkdir(join(profileDir, "repos"), { recursive: true });
  await execFileAsync(
    "gh",
    ["repo", "clone", repoFullName, target, "--", "--no-single-branch"],
    { timeout: 0 },
  );
  return target;
}

// Defensive: prevent agent-supplied paths from escaping the repo root.
function resolveInside(repoRoot: string, relativePath: string): string | null {
  const cleaned = relativePath.replace(/^\/+/, "").trim();
  if (cleaned === "" || cleaned === ".") return repoRoot;
  const abs = resolve(repoRoot, cleaned);
  const rootResolved = resolve(repoRoot);
  if (!abs.startsWith(rootResolved + sep) && abs !== rootResolved) return null;
  return abs;
}

// ──────────────────────────────────────────────────────────────
// list_tree
// ──────────────────────────────────────────────────────────────

const LIST_TREE_SCHEMA = z.object({
  repo: z.string().describe("Full repo name, e.g. 'owner/name'"),
  path: z.string().default("").describe("Subdirectory inside the repo, '' for root"),
  depth: z
    .number()
    .int()
    .min(1)
    .max(4)
    .default(2)
    .describe("Tree depth. Default 2."),
  reason: z.string().max(200),
});

function createListTreeTool(ctx: ToolContext) {
  return tool({
    name: "list_tree",
    description:
      "List files/directories inside a cloned repo at a given path. Use to " +
      "orient yourself in a codebase before reading files. Auto-excludes " +
      "heavy generated paths (node_modules, dist, .git).",
    inputSchema: LIST_TREE_SCHEMA,
    execute: async (input) => {
      try {
        const root = await ensureCloned(input.repo, ctx.profileDir, ctx.log);
        const base = resolveInside(root, input.path);
        if (!base) return `[error] path ${input.path} escapes the repo root`;

        // Ensure files are checked out — clone used --no-checkout for speed
        await ensureCheckout(root);

        const entries = await listTree(base, input.depth);
        if (entries.length === 0) return `[info] (empty)`;
        return entries.join("\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[error] list_tree failed: ${msg.slice(0, 300)}`;
      }
    },
  });
}

async function ensureCheckout(repoRoot: string): Promise<void> {
  // Cheap check — if any file beyond .git exists at root, assume checked out
  try {
    await execFileAsync("git", ["checkout", "HEAD", "--", "."], {
      cwd: repoRoot,
      timeout: 120_000,
    }).catch(() => {
      /* ignore — might already be checked out */
    });
  } catch {
    /* best effort */
  }
}

async function listTree(dir: string, depth: number): Promise<string[]> {
  const out: string[] = [];
  const skipNames = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    "coverage",
    "target",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".DS_Store",
  ]);

  async function walk(current: string, prefix: string, remaining: number) {
    if (remaining < 0) return;
    const { readdir } = await import("node:fs/promises");
    let entries: string[] = [];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    entries.sort();
    for (const name of entries) {
      if (skipNames.has(name)) continue;
      const full = join(current, name);
      try {
        const st = await stat(full);
        if (st.isDirectory()) {
          out.push(`${prefix}${name}/`);
          if (remaining > 0) await walk(full, `${prefix}  `, remaining - 1);
        } else {
          out.push(`${prefix}${name}  (${st.size}b)`);
        }
      } catch {
        /* skip unreadable */
      }
    }
  }
  await walk(dir, "", depth);
  return out;
}

// ──────────────────────────────────────────────────────────────
// read_file
// ──────────────────────────────────────────────────────────────

const READ_FILE_SCHEMA = z.object({
  repo: z.string(),
  path: z.string().describe("File path within the repo, e.g. 'src/index.ts'"),
  sha: z
    .string()
    .optional()
    .describe("Optional commit sha — read the file AT that commit rather than HEAD"),
  start_line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
  reason: z.string().max(200),
});

function createReadFileTool(ctx: ToolContext) {
  return tool({
    name: "read_file",
    description:
      "Read a source file from a cloned repo. Optionally at a specific commit " +
      "sha. Returns up to 40,000 chars; use start_line/end_line to focus. " +
      "Use this to inspect README, architecture-defining files, or the code " +
      "touched by a specific PR.",
    inputSchema: READ_FILE_SCHEMA,
    execute: async (input) => {
      try {
        const root = await ensureCloned(input.repo, ctx.profileDir, ctx.log);
        const safePath = resolveInside(root, input.path);
        if (!safePath) return `[error] path ${input.path} escapes the repo root`;

        let content: string;
        if (input.sha) {
          // Read at a specific commit via `git show sha:path`
          const { stdout } = await execFileAsync(
            "git",
            ["show", `${input.sha}:${input.path}`],
            { cwd: root, maxBuffer: 50 * 1024 * 1024, timeout: 60_000 },
          );
          content = stdout;
        } else {
          await ensureCheckout(root);
          if (!existsSync(safePath)) return `[error] file not found: ${input.path}`;
          const st = await stat(safePath);
          if (st.size > 2 * 1024 * 1024) {
            return `[error] file is ${Math.round(st.size / 1024)}KB — too large. Pick a narrower file.`;
          }
          content = await readFile(safePath, "utf-8");
        }

        // Optional line-range slice
        if (input.start_line || input.end_line) {
          const lines = content.split("\n");
          const s = (input.start_line ?? 1) - 1;
          const e = Math.min(lines.length, input.end_line ?? lines.length);
          content = lines.slice(s, e).join("\n");
        }

        // Cap at 40k chars
        const truncated = content.length > 40_000;
        const body = content.slice(0, 40_000);
        const head = `repo: ${input.repo}\npath: ${input.path}${input.sha ? `\nsha: ${input.sha}` : ""}\n`;
        const foot = truncated
          ? `\n\n--- truncated at 40,000 chars of ${content.length.toLocaleString()} total ---`
          : "";
        return `${head}\n${body}${foot}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[error] read_file failed: ${msg.slice(0, 400)}`;
      }
    },
  });
}

// ──────────────────────────────────────────────────────────────
// git_log — commits by author touching a path
// ──────────────────────────────────────────────────────────────

const GIT_LOG_SCHEMA = z.object({
  repo: z.string(),
  path: z.string().optional().describe("Restrict to commits touching this path"),
  author: z
    .string()
    .optional()
    .describe("Filter by author email or name. Leave blank for all authors."),
  limit: z.number().int().min(1).max(200).default(30),
  reason: z.string().max(200),
});

function createGitLogTool(ctx: ToolContext) {
  return tool({
    name: "git_log",
    description:
      "Show commit history for a repo, optionally filtered by path or author. " +
      "Returns short hash, date, author, subject. Use to find specific commits " +
      "to then read via read_file(repo, path, sha=) or git_show(repo, sha).",
    inputSchema: GIT_LOG_SCHEMA,
    execute: async (input) => {
      try {
        const root = await ensureCloned(input.repo, ctx.profileDir, ctx.log);
        const args = [
          "log",
          `--pretty=format:%h  %ad  %an <%ae>  %s`,
          "--date=short",
          `-n${input.limit}`,
        ];
        if (input.author) args.push(`--author=${input.author}`);
        if (input.path) args.push("--", input.path);
        const { stdout } = await execFileAsync("git", args, {
          cwd: root,
          maxBuffer: 20 * 1024 * 1024,
          timeout: 60_000,
        });
        return stdout.trim() || `[info] no commits match`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[error] git_log failed: ${msg.slice(0, 300)}`;
      }
    },
  });
}

// ──────────────────────────────────────────────────────────────
// git_show — full diff of a commit
// ──────────────────────────────────────────────────────────────

const GIT_SHOW_SCHEMA = z.object({
  repo: z.string(),
  sha: z.string().describe("Commit SHA (short or long form)"),
  path: z
    .string()
    .optional()
    .describe("Optional: limit diff to this file"),
  max_chars: z.number().int().min(1000).max(80_000).default(30_000),
  reason: z.string().max(200),
});

function createGitShowTool(ctx: ToolContext) {
  return tool({
    name: "git_show",
    description:
      "Show the full diff for a commit. Optionally filtered to a single path. " +
      "Use this to see WHAT changed in a specific commit — the actual code " +
      "that makes a claim earned.",
    inputSchema: GIT_SHOW_SCHEMA,
    execute: async (input) => {
      try {
        const root = await ensureCloned(input.repo, ctx.profileDir, ctx.log);
        const args = [
          "show",
          "--no-color",
          "--stat",
          "--patch",
          input.sha,
        ];
        if (input.path) args.push("--", input.path);
        const { stdout } = await execFileAsync("git", args, {
          cwd: root,
          maxBuffer: 100 * 1024 * 1024,
          timeout: 60_000,
        });
        const body = stdout.slice(0, input.max_chars);
        const truncated = stdout.length > input.max_chars;
        return `repo: ${input.repo}\nsha: ${input.sha}${input.path ? `\npath: ${input.path}` : ""}\n\n${body}${truncated ? `\n\n--- truncated at ${input.max_chars} of ${stdout.length.toLocaleString()} chars ---` : ""}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[error] git_show failed: ${msg.slice(0, 300)}`;
      }
    },
  });
}

// ──────────────────────────────────────────────────────────────
// Factory
// ──────────────────────────────────────────────────────────────

export function createCodeTools(ctx: ToolContext) {
  return [
    createListTreeTool(ctx),
    createReadFileTool(ctx),
    createGitLogTool(ctx),
    createGitShowTool(ctx),
  ];
}
