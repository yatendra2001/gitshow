/**
 * Shared pipeline types used across all stages.
 *
 * These are plain TypeScript interfaces (not Zod schemas) for internal
 * pipeline plumbing. Zod schemas in schemas.ts handle agent I/O validation.
 */

// ---------- GitHub data types ----------

export interface GitHubProfile {
  login: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  avatarUrl: string | null;
  publicRepos: number;
  followers: number;
  following: number;
  createdAt: string;
}

export interface RepoRef {
  name: string;
  owner: string;
  fullName: string; // "owner/name"
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  description: string | null;
  primaryLanguage: string | null;
  languages: string[];
  stargazerCount: number;
  forkCount: number;
  pushedAt: string | null;
  createdAt: string | null;
  /** User's commit count in this repo (populated during filtering). */
  userCommitCount?: number;
  /** Significance score computed by repo-filter. */
  significanceScore?: number;
  /** Analysis tier assigned by repo-filter. */
  analysisTier?: AnalysisTier;
}

export interface GitHubPR {
  repoFullName: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  additions: number;
  deletions: number;
  changedFiles: number;
  merged: boolean;
  mergedAt: string | null;
  createdAt: string;
  closedAt: string | null;
  reviewDecision: string | null;
  /** Whether this PR is to a repo the user owns. */
  isExternal: boolean;
}

export interface GitHubReview {
  repoFullName: string;
  prNumber: number;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  body: string;
  submittedAt: string;
}

export interface GitHubEvent {
  type: string;
  repoFullName: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface GitHubData {
  profile: GitHubProfile;
  ownedRepos: RepoRef[];
  /** All known email addresses for the user (for identity resolution). */
  userEmails: string[];
  /** PRs authored by the user (both to own repos and external). */
  authoredPRs: GitHubPR[];
  /** Reviews the user has submitted on others' PRs. */
  submittedReviews: GitHubReview[];
  /** Recent public events. */
  recentEvents: GitHubEvent[];
}

// ---------- Repo filtering ----------

/**
 * Analysis tier determines how deeply we analyze each repo.
 * ALL repos are included in the profile — the tier controls depth, not inclusion.
 */
export type AnalysisTier = "deep" | "light" | "metadata";

export interface FilterResult {
  /** ALL repos, categorized by analysis tier. */
  deep: RepoRef[];      // >20 user commits, meaningful history → full clone + FIFO + agent
  light: RepoRef[];     // 2-20 commits, forks with some work → clone + basic inventory, no agent
  metadata: RepoRef[];  // 0-1 commits, archived forks → GitHub API data only
  /** External repos where the user has merged PRs. */
  external: RepoRef[];
}

// ---------- System mapping ----------

export interface SystemDef {
  name: string;
  description: string;
  repos: string[]; // repo fullNames
  archetype: string;
}

export interface SystemMapping {
  systems: SystemDef[];
  /** Repos that don't belong to any system. */
  standalone: string[];
}

// ---------- Structured inventory (from pre-compute) ----------

export interface StructuredBlameEntry {
  file: string;
  totalLines: number;
  userLines: number;
  ratio: number;
}

export interface StructuredFileLifecycle {
  filePath: string;
  totalUserInsertions: number;
  userLinesSurvivingEstimate: number;
  durableUserLines: number;
  ephemeralUserLines: number;
  selfRefactoredUserLines: number;
  userCommitsOnFile: number;
  nonUserCommitsOnFile: number;
  firstUserDate: string | null;
  lastUserDate: string | null;
  totalCommitsReplayed: number;
}

export interface StructuredDeletedFile {
  filePath: string;
  userLocAdded: number;
  userFirstTouchDate: string | null;
  deletionDate: string;
  deletionAuthor: string;
  lifetimeDays: number;
  durable: boolean;
}

export interface StructuredOwnershipEntry {
  userCommitSha: string;
  userCommitDate: string;
  userCommitSubject: string;
  userCommitFiles: number;
  userCommitInsertions: number;
  userCommitDeletions: number;
  category: string;
  followups: Array<{
    sha: string;
    author: string;
    date: string;
    subject: string;
    daysAfter: number;
    files: number;
    insertions: number;
    deletions: number;
  }>;
}

export interface StructuredCommit {
  sha: string;
  shortSha: string;
  authorName: string;
  email: string;
  date: string;
  timestampMs: number;
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  category: string;
  meaningful: boolean;
}

export interface TemporalPrecompute {
  commitsByHour: number[]; // length 24
  commitsByDayOfWeek: number[]; // length 7
  durabilityByQuarter: Array<{ quarter: string; score: number | null }>;
  languageTimeline: Array<{
    language: string;
    firstSeen: string;
    locByQuarter: Array<{ quarter: string; loc: number }>;
  }>;
  streaks: {
    longestConsecutiveDays: number;
    currentStreakDays: number;
  };
}

export interface StructuredInventory {
  repoName: string;
  repoPath: string;

