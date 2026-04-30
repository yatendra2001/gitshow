/**
 * Repo corpus reader — walks first-party text files in a cloned repo,
 * chunks them for map/reduce inference, and reports explicit coverage.
 *
 * Small/medium repos are read in full. Very large repos are prioritized
 * by source/config relevance and carry coverage stats so the product
 * never silently pretends that a partial pass was complete.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const README_CANDIDATES = ["README.md", "README", "README.txt", "Readme.md", "readme.md"];
const README_BYTES = 20_000;
const MANIFEST_BYTES = 20_000;
const TREE_DEPTH = 4;
const TREE_MAX_LINES = 400;
const CHUNK_CHARS = 12_000;
const MAX_TEXT_FILE_BYTES = 1_000_000;
const FULL_REPO_BYTES = 3_000_000;
const FULL_REPO_FILES = 350;
const LARGE_REPO_BYTES = 4_000_000;
const LARGE_REPO_FILES = 500;
const MAX_FILE_SUMMARIES_FOR_JUDGE = 80;

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
  ".yarn",
  ".gradle",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".parcel-cache",
  "DerivedData",
  "Generated",
  "generated",
  "__generated__",
]);

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".swift", ".kt",
  ".java", ".scala", ".php", ".cs", ".cpp", ".c", ".h", ".hpp",
  ".dart", ".lua", ".elm", ".ex", ".exs", ".clj", ".sol",
  ".sh", ".sql", ".vue", ".svelte", ".html", ".css", ".scss",
  ".md", ".mdx", ".json", ".jsonc", ".toml", ".yaml", ".yml",
  ".xml", ".graphql", ".gql", ".proto", ".prisma", ".tf",
  ".dockerfile", ".gradle", ".kts", ".r", ".jl", ".zig",
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

const TEXT_FILE_NAMES = new Set([
  "Dockerfile",
  "Containerfile",
  "Makefile",
  "Rakefile",
  "Procfile",
  "Justfile",
  "Taskfile",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
]);

export type RepoCorpusTier = "full" | "prioritized";

export interface RepoCorpusFile {
  path: string;
  bytes: number;
  chars: number;
  lines: number;
  extension: string;
  content: string;
}

export interface RepoCorpusChunk {
  id: string;
  path: string;
  extension: string;
  startLine: number;
  endLine: number;
  chars: number;
  content: string;
}

export interface RepoCorpusStats {
  tier: RepoCorpusTier;
  eligibleFiles: number;
  eligibleBytes: number;
  analyzedFiles: number;
  analyzedBytes: number;
  skippedFiles: number;
  skippedBytes: number;
  skippedTooLarge: number;
  skippedSensitive: number;
  skippedUnreadable: number;
  chunkCount: number;
  fullCoverage: boolean;
}

export interface RepoChunkFinding {
  chunkId: string;
  path: string;
  purpose: string;
  technologies: string[];
  domainSignals: string[];
  implementationSignals: string[];
  qualitySignals: string[];
  risks: string[];
}

export interface RepoFileSummary {
  path: string;
  bytes: number;
  chunks: number;
  summary: string;
  technologies: string[];
  signals: string[];
  risks: string[];
}

export interface RepoCorpusAnalysis {
  findings: RepoChunkFinding[];
  fileSummaries: RepoFileSummary[];
  technologies: string[];
  repoSignals: string[];
  risks: string[];
  analyzedBatches: number;
  failedBatches: number;
}

export interface RepoCorpus {
  readme?: string;
  readmeName?: string;
  tree: string;
  manifests: Record<string, string>;
  files: RepoCorpusFile[];
  chunks: RepoCorpusChunk[];
  stats: RepoCorpusStats;
  /** Back-compat name for older call sites; now means analyzed text bytes. */
  totalSampledBytes: number;
}

export type RepoSample = RepoCorpus;

