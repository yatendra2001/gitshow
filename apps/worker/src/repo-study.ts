/**
 * Repo Study — runs once per cloned repo to compute the signals the
 * Sonnet ranker needs to honestly judge "did the user actually
 * build this?".
 *
 * Output:
 *   - Blame stats: user_lines / total_lines / userShare / commit counts
 *     / first + last user commit dates. Computed via `git log` rather
 *     than `git blame`: blame on every file is O(N×files) and thrashes
 *     on big repos; log --numstat with `--author=<handle>` gives us
 *     adds/dels per commit at O(commits) cost.
 *
 *   - Manifest deps: parses package.json / Cargo.toml / pubspec.yaml /
 *     pyproject.toml / go.mod / Gemfile so the post-judge skills
 *     aggregator can compute usage frequency.
 *
 * Failures here MUST NOT kill the pipeline — every block is wrapped
 * in try/catch and degrades to undefined / [].
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const execFile = promisify(execFileCb);

export interface ManifestDep {
  /** "react" / "axum" / "django" / "firebase_auth" / etc. */
  name: string;
  /** Filename ("package.json", "Cargo.toml", ...). */
  manifest: string;
  /** "npm" / "cargo" / "pypi" / "pub" / "go" / "ruby" / "swift" / "php". */
  ecosystem: ManifestEcosystem;
  /** True for devDependencies / [dev-dependencies] / dev_dependencies. */
  isDev: boolean;
}

export type ManifestEcosystem =
  | "npm"
  | "cargo"
  | "pypi"
  | "pub"
  | "go"
  | "ruby"
  | "swift"
  | "php"
  | "gradle";

export interface RepoStudy {
  fullName: string;
  /** Lines added by the user across all commits. */
  userLines: number;
  /** Lines added by anyone (the repo's total commit add count). */
  totalLines: number;
  /** userLines / max(totalLines, 1) — clamped 0..1. */
  userShare: number;
  /** Number of commits authored by the user. */
  userCommits: number;
  /** Number of commits in the repo total (excluding merges). */
  totalCommits: number;
  /** ISO date of the user's first commit (if any). */
  firstUserCommit?: string;
  /** ISO date of the user's last commit (if any). */
  lastUserCommit?: string;
  /** Parsed dependencies from manifest files in the repo root + 2 levels deep. */
  manifestDeps: ManifestDep[];
}

export interface StudyOptions {
  repoPath: string;
  fullName: string;
  /** GitHub handle — used as the primary author match. */
  handle: string;
  /**
   * Additional verified email addresses associated with this GitHub
   * account (from `gh api user/emails`). Each email is added as a
   * separate `git log --author=<email>` filter so commits made under
   * a real personal email (e.g. `someuser@gmail.com`) get counted
   * even when the email doesn't contain the GitHub handle as a
   * substring. Without this, `git log --author=<handle>` misses every
   * commit authored under an unrelated email — and Sonnet's
   * "userShare < 0.10 hard-exclude" rule then drops the repo from
   * the My Projects grid entirely.
   */
  userEmails?: string[];
  log: (text: string) => void;
}

const GIT_TIMEOUT_MS = 60_000;

export async function studyRepo(opts: StudyOptions): Promise<RepoStudy> {
  const { repoPath, fullName, handle, userEmails, log } = opts;

  const [blame, manifestDeps] = await Promise.all([
    blameStats({ repoPath, handle, userEmails, log }).catch((err) => {
      log(
        `[study:${fullName}] blame failed: ${(err as Error).message.slice(0, 120)}\n`,
      );
      return defaultBlame();
    }),
    parseManifests({ repoPath }).catch((err) => {
      log(
        `[study:${fullName}] manifest parse failed: ${(err as Error).message.slice(0, 120)}\n`,
      );
      return [] as ManifestDep[];
    }),
  ]);

  return { fullName, ...blame, manifestDeps };
}

