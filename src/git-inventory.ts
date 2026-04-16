import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";

const execFileAsync = promisify(execFile);

const BIG_BUFFER = 50 * 1024 * 1024;
const HUGE_BUFFER = 400 * 1024 * 1024;
const INVENTORY_TIMEOUT = 180_000;
const PARSE_TIMEOUT = 300_000;
const MAX_USER_COMMITS_RENDERED = 10_000;
const MAX_OWNERSHIP_ENTRIES_SHOWN = 400;
const MAX_FOLLOWUPS_SHOWN_PER_ENTRY = 6;
const SUBSTANTIVE_LOC_THRESHOLD = 50;
const FOLLOWUP_WINDOW_DAYS = 14;
const FOLLOWUP_WINDOW_MS = FOLLOWUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const COMMIT_DELIM = "|||";
const COMMIT_SENTINEL = "__GITSHOW_COMMIT__";
const DELETION_SENTINEL = "__GITSHOW_DELETE__";
const FILE_LIFECYCLE_SENTINEL = "__GITSHOW_FLC__";

/**
 * Threshold that separates "durable replacement" from "ephemeral rewrite".
 * A user-authored file that lived in production ≥180 days before being
 * replaced/deleted shipped to users long enough to do its job. Replacement
 * after this threshold is product evolution, NOT a durability failure.
 *
 * Replacement within <180 days signals the original code was incomplete,
 * rushed, or buggy and needed urgent fixes — that IS a durability failure.
 */
const DURABLE_THRESHOLD_DAYS = 180;

// Patterns for generated, vendored, or non-code files that shouldn't count
// as "user authorship" for durability / language-shipped / top-files signals.
const GENERATED_FILE_PATTERNS: RegExp[] = [
  // Lockfiles
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|poetry\.lock|mix\.lock|Podfile\.lock)$/,
  // Well-known auto-generated .d.ts
  /(^|\/)(worker-configuration|next-env|vite-env)\.d\.ts$/,
  /\.generated\.(ts|tsx|js|jsx|d\.ts)$/,
  // Compiled / bundled artifacts
  /\.min\.(js|css|html)$/,
  /\.(pb|proto)\.(go|ts|js)$/,
  /_pb\.(ts|js|py|go)$/,
  // Build/dist/vendor dirs
  /(^|\/)(dist|build|out|target|\.next|\.nuxt|coverage|node_modules|vendor|__pycache__)\//,
  // Drizzle / Prisma / similar migration snapshots (generated)
  /\/migrations\/meta\//,
  /\/migrations\/.*_snapshot\.json$/,
  /\/prisma\/migrations\/.*\/migration\.sql$/,
  // Binary / data files (not code)
  /\.(pyc|pyo|o|a|so|dylib|dll|exe|class|jar|war)$/,
  /\.(png|jpe?g|gif|svg|ico|webp|avif|mp3|mp4|mov|webm|wav|ogg)$/,
  /\.(ttf|otf|woff2?|eot)$/,
  /\.(csv|tsv|parquet|sqlite|db)$/,
];

function isGeneratedOrVendored(path: string): boolean {
  return GENERATED_FILE_PATTERNS.some((p) => p.test(path));
}

// ---------- small helpers ----------