  identity: {
    name: string;
    email: string;
    commits: number;
  } | null;

  stats: {
    totalCommits: number;
    userCommits: number;
    nonUserCommits: number;
    contributors: number;
    activeDays: number;
    firstCommitDate: string | null;
    lastCommitDate: string | null;
    isEarlyCommitter: boolean;
  };

  topFiles: Array<{ file: string; insertions: number }>;
  languageLoc: Array<{ extension: string; insertions: number }>;

  blameEntries: StructuredBlameEntry[];
  fileLifecycles: StructuredFileLifecycle[];
  deletedFiles: StructuredDeletedFile[];
  ownershipEntries: StructuredOwnershipEntry[];

  /** Aggregated lifecycle stats (surviving files). */
  survivingStats: {
    totalFilesAnalyzed: number;
    aggregateUserInsertions: number;
    aggregateSurvivingEstimate: number;
    aggregateDurable: number;
    aggregateEphemeral: number;
    aggregateSelfRefactored: number;
    rawDurabilityScore: number | null;
  };

  /** Aggregated deleted-file stats. */
  deletedStats: {
    totalDeletedInTop: number;
    durableCount: number;
    ephemeralCount: number;
    durableUserLocEstimate: number;
    ephemeralUserLocEstimate: number;
  };

  /** Time-series data for insight discovery. */
  temporal: TemporalPrecompute;

  /** Summary user commit list (structured, not rendered). */
  commits: StructuredCommit[];

  /** Top contributors (name, email, count). */
  topContributors: Array<{ name: string; email: string; commits: number }>;
}

// ---------- Pipeline config ----------

export interface PipelineConfig {
  handle: string;
  /** Default model for agents. */
  model: string;
  /** Max repos to analyze in parallel. Default: 3. */
  concurrency: number;
  /** Where to write the output JSON. */
  outPath?: string;
  /** Progress callback. */
  onProgress?: (event: PipelineProgress) => void;
}

export type PipelinePhase =
  | "github-fetch"
  | "repo-filter"
  | "system-map"
  | "repo-analysis"
  | "pr-analysis"
  | "temporal-aggregate"
  | "synthesis"
  | "evaluation"
  | "re-synthesis"
  | "validation"
  | "complete";

export interface PipelineProgress {
  phase: PipelinePhase;
  message: string;
  repoName?: string;
  /** 0-100 overall progress estimate. */
  percent?: number;
  warnings?: string[];
}

// ---------- Agent config ----------

export interface AgentConfig<T> {
  model: string;
  systemPrompt: string;
  input: string;
  tools: unknown[]; // OpenRouter tool instances
  maxIterations?: number;
  reasoning?: { effort: "high" | "medium" | "low" };
  onProgress?: (text: string) => void;
  timeoutMs?: number;
  /** Callback when the submit tool is called. */
  onResultCaptured?: (result: T) => void;
}

// ---------- Evaluation ----------

export interface EvaluationResult {
  score: number; // 0-100
  notes: string;
  reject: boolean;
  suggestions: string[];
}

// ---------- User feedback ----------

export interface UserCorrection {
  /** Which metric this correction targets. */
  target: "durability" | "adaptability" | "ownership" | "insight" | "general";
  /** Which repo this applies to (optional, for repo-specific corrections). */
  repo?: string;
  /** What the user thinks is wrong. */
  issue: string;
  /** What the user thinks the correct interpretation is. */
  expectedImpact?: string;
}

export interface UserFeedback {
  handle: string;
  submittedAt: string;
  corrections: UserCorrection[];
}