// ─── Blame ─────────────────────────────────────────────────────────

interface BlameStats {
  userLines: number;
  totalLines: number;
  userShare: number;
  userCommits: number;
  totalCommits: number;
  firstUserCommit?: string;
  lastUserCommit?: string;
}

function defaultBlame(): BlameStats {
  return {
    userLines: 0,
    totalLines: 0,
    userShare: 0,
    userCommits: 0,
    totalCommits: 0,
  };
}

async function blameStats(args: {
  repoPath: string;
  handle: string;
  userEmails?: string[];
  log: (s: string) => void;
}): Promise<BlameStats> {
  const { repoPath, handle, userEmails } = args;
  // Build the full author filter set:
  //   - handle               (matches noreply emails like `<id>+handle@users.noreply.github.com`)
  //   - each verified email  (matches commits authored under personal / work emails)
  // git log treats multiple --author flags as OR, so a commit matches
  // if ANY of these substrings appears in author name OR email. This
  // catches the common case where a developer commits under their
  // real email (e.g. `realname@gmail.com`) which doesn't contain
  // their GitHub handle as a substring — without this fix, every one
  // of those commits is missed and the repo reads as 0% authored.
  const authorFilters = uniqueStrings([handle, ...(userEmails ?? [])]);
  const authorArgs = authorFilters.map((a) => `--author=${a}`);

  const userNumstat = await runGit(
    [
      "log",
      "--no-merges",
      ...authorArgs,
      "--pretty=tformat:",
      "--numstat",
    ],
    repoPath,
  );
  const allNumstat = await runGit(
    ["log", "--no-merges", "--pretty=tformat:", "--numstat"],
    repoPath,
  );
  const userLines = sumAdds(userNumstat);
  const totalLines = sumAdds(allNumstat);

  const userCommitOneline = await runGit(
    ["log", "--no-merges", ...authorArgs, "--oneline"],
    repoPath,
  );
  const allCommitOneline = await runGit(
    ["log", "--no-merges", "--oneline"],
    repoPath,
  );
  const userCommits = countLines(userCommitOneline);
  const totalCommits = countLines(allCommitOneline);

  const userDates = userCommits
    ? await runGit(
        [
          "log",
          "--no-merges",
          ...authorArgs,
          "--reverse",
          "--pretty=format:%aI",
        ],
        repoPath,
      )
    : "";
  const dateLines = userDates.split("\n").filter(Boolean);
  const firstUserCommit = dateLines[0];
  const lastUserCommit = dateLines[dateLines.length - 1];

  return {
    userLines,
    totalLines,
    userShare: totalLines > 0 ? Math.min(1, userLines / totalLines) : 0,
    userCommits,
    totalCommits,
    firstUserCommit,
    lastUserCommit,
  };
}

function uniqueStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const t = s.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  // Bounded buffer + timeout — git output on a 50k-commit repo can
  // be tens of MB and hang on a slow filesystem.
  const { stdout } = await execFile("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    timeout: GIT_TIMEOUT_MS,
  });
  return stdout;
}

function sumAdds(numstat: string): number {
  let total = 0;
  for (const line of numstat.split("\n")) {
    if (!line) continue;
    // Lines look like: "12\t3\tpath/to/file" — first column is adds,
    // second is dels. Binary files show "-\t-\t..."; skip those.
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const adds = line.slice(0, tab);
    if (adds === "-" || adds === "") continue;
    const n = Number(adds);
    if (!Number.isFinite(n)) continue;
    total += n;
  }
  return total;
}

function countLines(s: string): number {
  if (!s) return 0;
  return s.split("\n").filter((l) => l.length > 0).length;
}

// ─── Manifest parsing ──────────────────────────────────────────────