async function run(repoPath: string, command: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("/bin/bash", ["-c", command], {
      cwd: repoPath,
      maxBuffer: BIG_BUFFER,
      timeout: INVENTORY_TIMEOUT,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

function parseIntOrZero(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Evenly distribute a sample of N items from an array, preserving the
 * temporal range (if the input is sorted by time, the output spans the
 * full range). Used for ownership-matrix sampling so we don't collapse to
 * only-recent-entries when there are more matrix entries than display room.
 */
function evenlySampledSlice<T>(items: T[], targetCount: number): T[] {
  if (items.length <= targetCount) return items.slice();
  const step = items.length / targetCount;
  const out: T[] = [];
  for (let i = 0; i < targetCount; i++) {
    out.push(items[Math.floor(i * step)]!);
  }
  return out;
}

// ---------- types ----------

export interface GitIdentity {
  name: string;
  email: string;
  commits: number;
}

export interface FileChange {
  path: string;
  insertions: number;
  deletions: number;
}

export interface ParsedCommit {
  sha: string;
  shortSha: string;
  authorName: string;
  email: string;
  timestampMs: number;
  dateStr: string;
  subject: string;
  files: FileChange[];
  totalInsertions: number;
  totalDeletions: number;
}

export type CommitCategory =
  | "feature"
  | "bugfix"
  | "refactor"
  | "test"
  | "infra"
  | "docs"
  | "chore"
  | "noise";

export interface HeuristicClassification {
  category: CommitCategory;
  meaningful: boolean;
}

export interface OwnershipEntry {
  userCommit: ParsedCommit;
  category: CommitCategory;
  followups: ParsedCommit[];
}

export interface BlameEntry {
  file: string;
  totalLines: number;
  userLines: number;
  ratio: number;
}

export interface OwnershipStats {
  substantiveCommits: number;
  withFollowups: number;
  withoutFollowups: number;
  totalFollowups: number;
}

/** A commit that deleted one or more files from the repo. */
export interface DeletionEvent {
  sha: string;
  shortSha: string;
  authorName: string;
  email: string;
  timestampMs: number;
  dateStr: string;
  subject: string;
}

/** Lifecycle entry for a top-50 user file that no longer exists at HEAD. */
export interface DeletedFileEntry {
  filePath: string;
  userLocAdded: number;
  userFirstTouchSha: string | null;
  userFirstTouchDate: string | null;
  deletionSha: string;
  deletionDate: string;
  deletionAuthor: string;
  deletionSubject: string;
  lifetimeDays: number;
  durable: boolean;
}

export interface DeletedFilesStats {
  totalDeletedInTop50: number;
  durableCount: number;
  ephemeralCount: number;
  durableUserLocEstimate: number;
  ephemeralUserLocEstimate: number;
}

/**
 * Per-file precise line lifecycle, computed by replaying `git log --follow
 * --numstat` chronologically and maintaining a FIFO user-line batch queue.
 *
 * Every insertion and deletion is apportioned between the user and non-user
 * contributors based on the current ratio of live lines. User lines consumed
 * by non-user deletions are classified as durable (≥180 days alive) or
 * ephemeral (<180 days). User lines consumed by the user's own deletions are
 * classified as self-refactor and don't count in either direction.
 */
export interface FileLineLifecycle {
  filePath: string;
  /** Total lines the user has ever authored into this file, across all their commits. */
  totalUserInsertions: number;
  /** User lines still alive at the end of the replay (matches blame approximately). */
  userLinesSurvivingEstimate: number;
  /** User lines consumed by non-user deletions after ≥180 days alive. */
  durableUserLines: number;
  /** User lines consumed by non-user deletions within <180 days. */
  ephemeralUserLines: number;
  /** User lines consumed by the user's own subsequent deletions (self-refactor, not a durability signal). */
  selfRefactoredUserLines: number;
  /** Number of distinct commits by the user on this file. */
  userCommitsOnFile: number;
  /** Number of distinct commits by non-user authors on this file. */
  nonUserCommitsOnFile: number;
  /** First date the user touched this file (earliest commit). */
  firstUserDate: string | null;
  /** Most recent date the user touched this file. */
  lastUserDate: string | null;
  /** Total commits processed (for confidence weighting). */
  totalCommitsReplayed: number;
}

export interface SurvivingFilesLifecycleStats {
  totalFilesAnalyzed: number;
  aggregateUserInsertions: number;
  aggregateSurvivingEstimate: number;
  aggregateDurable: number;
  aggregateEphemeral: number;
  aggregateSelfRefactored: number;
  /** Suggested raw durability score from surviving files alone (ignoring deleted files). */
  rawDurabilityScore: number | null;
}

export interface Inventory {
  repoPath: string;
  repoName: string;
  isGitRepo: boolean;

  totalCommitsAll: number;
  totalContributors: number;
  topContributors: string;

  resolvedIdentity: GitIdentity | null;
  userCommitCount: number;

  /** Number of commits by ANY non-user contributor, across all refs. */
  nonUserCommitCount: number;

  /** True if the user was one of the first 3 committers with <20 pre-existing commits. */
  userIsEarlyCommitter: boolean;

  firstCommit: string;
  lastCommit: string;
  activeDays: number;

  userCommits: string;
  userCommitsOverflow: boolean;

  topUserFiles: string;
  languageLoc: string;
  topLevelDirs: string;
  fileExtensions: string;

  blameRendered: string;
  ownershipMatrixRendered: string;
  ownershipStats: OwnershipStats;

  deletedFilesRendered: string;
  deletedFilesStats: DeletedFilesStats;

  survivingFilesLifecycleRendered: string;
  survivingFilesLifecycleStats: SurvivingFilesLifecycleStats;

  remotes: string;
}

// ---------- git log parser ----------

async function parseAllCommits(repoPath: string): Promise<ParsedCommit[]> {
  const fmt = `${COMMIT_SENTINEL}%H${COMMIT_DELIM}%h${COMMIT_DELIM}%an${COMMIT_DELIM}%ae${COMMIT_DELIM}%at${COMMIT_DELIM}%ad${COMMIT_DELIM}%s`;

  let raw: string;
  try {
    const { stdout } = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        `git log --all --pretty=format:'${fmt}' --date=short --numstat 2>/dev/null`,
      ],
      {
        cwd: repoPath,
        maxBuffer: HUGE_BUFFER,
        timeout: PARSE_TIMEOUT,
      }
    );
    raw = stdout;
  } catch {
    return [];
  }

  if (!raw) return [];

  const chunks = raw.split(COMMIT_SENTINEL).filter((c) => c.trim() !== "");
  const commits: ParsedCommit[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n").filter((l) => l !== "");
    if (lines.length === 0) continue;

    const header = lines[0]!;
    const parts = header.split(COMMIT_DELIM);
    if (parts.length < 7) continue;

    const sha = parts[0]!;
    const shortSha = parts[1]!;
    const name = parts[2]!;
    const email = parts[3]!;
    const ts = parts[4]!;
    const date = parts[5]!;
    const subject = parts.slice(6).join(COMMIT_DELIM).slice(0, 300);

    const files: FileChange[] = [];
    let totalIns = 0;
    let totalDel = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      const m = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      const insRaw = m[1]!;
      const delRaw = m[2]!;
      const path = m[3]!;
      const ins = insRaw === "-" ? 0 : parseIntOrZero(insRaw);
      const del = delRaw === "-" ? 0 : parseIntOrZero(delRaw);
      totalIns += ins;
      totalDel += del;
      files.push({ path, insertions: ins, deletions: del });
    }

    commits.push({
      sha,
      shortSha,
      authorName: name,
      email,
      timestampMs: parseInt(ts, 10) * 1000,
      dateStr: date,
      subject,
      files,
      totalInsertions: totalIns,
      totalDeletions: totalDel,
    });
  }

  return commits;
}

/**
 * Parse `git log --all --diff-filter=D --name-only` to build a map of
 * file_path → most recent deletion event for that path. Used to figure out
 * when each top-50 user file was deleted and by whom.
 */
async function parseAllDeletionEvents(
  repoPath: string
): Promise<Map<string, DeletionEvent>> {
  const fmt = `${DELETION_SENTINEL}%H${COMMIT_DELIM}%h${COMMIT_DELIM}%an${COMMIT_DELIM}%ae${COMMIT_DELIM}%at${COMMIT_DELIM}%ad${COMMIT_DELIM}%s`;

  let raw: string;
  try {
    const { stdout } = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        `git log --all --diff-filter=D --name-only --pretty=format:'${fmt}' --date=short 2>/dev/null`,
      ],
      {
        cwd: repoPath,
        maxBuffer: HUGE_BUFFER,
        timeout: PARSE_TIMEOUT,
      }
    );
    raw = stdout;
  } catch {
    return new Map();
  }

  if (!raw) return new Map();

  const map = new Map<string, DeletionEvent>();
  const chunks = raw.split(DELETION_SENTINEL).filter((c) => c.trim() !== "");

  // git log returns newest first, so we iterate in that order. For each file
  // path, the FIRST deletion event we see is the most recent one — we only
  // set the map entry if not already present.
  for (const chunk of chunks) {
    const lines = chunk.split("\n").filter((l) => l !== "");
    if (lines.length === 0) continue;

    const header = lines[0]!;
    const parts = header.split(COMMIT_DELIM);
    if (parts.length < 7) continue;

    const event: DeletionEvent = {
      sha: parts[0]!,
      shortSha: parts[1]!,
      authorName: parts[2]!,
      email: parts[3]!,
      timestampMs: parseInt(parts[4]!, 10) * 1000,
      dateStr: parts[5]!,
      subject: parts.slice(6).join(COMMIT_DELIM).slice(0, 200),
    };

    for (let i = 1; i < lines.length; i++) {
      const filePath = lines[i]!.trim();
      if (!filePath) continue;
      if (!map.has(filePath)) {
        map.set(filePath, event);
      }
    }
  }

  return map;
}

// ---------- heuristic commit classification ----------

const LOCK_PATTERN =
  /(package-lock\.json|yarn\.lock|bun\.lockb|pnpm-lock\.yaml|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|poetry\.lock)/;

function classifyCommitHeuristic(commit: ParsedCommit): HeuristicClassification {
  const subject = commit.subject;
  const lower = subject.toLowerCase();
  const total = commit.totalInsertions + commit.totalDeletions;

  if (/^merge\b/i.test(subject) || /^merge pull request/i.test(subject)) {
    return { category: "chore", meaningful: false };
  }

  if (
    commit.files.length > 0 &&
    commit.files.every((f) => LOCK_PATTERN.test(f.path))
  ) {
    return { category: "chore", meaningful: false };
  }

  if (
    commit.files.length > 0 &&
    commit.files.every((f) => isGeneratedOrVendored(f.path))
  ) {
    return { category: "chore", meaningful: false };
  }

  const prefixRe = /^([a-z]+)(\([^)]+\))?\s*!?\s*:/i;
  const prefixMatch = subject.match(prefixRe);
  if (prefixMatch) {
    const prefix = prefixMatch[1]!.toLowerCase();
    switch (prefix) {
      case "feat":
      case "feature":
        return { category: "feature", meaningful: total >= 10 };
      case "fix":
      case "hotfix":
        return { category: "bugfix", meaningful: total >= 3 };
      case "refactor":
      case "refac":
        return { category: "refactor", meaningful: true };
      case "test":
      case "tests":
        return { category: "test", meaningful: true };
      case "perf":
        return { category: "refactor", meaningful: true };
      case "chore":
      case "style":
      case "lint":
      case "format":
        return { category: "chore", meaningful: false };
      case "docs":
      case "doc":
        return { category: "docs", meaningful: false };
      case "ci":
      case "build":
      case "deploy":
      case "release":
      case "infra":
        return { category: "infra", meaningful: total >= 10 };
    }
  }

  if (/\bhotfix\b/i.test(lower) || /\bbugfix\b/i.test(lower)) {
    return { category: "bugfix", meaningful: true };
  }
  if (/\brevert\b/i.test(lower)) {
    return { category: "bugfix", meaningful: true };
  }
  if (/\b(add|added|implement|introduce|feat|feature)\b/i.test(lower)) {
    return { category: "feature", meaningful: total >= 10 };
  }
  if (/\b(fix|fixed|fixes|bug)\b/i.test(lower)) {
    return { category: "bugfix", meaningful: total >= 3 };
  }
  if (/\b(refactor|rewrite|restructure|cleanup)\b/i.test(lower)) {
    return { category: "refactor", meaningful: true };
  }
  if (/\b(test|tests|spec|specs)\b/i.test(lower)) {
    return { category: "test", meaningful: true };
  }
  if (/\b(deploy|build|ci|release)\b/i.test(lower)) {
    return { category: "infra", meaningful: total >= 10 };
  }
  if (/\b(docs?|readme)\b/i.test(lower)) {
    return { category: "docs", meaningful: false };
  }

  if (total >= 50) return { category: "feature", meaningful: true };
  if (total >= 10) return { category: "chore", meaningful: true };
  return { category: "noise", meaningful: false };
}