export async function sampleRepo(repoPath: string): Promise<RepoCorpus> {
  const readme = await readReadme(repoPath);
  const tree = await buildTree(repoPath, TREE_DEPTH);
  const manifests = await readManifests(repoPath);
  const inventory = await collectCorpusCandidates(repoPath);
  const selected = selectFilesForAnalysis(inventory.files);
  const files = await readCorpusFiles(repoPath, selected.files);
  const chunks = chunkCorpusFiles(files);

  const analyzedBytes = files.reduce((n, f) => n + f.bytes, 0);
  const stats: RepoCorpusStats = {
    tier: selected.tier,
    eligibleFiles: inventory.files.length,
    eligibleBytes: inventory.files.reduce((n, f) => n + f.bytes, 0),
    analyzedFiles: files.length,
    analyzedBytes,
    skippedFiles:
      inventory.skippedSensitive +
      inventory.skippedTooLarge +
      inventory.skippedUnreadable +
      Math.max(0, inventory.files.length - files.length),
    skippedBytes: Math.max(0, inventory.files.reduce((n, f) => n + f.bytes, 0) - analyzedBytes),
    skippedTooLarge: inventory.skippedTooLarge,
    skippedSensitive: inventory.skippedSensitive,
    skippedUnreadable: inventory.skippedUnreadable,
    chunkCount: chunks.length,
    fullCoverage: files.length === inventory.files.length,
  };

  return {
    readme: readme?.body,
    readmeName: readme?.name,
    tree,
    manifests,
    files,
    chunks,
    stats,
    totalSampledBytes: analyzedBytes,
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
      out[name] = body.slice(0, MANIFEST_BYTES);
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

interface CorpusCandidate {
  path: string;
  rel: string;
  bytes: number;
  extension: string;
}

interface CorpusInventory {
  files: CorpusCandidate[];
  skippedTooLarge: number;
  skippedSensitive: number;
  skippedUnreadable: number;
}

async function collectCorpusCandidates(root: string): Promise<CorpusInventory> {
  const inventory: CorpusInventory = {
    files: [],
    skippedTooLarge: 0,
    skippedSensitive: 0,
    skippedUnreadable: 0,
  };
  await collectFiles(root, root, inventory);
  inventory.files.sort((a, b) => a.rel.localeCompare(b.rel));
  return inventory;
}

async function collectFiles(
  root: string,
  dir: string,
  inventory: CorpusInventory,
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join("/");
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      await collectFiles(root, full, inventory);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isSensitivePath(rel)) {
      inventory.skippedSensitive++;
      continue;
    }
    if (!isTextCandidate(entry.name, rel)) continue;
    try {
      const s = await stat(full);
      if (s.size > MAX_TEXT_FILE_BYTES) {
        inventory.skippedTooLarge++;
        continue;
      }
      inventory.files.push({
        path: full,
        rel,
        bytes: s.size,
        extension: normalizedExtension(entry.name),
      });
    } catch {
      inventory.skippedUnreadable++;
    }
  }
}

function isTextCandidate(name: string, rel: string): boolean {
  if (SKIP_FILES.has(name)) return false;
  if (name.endsWith(".map") || name.endsWith(".min.js") || name.endsWith(".min.css")) return false;
  if (rel.includes("/fixtures/") || rel.includes("/snapshots/")) return false;
  if (TEXT_FILE_NAMES.has(name)) return true;
  return TEXT_EXT.has(normalizedExtension(name));
}

function normalizedExtension(name: string): string {
  if (TEXT_FILE_NAMES.has(name)) return name.toLowerCase();
  return extname(name).toLowerCase();
}

function isSensitivePath(rel: string): boolean {
  const lower = rel.toLowerCase();
  const name = lower.split("/").pop() ?? lower;
  if (name === ".env" || name.startsWith(".env.")) return true;
  const baseName = name.replace(/\.[^.]+$/, "");
  if (["secret", "secrets", "credential", "credentials"].includes(baseName)) return true;
  if (lower.split("/").some((part) => ["secret", "secrets", "credential", "credentials"].includes(part))) {
    return true;
  }
  if (lower.endsWith(".pem") || lower.endsWith(".p12") || lower.endsWith(".key")) return true;
  if (lower.includes("private-key") || lower.includes("private_key")) return true;
  return false;
}

function selectFilesForAnalysis(files: CorpusCandidate[]): {
  tier: RepoCorpusTier;
  files: CorpusCandidate[];
} {
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  if (files.length <= FULL_REPO_FILES && totalBytes <= FULL_REPO_BYTES) {
    return { tier: "full", files };
  }

  const picked: CorpusCandidate[] = [];
  let bytes = 0;
  for (const file of [...files].sort((a, b) => scoreFile(b) - scoreFile(a) || a.rel.localeCompare(b.rel))) {
    if (picked.length >= LARGE_REPO_FILES) break;
    if (bytes + file.bytes > LARGE_REPO_BYTES && picked.length > 0) continue;
    picked.push(file);
    bytes += file.bytes;
  }
  picked.sort((a, b) => a.rel.localeCompare(b.rel));
  return { tier: "prioritized", files: picked };
}

function scoreFile(file: CorpusCandidate): number {
  let score = 0;
  const rel = file.rel.toLowerCase();
  const name = rel.split("/").pop() ?? rel;
  if (MANIFEST_FILES.some((manifest) => manifest.toLowerCase() === name)) score += 100;
  if (rel.startsWith("src/") || rel.startsWith("app/") || rel.startsWith("apps/")) score += 40;
  if (rel.includes("/src/") || rel.includes("/app/") || rel.includes("/lib/")) score += 30;
  if (rel.includes("component") || rel.includes("service") || rel.includes("api")) score += 15;
  if (rel.includes("test") || rel.includes("spec") || rel.includes("__tests__")) score -= 15;
  if (file.bytes > 0) score += Math.max(0, 20 - Math.log10(file.bytes) * 4);
  return score;
}

async function readCorpusFiles(root: string, files: CorpusCandidate[]): Promise<RepoCorpusFile[]> {
  const out: RepoCorpusFile[] = [];
  for (const file of files) {
    try {
      const content = await readFile(file.path, "utf8");
      out.push({
        path: relative(root, file.path).split(sep).join("/"),
        bytes: file.bytes,
        chars: content.length,
        lines: content.split("\n").length,
        extension: file.extension,
        content,
      });
    } catch {
      // The scan already counted stat failures; a race here just means
      // the file won't be included in analysis.
    }
  }
  return out;
}

