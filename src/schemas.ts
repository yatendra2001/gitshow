import * as z from "zod/v4";

export const ArchetypeSchema = z.enum([
  "backend",
  "frontend",
  "infra",
  "fullstack",
  "mobile",
  "ml",
  "tooling",
  "other",
]);

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

/**
 * Fixed code-category buckets for per-category durability breakdowns.
 * These stay constant across repos so two developers' profiles are comparable.
 */
export const CodeCategorySchema = z.enum([
  "ui",
  "business_logic",
  "infra",
  "tests",
  "config",
  "data",
  "docs",
  "other",
]);

export const EvidenceSchema = z.object({
  commitSha: z.string().optional().describe("Git SHA (short or long form)"),
  filePath: z.string().optional().describe("Path within the repository"),
  description: z
    .string()
    .max(400)
    .describe("Short human-readable description of what this evidence shows"),
  impact: z
    .enum(["high", "medium", "low"])
    .describe("How strongly this evidence supports the associated score"),
  kind: z
    .string()
    .max(60)
    .optional()
    .describe(
      "Optional short tag for categorizing this evidence in a transparency/dispute UI. Examples: 'survival', 'deletion_durable', 'deletion_ephemeral', 'rewrite_meaningful', 'rewrite_noise', 'cleanup_followup', 'collaboration', 'self_fix', 'pattern'. Freeform — pick what best describes the evidence."
    ),
});

export const CommitCategorySchema = z.enum([
  "feature",
  "bugfix",
  "refactor",
  "test",
  "infra",
  "docs",
  "chore",
  "noise",
]);

export const CommitClassificationSchema = z.object({
  sha: z.string().describe("Short git SHA"),
  date: z.string().optional().describe("ISO date of the commit"),
  message: z
    .string()
    .max(200)
    .describe("Commit message, first line, truncated to 200 chars"),
  category: CommitCategorySchema,
  meaningful: z
    .boolean()
    .describe("True if this is a substantive change, false if noise"),
  rationale: z
    .string()
    .max(300)
    .describe("One-sentence reason for the classification"),
});

/**
 * What the agent submits via the `submit_scan_result` tool.
 *
 * Note: `scannedAt` is NOT in this schema on purpose — the wrapper sets it
 * from `new Date().toISOString()` after the agent returns. The agent should
 * not try to populate timing metadata it doesn't actually know.
 */
export const ScanResultSchema = z.object({
  handle: z.string().describe("GitHub handle the scan was run for"),
  repoName: z.string().describe("Repository name, derived from remote or directory"),

  archetype: ArchetypeSchema.describe("Primary character of the repository"),
  archetypeRationale: z.string().max(300).describe("Why this archetype was chosen"),

  repoSummary: z.object({
    totalCommitsByUser: z.number().int().nonnegative(),
    totalCommitsInRepo: z.number().int().nonnegative(),
    firstCommitDate: z
      .string()
      .nullable()
      .describe("ISO date of user's first commit, null if none"),
    lastCommitDate: z
      .string()
      .nullable()
      .describe("ISO date of user's most recent commit, null if none"),
    primaryLanguages: z
      .array(z.string())
      .describe("Top languages the user works in within this repo"),
    activeDays: z
      .number()
      .int()
      .nonnegative()
      .describe("Total days between the user's first and last commit in this repo"),
  }),

  durability: z.object({
    score: z
      .number()
      .min(0)
      .max(100)
      .nullable()
      .describe(
        "0-100 if measurable. FORMULA: (linesSurviving + durableReplacedLines) / (linesSurviving + durableReplacedLines + meaningfulRewrites) × 100. Return null if the repo is too young (<6 months of history relative to today) or has insufficient authored lines to measure meaningfully. Do NOT fabricate."
      ),
    linesSampled: z.number().int().nonnegative(),
    linesSurviving: z.number().int().nonnegative(),
    durableReplacedLines: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Lines the user authored that were replaced by non-user commits AFTER living ≥6 months in production. These DO NOT count against durability — the code did its job, shipped to users, and was intentionally retired. Think: product pivots, feature retirements, framework upgrades, planned v2 rewrites of proven systems. This is a POSITIVE signal when present."
      ),
    meaningfulRewrites: z
      .number()
      .int()
      .nonnegative()
      .describe(
        "Lines the user authored that were replaced by non-user commits within <6 months of being written. These count AGAINST durability — they indicate the original code was incomplete, rushed, or buggy and needed urgent fixes. Only count 'ephemeral' rewrites here, not long-lived code that was eventually retired."
      ),
    noiseRewrites: z.number().int().nonnegative(),
    byCategory: z
      .partialRecord(CodeCategorySchema, z.number().min(0).max(100))
      .optional()
      .describe(
        "Per-category durability scores using ONLY the fixed category keys (ui, business_logic, infra, tests, config, data, docs, other). This is a PARTIAL record — include ONLY categories where the user has authored ≥500 LOC. Missing keys are fine and expected. DO NOT fabricate numbers to fill gaps."
      ),
    evidence: z.array(EvidenceSchema).min(1).max(10),
    confidence: ConfidenceSchema,
  }),

  adaptability: z.object({
    rampUpDays: z
      .number()
      .nullable()
      .describe(
        "Median days from first touch to meaningful contribution; null if not enough data"
      ),
    languagesShipped: z
      .array(z.string())
      .describe("Languages with >500 LOC authored in this repo"),
    recentNewTech: z
      .array(z.string())
      .describe("Technologies visibly picked up in the last 12 months"),
    evidence: z.array(EvidenceSchema).min(1).max(10),
    confidence: ConfidenceSchema,
  }),

  ownership: z.object({
    score: z
      .number()
      .min(0)
      .max(100)
      .nullable()
      .describe(
        "0-100 if measurable. Return null if the repo is solo-maintained (no non-user commits) or there's no cleanup data to measure. Do NOT fabricate a score."
      ),
    commitsAnalyzed: z.number().int().nonnegative(),
    commitsRequiringCleanup: z.number().int().nonnegative(),
    soloMaintained: z
      .boolean()
      .describe(
        "True if the repo is mostly solo-maintained by the user; when true, score MUST be null"
      ),
    evidence: z.array(EvidenceSchema).min(1).max(10),
    confidence: ConfidenceSchema,
  }),

  commitClassifications: z
    .array(CommitClassificationSchema)
    .max(50)
    .describe("Representative sample of classified commits, up to 50"),

  notes: z
    .string()
    .max(2000)
    .describe(
      "Caveats, data-quality issues, or interesting observations worth surfacing on the profile"
    ),
});

/** What the agent returns via submit_scan_result. */
export type ScanResult = z.infer<typeof ScanResultSchema>;

/** Final scan result after the wrapper attaches timing metadata. */
export interface FinalScanResult extends ScanResult {
  /** ISO timestamp of when the scan was initiated — set by the wrapper, not the agent. */
  scannedAt: string;
}

export type Evidence = z.infer<typeof EvidenceSchema>;
export type Archetype = z.infer<typeof ArchetypeSchema>;
export type CommitClassification = z.infer<typeof CommitClassificationSchema>;
export type CodeCategory = z.infer<typeof CodeCategorySchema>;