// ---------- identity resolution ----------

async function resolveGitIdentity(
  repoPath: string,
  handle: string
): Promise<GitIdentity | null> {
  const shortlog = await run(repoPath, "git shortlog -sne --all");
  if (!shortlog) return null;

  const entries = shortlog
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s*(\d+)\s+(.+?)\s+<(.+?)>\s*$/);
      if (!m) return null;
      return {
        commits: parseInt(m[1]!, 10),
        name: m[2]!,
        email: m[3]!,
      } as GitIdentity;
    })
    .filter((x): x is GitIdentity => x !== null);

  if (entries.length === 0) return null;

  const handleNorm = normalize(handle);
  const handleAlpha = handle
    .toLowerCase()
    .replace(/[0-9_\-.]+$/, "")
    .replace(/[^a-z]/g, "");

  const strategies: Array<{
    name: string;
    test: (e: GitIdentity) => boolean;
  }> = [
    {
      name: "full substring",
      test: (e) =>
        normalize(e.name).includes(handleNorm) ||
        normalize(e.email).includes(handleNorm),
    },
    {
      name: "handle contains name token",
      test: (e) => {
        const tokens = e.name
          .toLowerCase()
          .split(/\s+/)
          .map((t) => normalize(t))
          .filter((t) => t.length >= 3);
        return tokens.some((t) => handleNorm.includes(t));
      },
    },
    {
      name: "handle contains email local-part token",
      test: (e) => {
        const local = e.email.split("@")[0] ?? "";
        const localNorm = normalize(local);
        if (localNorm.length < 4) return false;
        return handleNorm.includes(localNorm) || localNorm.includes(handleNorm);
      },
    },
    {
      name: "alpha prefix substring",
      test: (e) => {
        if (!handleAlpha || handleAlpha.length < 3) return false;
        return (
          normalize(e.name).includes(handleAlpha) ||
          normalize(e.email).includes(handleAlpha)
        );
      },
    },
  ];

  for (const strategy of strategies) {
    const matches = entries.filter(strategy.test);
    if (matches.length > 0) {
      matches.sort((a, b) => b.commits - a.commits);
      return matches[0]!;
    }
  }

  return null;
}

// ---------- derived data from parsed commits ----------