const MANIFEST_FILES: Array<{
  name: string;
  ecosystem: ManifestEcosystem;
  parse: (body: string, name: string) => ManifestDep[];
}> = [
  { name: "package.json", ecosystem: "npm", parse: parsePackageJson },
  { name: "Cargo.toml", ecosystem: "cargo", parse: parseCargoToml },
  { name: "pubspec.yaml", ecosystem: "pub", parse: parsePubspec },
  { name: "pyproject.toml", ecosystem: "pypi", parse: parsePyproject },
  { name: "requirements.txt", ecosystem: "pypi", parse: parseRequirements },
  { name: "go.mod", ecosystem: "go", parse: parseGoMod },
  { name: "Gemfile", ecosystem: "ruby", parse: parseGemfile },
  { name: "Package.swift", ecosystem: "swift", parse: parsePackageSwift },
  { name: "composer.json", ecosystem: "php", parse: parseComposerJson },
];

async function parseManifests(args: {
  repoPath: string;
}): Promise<ManifestDep[]> {
  const out: ManifestDep[] = [];
  for (const m of MANIFEST_FILES) {
    try {
      const body = await readFile(join(args.repoPath, m.name), "utf8");
      out.push(...m.parse(body, m.name));
    } catch {
      // Manifest absent — fine.
    }
  }
  // De-dupe within a single repo: same dep can appear in both `dependencies`
  // and `devDependencies`. Keep the non-dev entry if both exist.
  const byKey = new Map<string, ManifestDep>();
  for (const d of out) {
    const key = `${d.ecosystem}:${d.name.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || (prev.isDev && !d.isDev)) byKey.set(key, d);
  }
  return [...byKey.values()];
}

function parsePackageJson(body: string, name: string): ManifestDep[] {
  let json: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  const out: ManifestDep[] = [];
  for (const [n, _v] of Object.entries(json.dependencies ?? {})) {
    out.push({ name: n, manifest: name, ecosystem: "npm", isDev: false });
  }
  for (const [n, _v] of Object.entries(json.devDependencies ?? {})) {
    out.push({ name: n, manifest: name, ecosystem: "npm", isDev: true });
  }
  return out;
}

function parseCargoToml(body: string, name: string): ManifestDep[] {
  const out: ManifestDep[] = [];
  // Walk by section. Tiny TOML parser — we only care about the
  // `[dependencies]` and `[dev-dependencies]` blocks at the top level.
  const lines = body.split(/\r?\n/);
  let section: "dep" | "dev" | "other" = "other";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      if (line === "[dependencies]") section = "dep";
      else if (line === "[dev-dependencies]") section = "dev";
      else section = "other";
      continue;
    }
    if (section === "other") continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const depName = line.slice(0, eq).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(depName)) continue;
    out.push({
      name: depName,
      manifest: name,
      ecosystem: "cargo",
      isDev: section === "dev",
    });
  }
  return out;
}

function parsePubspec(body: string, name: string): ManifestDep[] {
  // Lightweight YAML walker — only goes 1 level deep, which is enough
  // for `dependencies:` + `dev_dependencies:` mappings in pubspec.
  const out: ManifestDep[] = [];
  const lines = body.split(/\r?\n/);
  let section: "dep" | "dev" | "other" = "other";
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    // Top-level key (no leading whitespace).
    if (!/^\s/.test(raw)) {
      const m = /^([a-zA-Z_][\w]*)\s*:/.exec(raw);
      if (!m) {
        section = "other";
        continue;
      }
      const key = m[1] ?? "";
      if (key === "dependencies") section = "dep";
      else if (key === "dev_dependencies") section = "dev";
      else section = "other";
      continue;
    }
    if (section === "other") continue;
    // Indented — `^  pkg_name:` or `^  pkg_name: ^1.0.0`.
    const m = /^\s+([a-zA-Z_][\w]*):/.exec(raw);
    if (!m) continue;
    const depName = m[1] ?? "";
    if (depName === "flutter" || depName === "sdk") continue;
    out.push({
      name: depName,
      manifest: name,
      ecosystem: "pub",
      isDev: section === "dev",
    });
  }
  return out;
}

function parsePyproject(body: string, name: string): ManifestDep[] {
  const out: ManifestDep[] = [];
  const lines = body.split(/\r?\n/);
  let section: "poetry" | "poetry-dev" | "project" | "other" = "other";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      if (line === "[tool.poetry.dependencies]") section = "poetry";
      else if (
        line === "[tool.poetry.group.dev.dependencies]" ||
        line === "[tool.poetry.dev-dependencies]"
      )
        section = "poetry-dev";
      else if (line === "[project]") section = "project";
      else section = "other";
      continue;
    }
    if (section === "poetry" || section === "poetry-dev") {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const depName = line.slice(0, eq).trim();
      if (depName.toLowerCase() === "python") continue;
      if (!/^[a-zA-Z0-9_.-]+$/.test(depName)) continue;
      out.push({
        name: depName,
        manifest: name,
        ecosystem: "pypi",
        isDev: section === "poetry-dev",
      });
    }
    // `[project] dependencies = ["foo>=1.0", "bar"]` — handled below
    // as a fallback parse if needed; rare enough we can skip for v1.
  }
  return out;
}

function parseRequirements(body: string, name: string): ManifestDep[] {
  const out: ManifestDep[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const m = /^([A-Za-z0-9_.-]+)/.exec(line);
    if (!m) continue;
    out.push({
      name: m[1] ?? "",
      manifest: name,
      ecosystem: "pypi",
      isDev: false,
    });
  }
  return out;
}

function parseGoMod(body: string, name: string): ManifestDep[] {
  const out: ManifestDep[] = [];
  // Two valid shapes: single-line `require foo v1.0.0` or block
  //   require (
  //     foo v1.0.0
  //     bar v2.0.0
  //   )
  let inBlock = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("require (")) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line === ")") {
        inBlock = false;
        continue;
      }
      const m = /^([A-Za-z0-9./_-]+)\s/.exec(line);
      if (m && m[1]) {
        out.push({
          name: m[1],
          manifest: name,
          ecosystem: "go",
          isDev: false,
        });
      }
      continue;
    }
    const m = /^require\s+([A-Za-z0-9./_-]+)\s/.exec(line);
    if (m && m[1]) {
      out.push({ name: m[1], manifest: name, ecosystem: "go", isDev: false });
    }
  }
  return out;
}

function parseGemfile(body: string, name: string): ManifestDep[] {
  const out: ManifestDep[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^gem\s+['"]([A-Za-z0-9_-]+)['"]/.exec(line);
    if (m && m[1]) {
      out.push({
        name: m[1],
        manifest: name,
        ecosystem: "ruby",
        isDev: false,
      });
    }
  }
  return out;
}

function parsePackageSwift(body: string, name: string): ManifestDep[] {
  // .package(url: "https://github.com/foo/Bar", from: "1.0.0")
  const out: ManifestDep[] = [];
  const re = /\.package\([^)]*url:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const url = m[1] ?? "";
    const last = url.split("/").pop() ?? "";
    const cleaned = last.replace(/\.git$/, "");
    if (!cleaned) continue;
    out.push({
      name: cleaned,
      manifest: name,
      ecosystem: "swift",
      isDev: false,
    });
  }
  return out;
}

function parseComposerJson(body: string, name: string): ManifestDep[] {
  let json: {
    require?: Record<string, string>;
    "require-dev"?: Record<string, string>;
  };
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  const out: ManifestDep[] = [];
  for (const [n, _v] of Object.entries(json.require ?? {})) {
    if (n === "php") continue;
    out.push({ name: n, manifest: name, ecosystem: "php", isDev: false });
  }
  for (const [n, _v] of Object.entries(json["require-dev"] ?? {})) {
    out.push({ name: n, manifest: name, ecosystem: "php", isDev: true });
  }
  return out;
}