function chunkCorpusFiles(files: RepoCorpusFile[]): RepoCorpusChunk[] {
  const chunks: RepoCorpusChunk[] = [];
  let nextId = 1;
  for (const file of files) {
    const lines = file.content.split("\n");
    let startLine = 1;
    let current: string[] = [];
    let currentChars = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineChars = line.length + 1;
      if (current.length > 0 && currentChars + lineChars > CHUNK_CHARS) {
        chunks.push(makeChunk(nextId++, file, startLine, i, current));
        startLine = i + 1;
        current = [];
        currentChars = 0;
      }
      current.push(line);
      currentChars += lineChars;
    }
    if (current.length > 0) {
      chunks.push(makeChunk(nextId++, file, startLine, lines.length, current));
    }
  }
  return chunks;
}

function makeChunk(
  id: number,
  file: RepoCorpusFile,
  startLine: number,
  endLine: number,
  lines: string[],
): RepoCorpusChunk {
  const content = lines.join("\n");
  return {
    id: `c${id.toString().padStart(4, "0")}`,
    path: file.path,
    extension: file.extension,
    startLine,
    endLine,
    chars: content.length,
    content,
  };
}

export function formatChunksForAnalysis(chunks: RepoCorpusChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `<chunk id="${chunk.id}" path="${escapeAttr(chunk.path)}" lines="${chunk.startLine}-${chunk.endLine}" chars="${chunk.chars}">\n${chunk.content}\n</chunk>`,
    )
    .join("\n\n");
}

/** Format structured repo evidence for the final judge. Raw source chunks are excluded. */
export function formatSample(sample: RepoCorpus, analysis?: RepoCorpusAnalysis): string {
  const parts: string[] = [];
  if (sample.readme) {
    parts.push(`<readme name="${escapeAttr(sample.readmeName ?? "README")}">\n${sample.readme}\n</readme>`);
  }
  parts.push(`<tree>\n${sample.tree}\n</tree>`);
  for (const [name, body] of Object.entries(sample.manifests)) {
    parts.push(`<manifest name="${escapeAttr(name)}">\n${body}\n</manifest>`);
  }
  parts.push(formatCoverage(sample));
  if (analysis) {
    parts.push(formatAnalysis(analysis));
  } else {
    parts.push(
      `<files_analyzed>\n${sample.files
        .map((f) => `  ${f.path} (${f.bytes} bytes, ${f.lines} lines)`)
        .join("\n")}\n</files_analyzed>`,
    );
  }
  return parts.join("\n\n");
}

function formatCoverage(sample: RepoCorpus): string {
  const s = sample.stats;
  return [
    `<repo_coverage tier="${s.tier}" fullCoverage="${s.fullCoverage}">`,
    `  eligible files: ${s.eligibleFiles}`,
    `  eligible bytes: ${s.eligibleBytes}`,
    `  analyzed files: ${s.analyzedFiles}`,
    `  analyzed bytes: ${s.analyzedBytes}`,
    `  source chunks analyzed: ${s.chunkCount}`,
    `  skipped files: ${s.skippedFiles}`,
    `  skipped bytes: ${s.skippedBytes}`,
    `  skipped too large: ${s.skippedTooLarge}`,
    `  skipped sensitive: ${s.skippedSensitive}`,
    `</repo_coverage>`,
  ].join("\n");
}

function formatAnalysis(analysis: RepoCorpusAnalysis): string {
  const fileSummaries = analysis.fileSummaries.slice(0, MAX_FILE_SUMMARIES_FOR_JUDGE);
  const omitted = analysis.fileSummaries.length - fileSummaries.length;
  return [
    `<repo_analysis analyzedBatches="${analysis.analyzedBatches}" failedBatches="${analysis.failedBatches}" findings="${analysis.findings.length}">`,
    `  technologies: ${analysis.technologies.slice(0, 24).join(", ") || "(none detected)"}`,
    `  repo signals:`,
    ...analysis.repoSignals.slice(0, 40).map((s) => `    - ${s}`),
    `  risks:`,
    ...analysis.risks.slice(0, 20).map((s) => `    - ${s}`),
    `</repo_analysis>`,
    `<file_summaries${omitted > 0 ? ` omitted="${omitted}"` : ""}>`,
    ...fileSummaries.map(formatFileSummary),
    `</file_summaries>`,
  ].join("\n");
}

function formatFileSummary(summary: RepoFileSummary): string {
  return [
    `  <file_summary path="${escapeAttr(summary.path)}" bytes="${summary.bytes}" chunks="${summary.chunks}">`,
    `    summary: ${summary.summary}`,
    `    technologies: ${summary.technologies.slice(0, 10).join(", ") || "(none detected)"}`,
    `    signals: ${summary.signals.slice(0, 8).join(" | ") || "(none)"}`,
    `    risks: ${summary.risks.slice(0, 5).join(" | ") || "(none)"}`,
    `  </file_summary>`,
  ].join("\n");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