function computeTopContributors(
  commits: ParsedCommit[],
  top: number
): Array<{ name: string; email: string; commits: number }> {
  const byKey = new Map<string, { name: string; email: string; commits: number }>();
  for (const c of commits) {
    const key = `${c.authorName}|${c.email}`;
    const existing = byKey.get(key);
    if (existing) existing.commits += 1;
    else byKey.set(key, { name: c.authorName, email: c.email, commits: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.commits - a.commits).slice(0, top);
}

function computeTopUserFiles(
  commits: ParsedCommit[],
  userEmail: string,
  top: number
): Array<{ file: string; insertions: number }> {
  const byFile = new Map<string, number>();
  for (const c of commits) {
    if (c.email !== userEmail) continue;
    for (const f of c.files) {
      if (isGeneratedOrVendored(f.path)) continue;
      byFile.set(f.path, (byFile.get(f.path) ?? 0) + f.insertions);
    }
  }
  return [...byFile.entries()]
    .filter(([, ins]) => ins > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([file, insertions]) => ({ file, insertions }));
}

function computeLanguageLoc(
  commits: ParsedCommit[],
  userEmail: string
): Array<{ extension: string; insertions: number }> {
  const byExt = new Map<string, number>();
  for (const c of commits) {
    if (c.email !== userEmail) continue;
    for (const f of c.files) {
      if (isGeneratedOrVendored(f.path)) continue;
      const lastSlash = f.path.lastIndexOf("/");
      const fileName = lastSlash >= 0 ? f.path.slice(lastSlash + 1) : f.path;
      const dotIdx = fileName.lastIndexOf(".");
      if (dotIdx <= 0) continue;
      const ext = fileName.slice(dotIdx + 1);
      if (!ext || ext.length > 10) continue;
      byExt.set(ext, (byExt.get(ext) ?? 0) + f.insertions);
    }
  }
  return [...byExt.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([extension, insertions]) => ({ extension, insertions }));
}

function renderUserCommitsList(
  commits: ParsedCommit[],
  userEmail: string,
  maxCommits: number
): { rendered: string; overflow: boolean; count: number } {
  const userCommits = commits
    .filter((c) => c.email === userEmail)
    .sort((a, b) => b.timestampMs - a.timestampMs);

  const count = userCommits.length;
  const overflow = count > maxCommits;
  const show = userCommits.slice(0, maxCommits);

  const lines = show.map((c) => {
    const cls = classifyCommitHeuristic(c);
    const m = cls.meaningful ? "meaningful" : "not";
    const subject = c.subject.slice(0, 120);
    return `${c.shortSha}|${c.dateStr}|${subject} [${c.files.length}f +${c.totalInsertions}/-${c.totalDeletions}] [${cls.category}/${m}]`;
  });

  return { rendered: lines.join("\n"), overflow, count };
}

// ---------- early-committer detection ----------

/**
 * Determine whether the user was an "early committer" — among the first 3
 * distinct authors AND the total commits before they joined was <20. This
 * covers the "Blake scaffolded 8 commits then you built the product" case
 * where `rampUpDays` is meaningless because there was no existing codebase.
 */
function detectEarlyCommitter(
  commits: ParsedCommit[],
  userEmail: string
): boolean {
  const sorted = [...commits].sort((a, b) => a.timestampMs - b.timestampMs);
  const userFirstIndex = sorted.findIndex((c) => c.email === userEmail);
  if (userFirstIndex < 0) return false;

  const beforeUser = sorted.slice(0, userFirstIndex);
  if (beforeUser.length >= 20) return false;

  const distinctAuthorsBefore = new Set(beforeUser.map((c) => c.email));
  return distinctAuthorsBefore.size <= 2;
}

// ---------- ownership matrix ----------

function buildOwnershipMatrix(
  allCommits: ParsedCommit[],
  userEmail: string
): OwnershipEntry[] {
  const sorted = [...allCommits].sort((a, b) => a.timestampMs - b.timestampMs);

  const substantive: Array<{
    commit: ParsedCommit;
    category: CommitCategory;
    index: number;
  }> = [];

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    if (c.email !== userEmail) continue;
    if (/^merge\b/i.test(c.subject) || /^merge pull request/i.test(c.subject))
      continue;

    const codeChanges = c.files.reduce((acc, f) => {
      if (isGeneratedOrVendored(f.path)) return acc;
      return acc + f.insertions + f.deletions;
    }, 0);
    if (codeChanges < SUBSTANTIVE_LOC_THRESHOLD) continue;

    const cls = classifyCommitHeuristic(c);
    if (!cls.meaningful) continue;
    if (cls.category === "chore" || cls.category === "noise") continue;

    substantive.push({ commit: c, category: cls.category, index: i });
  }

  const entries: OwnershipEntry[] = [];

  for (const { commit: uc, category, index: startIdx } of substantive) {
    const windowEnd = uc.timestampMs + FOLLOWUP_WINDOW_MS;
    const ucCodeFiles = new Set(
      uc.files.filter((f) => !isGeneratedOrVendored(f.path)).map((f) => f.path)
    );
    if (ucCodeFiles.size === 0) continue;

    const followups: ParsedCommit[] = [];

    for (let j = startIdx + 1; j < sorted.length; j++) {
      const other = sorted[j]!;
      if (other.timestampMs > windowEnd) break;
      if (other.email === userEmail) continue;
      if (/^merge\b/i.test(other.subject)) continue;

      const overlap = other.files.some(
        (f) => !isGeneratedOrVendored(f.path) && ucCodeFiles.has(f.path)
      );
      if (!overlap) continue;

      followups.push(other);
    }

    entries.push({ userCommit: uc, category, followups });
  }

  return entries;
}

function formatOwnershipMatrix(entries: OwnershipEntry[]): string {
  const lines: string[] = [];
  const withFollowups = entries.filter((e) => e.followups.length > 0);
  const withoutFollowups = entries.filter((e) => e.followups.length === 0);

  lines.push(`### Pre-computed ownership follow-up matrix`);
  lines.push(``);
  lines.push(
    `**Substantive user commits analyzed: ${entries.length}** (>${SUBSTANTIVE_LOC_THRESHOLD} LOC non-generated code, non-merge, non-chore by heuristic)`
  );
  lines.push(
    `  - with ≥1 non-user follow-up in next ${FOLLOWUP_WINDOW_DAYS} days: **${withFollowups.length}**`
  );
  lines.push(`  - with zero follow-ups: **${withoutFollowups.length}**`);
  lines.push(``);
  lines.push(
    `Each entry below is a user commit + all non-user commits within ${FOLLOWUP_WINDOW_DAYS} days that touched at least one overlapping code file.`
  );
  lines.push(
    `**Your job for each follow-up:** classify as \`cleanup\` (fixing/completing the prior commit) or \`collaboration\` (continued feature work or parallel development). Use \`git show <sha>\` via bash for ambiguous cases (batch 5-10 shas per call).`
  );
  lines.push(
    `**Scoring:** \`100 × (1 - cleanups / substantive_commits_analyzed)\`. Include zero-followup commits in the denominator — they're positive evidence.`
  );
  lines.push(``);

  // Time-distributed sampling so we cover the user's full history when there
  // are more entries than display slots, instead of collapsing to recent-only.
  // Budget: 320 slots for with-followups, 80 for without-followups.
  const WITH_SLOTS = 320;
  const WITHOUT_SLOTS = MAX_OWNERSHIP_ENTRIES_SHOWN - WITH_SLOTS;

  const withSortedByTime = [...withFollowups].sort(
    (a, b) => a.userCommit.timestampMs - b.userCommit.timestampMs
  );
  const withoutSortedByTime = [...withoutFollowups].sort(
    (a, b) => a.userCommit.timestampMs - b.userCommit.timestampMs
  );

  const withSampled = evenlySampledSlice(withSortedByTime, WITH_SLOTS);
  const withoutSampled = evenlySampledSlice(withoutSortedByTime, WITHOUT_SLOTS);

  const totalShownWith = withSampled.length;
  const totalShownWithout = withoutSampled.length;
  const hiddenWith = withFollowups.length - totalShownWith;
  const hiddenWithout = withoutFollowups.length - totalShownWithout;

  if (hiddenWith > 0 || hiddenWithout > 0) {
    lines.push(
      `*(Sampled view: showing ${totalShownWith}/${withFollowups.length} with-followup commits and ${totalShownWithout}/${withoutFollowups.length} zero-followup commits, evenly spaced across time to span the user's full history.)*`
    );
    lines.push(``);
  }

  // Interleave both sampled sets and present sorted by date (newest first for
  // readability) — the agent can still scan temporally even though presentation
  // is reverse-chronological.
  const combined = [...withSampled, ...withoutSampled].sort(
    (a, b) => b.userCommit.timestampMs - a.userCommit.timestampMs
  );

  for (const entry of combined) {
    const uc = entry.userCommit;
    const filePaths = uc.files.map((f) => f.path);
    const fileList =
      filePaths.slice(0, 5).join(", ") +
      (filePaths.length > 5 ? ` +${filePaths.length - 5}m` : "");

    lines.push(
      `#### ${uc.shortSha} ${uc.dateStr} [${uc.files.length}f +${uc.totalInsertions}/-${uc.totalDeletions}] [${entry.category}]`
    );
    lines.push(uc.subject.slice(0, 150));
    lines.push(`files: ${fileList}`);

    if (entry.followups.length === 0) {
      lines.push(`followups: none`);
    } else {
      lines.push(`followups (${entry.followups.length}):`);
      for (const fu of entry.followups.slice(0, MAX_FOLLOWUPS_SHOWN_PER_ENTRY)) {
        const daysAfter = Math.max(
          1,
          Math.round((fu.timestampMs - uc.timestampMs) / (24 * 60 * 60 * 1000))
        );
        lines.push(
          `  ${fu.shortSha} +${daysAfter}d ${fu.authorName}: ${fu.subject.slice(0, 120)} [${fu.files.length}f +${fu.totalInsertions}/-${fu.totalDeletions}]`
        );
      }
      if (entry.followups.length > MAX_FOLLOWUPS_SHOWN_PER_ENTRY) {
        lines.push(
          `  ... +${entry.followups.length - MAX_FOLLOWUPS_SHOWN_PER_ENTRY} more`
        );
      }
    }
    lines.push(``);
  }

  return lines.join("\n");
}

function computeOwnershipStats(entries: OwnershipEntry[]): OwnershipStats {
  let totalFollowups = 0;
  let withFollowups = 0;
  for (const e of entries) {
    totalFollowups += e.followups.length;
    if (e.followups.length > 0) withFollowups += 1;
  }
  return {
    substantiveCommits: entries.length,
    withFollowups,
    withoutFollowups: entries.length - withFollowups,
    totalFollowups,
  };
}

// ---------- durability blame ----------

async function blameFile(
  repoPath: string,
  filePath: string,
  userEmail: string
): Promise<BlameEntry | null> {
  try {
    const { stdout } = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        `git blame --line-porcelain HEAD -- ${shellSingleQuote(filePath)} 2>/dev/null`,
      ],
      {
        cwd: repoPath,
        maxBuffer: BIG_BUFFER,
        timeout: 120_000,
      }
    );

    const lines = stdout.split("\n");
    const authorMailLines = lines.filter((l) => l.startsWith("author-mail "));
    const total = authorMailLines.length;
    if (total === 0) return null;

    const userMatch = `<${userEmail}>`;
    const userLines = authorMailLines.filter((l) => l.includes(userMatch)).length;
    return {
      file: filePath,
      totalLines: total,
      userLines,
      ratio: userLines / total,
    };
  } catch {
    return null;
  }
}

async function computeBlameEntries(
  repoPath: string,
  files: string[],
  userEmail: string
): Promise<BlameEntry[]> {
  const results = await Promise.all(
    files.map((file) => blameFile(repoPath, file, userEmail))
  );
  return results.filter((x): x is BlameEntry => x !== null);
}

