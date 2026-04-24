/**
 * Repo Sampler — gathers a bounded text sample of a cloned repo for the
 * Judge LLM to read. Returns README + top-level tree + a few of the
 * largest non-vendored source files + parsed manifests.
 *
 * Total prompt input is capped at ~20KB so Kimi's context stays small
 * and per-judgment cost stays bounded.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const README_CANDIDATES = ["README.md", "README", "README.txt", "Readme.md", "readme.md"];
const README_BYTES = 3000;
const FILE_BYTES = 2000;
const MAX_FILES = 5;
const TREE_DEPTH = 2;
const TREE_MAX_LINES = 80;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  ".vercel",
  "vendor",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".dart_tool",
  "Pods",
  ".idea",
  ".vscode",
  "out",
  "coverage",
  ".pnpm-store",
]);

const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".swift", ".kt",
  ".java", ".scala", ".php", ".cs", ".cpp", ".c", ".h", ".hpp",
  ".dart", ".lua", ".elm", ".ex", ".exs", ".clj", ".sol",
  ".sh", ".sql", ".vue", ".svelte", ".html", ".css", ".scss",
]);

const MANIFEST_FILES = [
  "package.json",
  "pubspec.yaml",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "Gemfile",
  "requirements.txt",
  "composer.json",
  "build.gradle",
  "build.gradle.kts",
  "Podfile",
  "mix.exs",
];

export interface RepoSample {
  readme?: string;
  readmeName?: string;
  tree: string;
  manifests: Record<string, string>;
  files: Array<{ path: string; bytes: number; sample: string }>;
  /** Total bytes the LLM will see (sampled, not raw). */
  totalSampledBytes: number;
}

export async function sampleRepo(repoPath: string): Promise<RepoSample> {
  const readme = await readReadme(repoPath);
  const tree = await buildTree(repoPath, TREE_DEPTH);
  const manifests = await readManifests(repoPath);
  const files = await pickAndSampleTopFiles(repoPath, MAX_FILES);

  const totalSampledBytes =
    (readme?.body.length ?? 0) +
    tree.length +
    Object.values(manifests).reduce((n, v) => n + v.length, 0) +
    files.reduce((n, f) => n + f.sample.length, 0);

  return {
    readme: readme?.body,
    readmeName: readme?.name,
    tree,
    manifests,
    files,
    totalSampledBytes,
  };
}

async function readReadme(
  repoPath: string,
): Promise<{ name: string; body: string } | undefined> {
  for (const name of README_CANDIDATES) {
    try {
      const body = await readFile(join(repoPath, name), "utf8");
      return { name, body: body.slice(0, README_BYTES) };
    } catch {
      // try next
    }
  }
  return undefined;
}

async function readManifests(repoPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of MANIFEST_FILES) {
    try {
      const body = await readFile(join(repoPath, name), "utf8");
      out[name] = body.slice(0, 2000);
    } catch {
      // not present
    }
  }
  return out;
}

async function buildTree(root: string, depth: number): Promise<string> {
  const lines: string[] = [];
  await walkTree(root, root, depth, lines);
  if (lines.length > TREE_MAX_LINES) {
    return lines.slice(0, TREE_MAX_LINES).join("\n") + `\n…[${lines.length - TREE_MAX_LINES} more entries]`;
  }
  return lines.join("\n");
}

async function walkTree(
  root: string,
  dir: string,
  depthRemaining: number,
  out: string[],
): Promise<void> {
  if (depthRemaining < 0) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join("/");
    const indent = "  ".repeat(TREE_DEPTH - depthRemaining);
    out.push(`${indent}${entry.name}${entry.isDirectory() ? "/" : ""}`);
    if (entry.isDirectory() && depthRemaining > 0) {
      await walkTree(root, full, depthRemaining - 1, out);
    }
  }
}

async function pickAndSampleTopFiles(
  root: string,
  count: number,
): Promise<RepoSample["files"]> {
  const candidates: Array<{ path: string; bytes: number }> = [];
  await collectFiles(root, root, candidates, 4);
  candidates.sort((a, b) => b.bytes - a.bytes);
  const picked = candidates.slice(0, count);
  const out: RepoSample["files"] = [];
  for (const c of picked) {
    try {
      const buf = await readFile(c.path, "utf8");
      out.push({
        path: relative(root, c.path).split(sep).join("/"),
        bytes: c.bytes,
        sample: buf.slice(0, FILE_BYTES),
      });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

async function collectFiles(
  root: string,
  dir: string,
  out: Array<{ path: string; bytes: number }>,
  depthRemaining: number,
): Promise<void> {
  if (depthRemaining < 0) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, full, out, depthRemaining - 1);
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    const ext = dot >= 0 ? entry.name.slice(dot).toLowerCase() : "";
    if (!CODE_EXT.has(ext)) continue;
    try {
      const s = await stat(full);
      if (s.size > 500_000) continue; // skip ridiculous files
      out.push({ path: full, bytes: s.size });
    } catch {
      // skip
    }
  }
}

/** Format the sample into a single tagged text block for the LLM. */
export function formatSample(sample: RepoSample): string {
  const parts: string[] = [];
  if (sample.readme) {
    parts.push(`<readme name="${sample.readmeName ?? "README"}">\n${sample.readme}\n</readme>`);
  }
  parts.push(`<tree>\n${sample.tree}\n</tree>`);
  for (const [name, body] of Object.entries(sample.manifests)) {
    parts.push(`<manifest name="${name}">\n${body}\n</manifest>`);
  }
  for (const f of sample.files) {
    parts.push(`<file path="${f.path}" bytes="${f.bytes}">\n${f.sample}\n</file>`);
  }
  return parts.join("\n\n");
}