function formatBlameTable(entries: BlameEntry[]): string {
  const lines: string[] = [];
  lines.push(`### Pre-computed durability blame — top user files still at HEAD`);
  lines.push(``);
  lines.push(
    `Format: \`survival% | user_lines / total_lines | file\` — only files that still exist at HEAD.`
  );
  lines.push(
    `This is raw blame attribution at HEAD (no copy detection). Interpretation:`
  );
  lines.push(`- **100%** = nobody else has touched the user's lines yet.`);
  lines.push(
    `- **60%** = 40% of the file is by other authors — could be additive features (does NOT count against durability) OR genuine rewrites. Investigate via \`git log --follow <file>\` + \`git show <sha>\` on the replacing commits.`
  );
  lines.push(
    `- **If a top-50 file is MISSING from this table**, it was deleted — see the "deleted top-50 file lifecycle" section below for those.`
  );
  lines.push(``);
  lines.push("```");
  if (entries.length === 0) {
    lines.push("(no blame data)");
  } else {
    for (const e of entries) {
      const pct = Math.round(e.ratio * 100);
      lines.push(
        `${pct.toString().padStart(3, " ")}% | ${e.userLines.toString().padStart(5, " ")}/${e.totalLines.toString().padStart(5, " ")} | ${e.file}`
      );
    }
  }
  lines.push("```");
  return lines.join("\n");
}

// ---------- deleted file lifecycle ----------

function findUserFirstTouch(
  commits: ParsedCommit[],
  userEmail: string,
  filePath: string
): ParsedCommit | null {
  let earliest: ParsedCommit | null = null;
  for (const c of commits) {
    if (c.email !== userEmail) continue;
    if (!c.files.some((f) => f.path === filePath)) continue;
    if (!earliest || c.timestampMs < earliest.timestampMs) earliest = c;
  }
  return earliest;
}

function buildDeletedFilesLifecycle(
  topUserFiles: Array<{ file: string; insertions: number }>,
  blameEntries: BlameEntry[],
  deletionMap: Map<string, DeletionEvent>,
  allCommits: ParsedCommit[],
  userEmail: string
): { entries: DeletedFileEntry[]; stats: DeletedFilesStats } {
  const blamedFiles = new Set(blameEntries.map((b) => b.file));
  const entries: DeletedFileEntry[] = [];

  for (const tf of topUserFiles) {
    if (blamedFiles.has(tf.file)) continue;

    const deletion = deletionMap.get(tf.file);
    if (!deletion) continue;

    const firstTouch = findUserFirstTouch(allCommits, userEmail, tf.file);
    if (!firstTouch) {
      // User didn't touch this file — shouldn't happen if the top-50 list
      // was built from user insertions, but skip defensively.
      continue;
    }

    const lifetimeMs = deletion.timestampMs - firstTouch.timestampMs;
    const lifetimeDays = Math.max(
      0,
      Math.round(lifetimeMs / (24 * 60 * 60 * 1000))
    );
    const durable = lifetimeDays >= DURABLE_THRESHOLD_DAYS;

    entries.push({
      filePath: tf.file,
      userLocAdded: tf.insertions,
      userFirstTouchSha: firstTouch.shortSha,
      userFirstTouchDate: firstTouch.dateStr,
      deletionSha: deletion.shortSha,
      deletionDate: deletion.dateStr,
      deletionAuthor: deletion.authorName,
      deletionSubject: deletion.subject,
      lifetimeDays,
      durable,
    });
  }

  const durableEntries = entries.filter((e) => e.durable);
  const ephemeralEntries = entries.filter((e) => !e.durable);

  return {
    entries,
    stats: {
      totalDeletedInTop50: entries.length,
      durableCount: durableEntries.length,
      ephemeralCount: ephemeralEntries.length,
      durableUserLocEstimate: durableEntries.reduce(
        (s, e) => s + e.userLocAdded,
        0
      ),
      ephemeralUserLocEstimate: ephemeralEntries.reduce(
        (s, e) => s + e.userLocAdded,
        0
      ),
    },
  };
}

// ---------- per-file line lifecycle (FIFO batch tracker) ----------

interface FileCommitEvent {
  sha: string;
  shortSha: string;
  timestampMs: number;
  email: string;
  authorName: string;
  subject: string;
  insertions: number;
  deletions: number;
}

async function getFileCommitHistory(
  repoPath: string,
  filePath: string
): Promise<FileCommitEvent[]> {
  const fmt = `${FILE_LIFECYCLE_SENTINEL}%H${COMMIT_DELIM}%h${COMMIT_DELIM}%at${COMMIT_DELIM}%ae${COMMIT_DELIM}%an${COMMIT_DELIM}%s`;

  let raw: string;
  try {
    const { stdout } = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        `git log --follow --no-merges --pretty=format:'${fmt}' --numstat -- ${shellSingleQuote(filePath)} 2>/dev/null`,
      ],
      {
        cwd: repoPath,
        maxBuffer: BIG_BUFFER,
        timeout: 60_000,
      }
    );
    raw = stdout;
  } catch {
    return [];
  }

  if (!raw) return [];

  const events: FileCommitEvent[] = [];
  const chunks = raw.split(FILE_LIFECYCLE_SENTINEL).filter((c) => c.trim() !== "");

  for (const chunk of chunks) {
    const lines = chunk.split("\n").filter((l) => l !== "");
    if (lines.length === 0) continue;

    const header = lines[0]!;
    const parts = header.split(COMMIT_DELIM);
    if (parts.length < 6) continue;

    const sha = parts[0]!;
    const shortSha = parts[1]!;
    const ts = parts[2]!;
    const email = parts[3]!;
    const name = parts[4]!;
    const subject = parts.slice(5).join(COMMIT_DELIM).slice(0, 200);

    let insertions = 0;
    let deletions = 0;

    // For a single-file log, each commit has one numstat line (or zero if
    // the file wasn't touched in a rename-only commit, or "- -" for binary).
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      const m = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      const insRaw = m[1]!;
      const delRaw = m[2]!;
      insertions += insRaw === "-" ? 0 : parseIntOrZero(insRaw);
      deletions += delRaw === "-" ? 0 : parseIntOrZero(delRaw);
    }

    events.push({
      sha,
      shortSha,
      timestampMs: parseInt(ts, 10) * 1000,
      email,
      authorName: name,
      subject,
      insertions,
      deletions,
    });
  }

  return events;
}

/**
 * Replay a file's commit history chronologically, maintaining a FIFO queue
 * of user-authored line batches with their author timestamps. When non-user
 * deletions occur, apportion them proportionally between user and non-user
 * live lines, and classify consumed user lines as durable (≥180 days alive)
 * or ephemeral (<180 days). User's own deletions are classified as self-refactor.
 *
 * This is an approximation: it doesn't know WHICH specific lines were
 * deleted, only the counts. FIFO across user batches means older user lines
 * die first, which biases the score slightly more pessimistic than truth.
 * Proportional apportionment between user/non-user is more accurate than
 * assuming all deletions hit user lines.
 */
export async function analyzeFileLineLifecycle(
  repoPath: string,
  filePath: string,
  userEmail: string
): Promise<FileLineLifecycle | null> {
  const events = await getFileCommitHistory(repoPath, filePath);
  if (events.length === 0) return null;

  // Chronological order
  events.sort((a, b) => a.timestampMs - b.timestampMs);

  interface UserBatch {
    count: number;
    timestampMs: number;
  }

  const userBatches: UserBatch[] = [];
  let userLinesAlive = 0;
  let nonUserLinesAlive = 0;
  let totalUserInsertions = 0;
  let durableUserLines = 0;
  let ephemeralUserLines = 0;
  let selfRefactoredUserLines = 0;
  let userCommitsOnFile = 0;
  let nonUserCommitsOnFile = 0;
  let firstUserMs: number | null = null;
  let lastUserMs: number | null = null;

  const consumeFromUserBatches = (
    needed: number,
    nowMs: number,
    isSelf: boolean
  ): void => {
    let remaining = needed;
    while (remaining > 0 && userBatches.length > 0) {
      const batch = userBatches[0]!;
      const take = Math.min(batch.count, remaining);
      const ageDays = (nowMs - batch.timestampMs) / (24 * 60 * 60 * 1000);

      if (isSelf) {
        selfRefactoredUserLines += take;
      } else if (ageDays >= DURABLE_THRESHOLD_DAYS) {
        durableUserLines += take;
      } else {
        ephemeralUserLines += take;
      }

      batch.count -= take;
      remaining -= take;
      if (batch.count === 0) userBatches.shift();
    }
  };

  for (const event of events) {
    const isUser = event.email === userEmail;

    if (isUser) {
      userCommitsOnFile += 1;
      if (firstUserMs === null) firstUserMs = event.timestampMs;
      lastUserMs = event.timestampMs;
    } else {
      nonUserCommitsOnFile += 1;
    }

    // Process deletions first (old lines removed before new lines added)
    if (event.deletions > 0) {
      const total = userLinesAlive + nonUserLinesAlive;
      if (total > 0) {
        let userPortion = Math.round(
          (event.deletions * userLinesAlive) / total
        );
        userPortion = Math.max(0, Math.min(userPortion, userLinesAlive));
        const nonUserPortion = Math.min(
          nonUserLinesAlive,
          event.deletions - userPortion
        );

        if (userPortion > 0) {
          consumeFromUserBatches(userPortion, event.timestampMs, isUser);
          userLinesAlive -= userPortion;
        }
        nonUserLinesAlive -= nonUserPortion;
      }
    }

    // Then process insertions
    if (event.insertions > 0) {
      if (isUser) {
        userBatches.push({
          count: event.insertions,
          timestampMs: event.timestampMs,
        });
        userLinesAlive += event.insertions;
        totalUserInsertions += event.insertions;
      } else {
        nonUserLinesAlive += event.insertions;
      }
    }
  }

  const userLinesSurvivingEstimate = userBatches.reduce(
    (s, b) => s + b.count,
    0
  );

  return {
    filePath,
    totalUserInsertions,
    userLinesSurvivingEstimate,
    durableUserLines,
    ephemeralUserLines,
    selfRefactoredUserLines,
    userCommitsOnFile,
    nonUserCommitsOnFile,
    firstUserDate: firstUserMs
      ? new Date(firstUserMs).toISOString().slice(0, 10)
      : null,
    lastUserDate: lastUserMs
      ? new Date(lastUserMs).toISOString().slice(0, 10)
      : null,
    totalCommitsReplayed: events.length,
  };
}

async function computeSurvivingFileLifecycles(
  repoPath: string,
  files: string[],
  userEmail: string
): Promise<FileLineLifecycle[]> {
  // Run in parallel. 50 concurrent git processes is acceptable on modern
  // hardware and inventory is already the slowest phase. If this becomes a
  // bottleneck we can chunk into batches of 10.
  const results = await Promise.all(
    files.map((file) => analyzeFileLineLifecycle(repoPath, file, userEmail))
  );
  return results.filter((x): x is FileLineLifecycle => x !== null);
}

function computeSurvivingLifecycleStats(
  entries: FileLineLifecycle[]
): SurvivingFilesLifecycleStats {
  let aggregateUserInsertions = 0;
  let aggregateSurvivingEstimate = 0;
  let aggregateDurable = 0;
  let aggregateEphemeral = 0;
  let aggregateSelfRefactored = 0;

  for (const e of entries) {
    aggregateUserInsertions += e.totalUserInsertions;
    aggregateSurvivingEstimate += e.userLinesSurvivingEstimate;
    aggregateDurable += e.durableUserLines;
    aggregateEphemeral += e.ephemeralUserLines;
    aggregateSelfRefactored += e.selfRefactoredUserLines;
  }

  // Durability formula restricted to surviving files only:
  //   score = (surviving + durable) / (surviving + durable + ephemeral) × 100
  const denominator =
    aggregateSurvivingEstimate + aggregateDurable + aggregateEphemeral;
  const rawDurabilityScore =
    denominator > 0
      ? Math.round(
          ((aggregateSurvivingEstimate + aggregateDurable) / denominator) * 100
        )
      : null;

  return {
    totalFilesAnalyzed: entries.length,
    aggregateUserInsertions,
    aggregateSurvivingEstimate,
    aggregateDurable,
    aggregateEphemeral,
    aggregateSelfRefactored,
    rawDurabilityScore,
  };
}

function formatSurvivingFilesLifecycleTable(
  entries: FileLineLifecycle[],
  stats: SurvivingFilesLifecycleStats
): string {
  const lines: string[] = [];
  lines.push(`### Pre-computed per-file line lifecycle (surviving files)`);
  lines.push(``);

  if (entries.length === 0) {
    lines.push(`(no surviving file lifecycle data)`);
    return lines.join("\n");
  }

  lines.push(
    `**Files analyzed: ${stats.totalFilesAnalyzed}** (top-50 user files that still exist at HEAD)`
  );
  lines.push(``);
  lines.push(`Aggregate counts across these files:`);
  lines.push(
    `- **User insertions (total):** ${stats.aggregateUserInsertions.toLocaleString()} lines`
  );
  lines.push(
    `- **Surviving (FIFO estimate):** ${stats.aggregateSurvivingEstimate.toLocaleString()} lines`
  );
  lines.push(
    `- **Durable replaced** (non-user deletion after ≥${DURABLE_THRESHOLD_DAYS} days): ${stats.aggregateDurable.toLocaleString()} lines — **positive signal**`
  );
  lines.push(
    `- **Ephemeral rewrites** (non-user deletion within <${DURABLE_THRESHOLD_DAYS} days): ${stats.aggregateEphemeral.toLocaleString()} lines — **negative signal**`
  );
  lines.push(
    `- **Self-refactored** (user deleted their own old lines): ${stats.aggregateSelfRefactored.toLocaleString()} lines — excluded from durability`
  );
  if (stats.rawDurabilityScore !== null) {
    lines.push(
      `- **Raw durability score from surviving files alone:** ${stats.rawDurabilityScore} = (${(stats.aggregateSurvivingEstimate + stats.aggregateDurable).toLocaleString()} kept) / (${(stats.aggregateSurvivingEstimate + stats.aggregateDurable + stats.aggregateEphemeral).toLocaleString()} denom) × 100`
    );
  }
  lines.push(``);
  lines.push(
    `**How to combine with the deleted-file lifecycle table:** add the deleted-files' \`durableUserLocEstimate\` to the "kept" numerator and the \`ephemeralUserLocEstimate\` to the denominator. Then \`score = (kept + durable_from_deleted) / (kept + durable_from_deleted + ephemeral + ephemeral_from_deleted) × 100\`.`
  );
  lines.push(``);
  lines.push(
    `Per-file rows (sorted by user insertions desc). Format: \`file | user_ins | surviving / total_user_ins | durable | ephemeral | self | user_commits / nonuser_commits\`:`
  );
  lines.push("```");

  const sorted = [...entries].sort(
    (a, b) => b.totalUserInsertions - a.totalUserInsertions
  );

  for (const e of sorted) {
    const ins = e.totalUserInsertions.toString().padStart(5, " ");
    const surv = e.userLinesSurvivingEstimate.toString().padStart(5, " ");
    const dur = e.durableUserLines.toString().padStart(4, " ");
    const eph = e.ephemeralUserLines.toString().padStart(4, " ");
    const self = e.selfRefactoredUserLines.toString().padStart(4, " ");
    const uc = e.userCommitsOnFile.toString().padStart(3, " ");
    const nuc = e.nonUserCommitsOnFile.toString().padStart(3, " ");
    lines.push(
      `${ins} ins | ${surv}/${ins.trim()} surviving | durable:${dur} | ephem:${eph} | self:${self} | ${uc}u/${nuc}o | ${e.filePath}`
    );
  }

  lines.push("```");
  return lines.join("\n");
}

function formatDeletedFilesTable(
  entries: DeletedFileEntry[],
  stats: DeletedFilesStats
): string {
  const lines: string[] = [];
  lines.push(`### Pre-computed deleted top-50 file lifecycle`);
  lines.push(``);

  if (entries.length === 0) {
    lines.push(
      `All of the user's top 50 files by lines-added are still at HEAD. Nothing to report here — refer to the blame table above for durability.`
    );
    return lines.join("\n");
  }

  lines.push(
    `**${stats.totalDeletedInTop50} of the top 50 user files are deleted at HEAD.**`
  );
  lines.push(
    `- **Durable deletions** (lived ≥${DURABLE_THRESHOLD_DAYS} days in prod): **${stats.durableCount}** files, ~${stats.durableUserLocEstimate.toLocaleString()} user LOC added`
  );
  lines.push(
    `- **Ephemeral deletions** (lived <${DURABLE_THRESHOLD_DAYS} days): **${stats.ephemeralCount}** files, ~${stats.ephemeralUserLocEstimate.toLocaleString()} user LOC added`
  );
  lines.push(``);
  lines.push(
    `**CRITICAL for durability:** durable deletions are POSITIVE signals. The code lived in production long enough to do its job before being intentionally replaced — product pivots, feature retirements, framework upgrades, planned v2 rewrites of proven systems. **They should go into \`durableReplacedLines\`, NOT \`meaningfulRewrites\`.**`
  );
  lines.push(``);
  lines.push(
    `Only ephemeral deletions go into \`meaningfulRewrites\` — those represent code that was replaced quickly, indicating the original was incomplete or buggy.`
  );
  lines.push(``);
  lines.push(
    `Format: \`lifetime_days | durable|ephem | user_loc_added | file\``
  );
  lines.push("```");

  const sorted = [...entries].sort((a, b) => b.lifetimeDays - a.lifetimeDays);
  for (const e of sorted) {
    const tag = e.durable ? "durable " : "ephem   ";
    const days = e.lifetimeDays.toString().padStart(5, " ");
    const loc = e.userLocAdded.toString().padStart(6, " ");
    lines.push(`${days} | ${tag} | ${loc} | ${e.filePath}`);
    lines.push(
      `        ∟ first touch: ${e.userFirstTouchSha ?? "?"} ${e.userFirstTouchDate ?? "?"}; deleted: ${e.deletionSha} ${e.deletionDate} by ${e.deletionAuthor} "${e.deletionSubject.slice(0, 80)}"`
    );
  }
  lines.push("```");
  return lines.join("\n");
}

// ---------- top-level inventory gather ----------

export async function gatherInventory(
  repoPath: string,
  handle: string
): Promise<Inventory> {
  const isGitRepo = !!(await run(repoPath, "git rev-parse --git-dir"));

  if (!isGitRepo) {
    return emptyInventory(repoPath);
  }

  const [
    remotes,
    topLevelDirs,
    fileExtensions,
    resolvedIdentity,
    allCommits,
    deletionMap,
  ] = await Promise.all([
    run(repoPath, "git remote -v"),
    run(
      repoPath,
      "find . -maxdepth 2 -type d -not -path '*/.*' -not -path '*/node_modules*' -not -path '*/dist*' -not -path '*/build*' 2>/dev/null | head -40"
    ),
    run(
      repoPath,
      "git ls-files | awk -F. 'NF>1 {print $NF}' | sort | uniq -c | sort -rn | head -15"
    ),
    resolveGitIdentity(repoPath, handle),
    parseAllCommits(repoPath),
    parseAllDeletionEvents(repoPath),
  ]);

  const originLine = remotes.split("\n").find((l) => l.startsWith("origin")) ?? "";
  const repoNameMatch = originLine.match(/[:/]([^/\s]+\/[^/\s]+?)(\.git)?(\s|$)/);
  const repoName = repoNameMatch?.[1] ?? basename(repoPath);

  const totalCommitsAll = allCommits.length;
  const contribEntries = computeTopContributors(allCommits, 25);
  const totalContributors = new Set(
    allCommits.map((c) => `${c.authorName}|${c.email}`)
  ).size;
  const topContributors = contribEntries
    .map(
      (c) =>
        `${c.commits.toString().padStart(6, " ")}\t${c.name} <${c.email}>`
    )
    .join("\n");

  if (!resolvedIdentity) {
    return {
      repoPath,
      repoName,
      isGitRepo: true,
      totalCommitsAll,
      totalContributors,
      topContributors,
      resolvedIdentity: null,
      userCommitCount: 0,
      nonUserCommitCount: totalCommitsAll,
      userIsEarlyCommitter: false,
      firstCommit: "",
      lastCommit: "",
      activeDays: 0,
      userCommits: "",
      userCommitsOverflow: false,
      topUserFiles: "",
      languageLoc: "",
      topLevelDirs,
      fileExtensions,
      blameRendered: "### Pre-computed durability blame\n(unresolved identity)",
      ownershipMatrixRendered:
        "### Pre-computed ownership follow-up matrix\n(unresolved identity)",
      ownershipStats: {
        substantiveCommits: 0,
        withFollowups: 0,
        withoutFollowups: 0,
        totalFollowups: 0,
      },
      deletedFilesRendered:
        "### Pre-computed deleted file lifecycle\n(unresolved identity)",
      deletedFilesStats: {
        totalDeletedInTop50: 0,
        durableCount: 0,
        ephemeralCount: 0,
        durableUserLocEstimate: 0,
        ephemeralUserLocEstimate: 0,
      },
      survivingFilesLifecycleRendered:
        "### Pre-computed per-file line lifecycle\n(unresolved identity)",
      survivingFilesLifecycleStats: {
        totalFilesAnalyzed: 0,
        aggregateUserInsertions: 0,
        aggregateSurvivingEstimate: 0,
        aggregateDurable: 0,
        aggregateEphemeral: 0,
        aggregateSelfRefactored: 0,
        rawDurabilityScore: null,
      },
      remotes,
    };
  }

  const userEmail = resolvedIdentity.email;

  const userCommitsSorted = allCommits
    .filter((c) => c.email === userEmail)
    .sort((a, b) => b.timestampMs - a.timestampMs);

  const firstUserCommit = userCommitsSorted[userCommitsSorted.length - 1];
  const lastUserCommit = userCommitsSorted[0];
  const activeDays =
    firstUserCommit && lastUserCommit
      ? Math.max(
          0,
          Math.round(
            (lastUserCommit.timestampMs - firstUserCommit.timestampMs) /
              (24 * 60 * 60 * 1000)
          )
        )
      : 0;

  const firstCommitStr = firstUserCommit
    ? `${firstUserCommit.shortSha} ${firstUserCommit.dateStr} ${firstUserCommit.subject.slice(0, 100)}`
    : "";
  const lastCommitStr = lastUserCommit
    ? `${lastUserCommit.shortSha} ${lastUserCommit.dateStr} ${lastUserCommit.subject.slice(0, 100)}`
    : "";

  const nonUserCommitCount = totalCommitsAll - userCommitsSorted.length;
  const userIsEarlyCommitter = detectEarlyCommitter(allCommits, userEmail);

  const topFilesList = computeTopUserFiles(allCommits, userEmail, 50);
  const topUserFilesStr = topFilesList
    .map((t) => `${t.insertions}\t${t.file}`)
    .join("\n");

  const langList = computeLanguageLoc(allCommits, userEmail);
  const languageLocStr = langList
    .map((l) => `${l.insertions}\t${l.extension}`)
    .join("\n");

  const rendered = renderUserCommitsList(
    allCommits,
    userEmail,
    MAX_USER_COMMITS_RENDERED
  );

  const ownershipMatrix = buildOwnershipMatrix(allCommits, userEmail);
  const ownershipStats = computeOwnershipStats(ownershipMatrix);
  const ownershipMatrixRendered = formatOwnershipMatrix(ownershipMatrix);

  const blameEntries = await computeBlameEntries(
    repoPath,
    topFilesList.map((t) => t.file),
    userEmail
  );
  const blameRendered = formatBlameTable(blameEntries);

  const { entries: deletedFileEntries, stats: deletedFilesStats } =
    buildDeletedFilesLifecycle(
      topFilesList,
      blameEntries,
      deletionMap,
      allCommits,
      userEmail
    );
  const deletedFilesRendered = formatDeletedFilesTable(
    deletedFileEntries,
    deletedFilesStats
  );

  // Run per-file FIFO lifecycle analysis on the files that still exist at HEAD
  // (the ones in the blame table). This gives precise durable/ephemeral counts
  // for within-file rewrites, complementing the deleted-file lifecycle above.
  const survivingFilePaths = blameEntries.map((b) => b.file);
  const survivingFileLifecycles = await computeSurvivingFileLifecycles(
    repoPath,
    survivingFilePaths,
    userEmail
  );
  const survivingFilesLifecycleStats = computeSurvivingLifecycleStats(
    survivingFileLifecycles
  );
  const survivingFilesLifecycleRendered = formatSurvivingFilesLifecycleTable(
    survivingFileLifecycles,
    survivingFilesLifecycleStats
  );

  return {
    repoPath,
    repoName,
    isGitRepo: true,
    totalCommitsAll,
    totalContributors,
    topContributors,
    resolvedIdentity,
    userCommitCount: userCommitsSorted.length,
    nonUserCommitCount,
    userIsEarlyCommitter,
    firstCommit: firstCommitStr,
    lastCommit: lastCommitStr,
    activeDays,
    userCommits: rendered.rendered,
    userCommitsOverflow: rendered.overflow,
    topUserFiles: topUserFilesStr,
    languageLoc: languageLocStr,
    topLevelDirs,
    fileExtensions,
    blameRendered,
    ownershipMatrixRendered,
    ownershipStats,
    deletedFilesRendered,
    deletedFilesStats,
    survivingFilesLifecycleRendered,
    survivingFilesLifecycleStats,
    remotes,
  };
}

function emptyInventory(repoPath: string): Inventory {
  return {
    repoPath,
    repoName: basename(repoPath),
    isGitRepo: false,
    totalCommitsAll: 0,
    totalContributors: 0,
    topContributors: "",
    resolvedIdentity: null,
    userCommitCount: 0,
    nonUserCommitCount: 0,
    userIsEarlyCommitter: false,
    firstCommit: "",
    lastCommit: "",
    activeDays: 0,
    userCommits: "",
    userCommitsOverflow: false,
    topUserFiles: "",
    languageLoc: "",
    topLevelDirs: "",
    fileExtensions: "",
    blameRendered: "",
    ownershipMatrixRendered: "",
    ownershipStats: {
      substantiveCommits: 0,
      withFollowups: 0,
      withoutFollowups: 0,
      totalFollowups: 0,
    },
    deletedFilesRendered: "",
    deletedFilesStats: {
      totalDeletedInTop50: 0,
      durableCount: 0,
      ephemeralCount: 0,
      durableUserLocEstimate: 0,
      ephemeralUserLocEstimate: 0,
    },
    survivingFilesLifecycleRendered: "",
    survivingFilesLifecycleStats: {
      totalFilesAnalyzed: 0,
      aggregateUserInsertions: 0,
      aggregateSurvivingEstimate: 0,
      aggregateDurable: 0,
      aggregateEphemeral: 0,
      aggregateSelfRefactored: 0,
      rawDurabilityScore: null,
    },
    remotes: "",
  };
}

// ---------- format for agent ----------

export function formatInventoryForAgent(inv: Inventory): string {
  const lines: string[] = [];
  lines.push(`## Pre-scan inventory`);
  lines.push(``);
  lines.push(`**Repo:** ${inv.repoName}`);
  lines.push(`**Path:** ${inv.repoPath}`);
  lines.push(``);
  lines.push(
    `**Totals (all branches):** ${inv.totalCommitsAll} commits, ${inv.totalContributors} contributors`
  );
  lines.push(``);

  if (inv.resolvedIdentity) {
    lines.push(`### Resolved git identity for the handle`);
    lines.push(
      `${inv.resolvedIdentity.name} <${inv.resolvedIdentity.email}> — ${inv.userCommitCount} commits`
    );
    lines.push(`**Active window:** ${inv.firstCommit} → ${inv.lastCommit}`);
    lines.push(`**Active days:** ${inv.activeDays}`);
    lines.push(`**Non-user commits in repo:** ${inv.nonUserCommitCount}`);
    if (inv.userIsEarlyCommitter) {
      lines.push(
        `**⚠️  Early-committer flag:** the user was among the first 3 committers with <20 pre-existing commits. \`rampUpDays\` should be **null** — there was no meaningful existing codebase to ramp up into.`
      );
    }
  } else {
    lines.push(`### Could not resolve git identity for the handle`);
    lines.push(
      `Use the top contributors list below to find the right name/email, then use THAT for all user-specific git queries.`
    );
  }

  lines.push(``);
  lines.push(`### Top contributors (git shortlog -sne --all, top 25)`);
  lines.push(inv.topContributors || "(unavailable)");
  lines.push(``);
  lines.push(`### Top-level directories`);
  lines.push(inv.topLevelDirs || "(unavailable)");
  lines.push(``);
  lines.push(`### Repo file extensions (top 15 by count)`);
  lines.push(inv.fileExtensions || "(unavailable)");
  lines.push(``);

  if (inv.resolvedIdentity) {
    lines.push(`### User's top 50 files by lines-added (all branches, filtered)`);
    lines.push(`Format: \`lines_added\tpath\` — lockfiles/migrations/generated files filtered out.`);
    lines.push("```");
    lines.push(inv.topUserFiles || "(unavailable)");
    lines.push("```");
    lines.push(``);
    lines.push(`### User's language breakdown — lines added per extension`);
    lines.push(`Format: \`lines_added\textension\``);
    lines.push("```");
    lines.push(inv.languageLoc || "(unavailable)");
    lines.push("```");
    lines.push(``);
    lines.push(inv.blameRendered);
    lines.push(``);
    lines.push(inv.survivingFilesLifecycleRendered);
    lines.push(``);
    lines.push(inv.deletedFilesRendered);
    lines.push(``);
    lines.push(inv.ownershipMatrixRendered);
    lines.push(``);
    lines.push(
      `### Full user commit list — ${inv.userCommitCount} commits${inv.userCommitsOverflow ? ` (capped at ${MAX_USER_COMMITS_RENDERED}, more exist)` : ""}`
    );
    lines.push(
      `Format: \`sha|date|subject [Nf +ins/-del] [category/meaningful|not]\``
    );
    lines.push(
      `The \`[category/meaningful|not]\` tag is a **heuristic** classification — use it as a starting point but override it for ambiguous cases.`
    );
    lines.push("```");
    lines.push(inv.userCommits || "(none)");
    lines.push("```");
  }

  return lines.join("\n");
}
