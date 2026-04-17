/**
 * Zod schemas for all agent I/O validation.
 *
 * These schemas serve two purposes:
 * 1. Define the `submit_*` tool input for each agent (the structured output)
 * 2. Define the final ProfileResult that powers the frontend
 *
 * Convention: schemas ending in `Schema` export a corresponding `type` via z.infer.
 */

import * as z from "zod/v4";

// ============ SHARED ENUMS ============

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

export const ChartTypeSchema = z.enum(["hbar", "bar", "area"]);

// ============ EVIDENCE ============

export const EvidenceSchema = z.object({
  commitSha: z.string().optional().describe("Git SHA (short or long form)"),
  filePath: z.string().optional().describe("File path within a repo"),
  repoName: z.string().optional().describe("Which repo this evidence comes from"),
  description: z
    .string()
    .max(400)
    .describe("Short human-readable description"),
  impact: z
    .enum(["high", "medium", "low"])
    .describe("How strongly this evidence supports the score"),
  kind: z
    .string()
    .max(60)
    .optional()
    .describe(
      "Tag for transparency UI: survival, deletion_durable, deletion_ephemeral, rewrite_meaningful, rewrite_noise, cleanup_followup, collaboration, self_fix, pattern, early_committer, recent_tech, review_quality, cross_repo"
    ),
});

// ============ TREND DATA ============

export const TrendPointSchema = z.object({
  period: z.string().describe("Time label: '2024-Q1', '2024-03', 'M1', 'Jan'"),
  value: z.number().describe("The metric value for this period"),
});

// ============ INSIGHT CARDS ============

export const InsightChartDataSchema = z.object({
  type: ChartTypeSchema,
  data: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
      })
    )
    .min(2)
    .max(12)
    .describe("Chart data points"),
  unit: z.string().max(20).optional().describe("Value suffix: '%', 'days', 'LOC'"),
});

export const InsightCardSchema = z.object({
  stat: z
    .string()
    .max(40)
    .describe("Headline number: '97%', '3.2x', '48hrs', '0'"),
  label: z
    .string()
    .max(80)
    .describe("What it measures: 'Infra code durability'"),
  subtitle: z
    .string()
    .max(300)
    .describe("Human explanation of why this matters"),
  chart: InsightChartDataSchema.optional().describe("Optional chart for visual insight"),
  sourceRepos: z
    .array(z.string())
    .optional()
    .describe("Which repos this insight draws from"),
});

// ============ CORE METRICS ============

export const DurabilitySchema = z.object({
  score: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .describe(
      "Aggregate durability 0-100. Formula: (linesSurviving + durableReplacedLines) / (linesSurviving + durableReplacedLines + meaningfulRewrites) x 100. Null if insufficient data."
    ),
  subtitle: z
    .string()
    .max(250)
    .describe(
      "Human-readable: 'of code I wrote 6+ months ago is still in production'"
    ),
  reasoning: z
    .string()
    .max(2000)
    .describe(
      "Full audit trail: which repos contributed, the formula with actual numbers, why repos were excluded, any caveats. The user reads this to verify or challenge the score."
    ),
  linesSampled: z.number().int().nonnegative(),
  linesSurviving: z.number().int().nonnegative(),
  durableReplacedLines: z.number().int().nonnegative().optional(),
  meaningfulRewrites: z.number().int().nonnegative(),
  noiseRewrites: z.number().int().nonnegative(),
  byCategory: z
    .partialRecord(CodeCategorySchema, z.number().min(0).max(100))
    .optional()
    .describe("Per-category durability. Only categories with >=500 LOC."),
  byRepo: z
    .array(
      z.object({
        repoName: z.string(),
        score: z.number().min(0).max(100).nullable(),
        linesSampled: z.number().int().nonnegative(),
      })
    )
    .optional()
    .describe("Per-repo durability breakdown"),
  trend: z
    .array(TrendPointSchema)
    .optional()
    .describe("Durability over time (quarterly)"),
  evidence: z.array(EvidenceSchema).min(1).max(15),
  confidence: ConfidenceSchema,
});

export const AdaptabilitySchema = z.object({
  score: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .describe("Composite adaptability score 0-100"),
  subtitle: z.string().max(250),
  reasoning: z
    .string()
    .max(2000)
    .describe(
      "Full audit trail: how the score was computed, which languages/repos contributed, ramp-up calculation, what 'recent new tech' means specifically."
    ),
  rampUpDays: z
    .number()
    .nullable()
    .describe("Median days to first meaningful contribution in new codebase. Null if early-committer."),
  languages: z
    .array(
      z.object({
        name: z.string().describe("Language name: 'TypeScript', 'Go'"),
        proficiency: z
          .number()
          .min(0)
          .max(100)
          .describe("0-100 based on LOC, durability, breadth, recency"),
      })
    )
    .describe("Languages with proficiency scores"),
  recentNewTech: z
    .array(z.string())
    .describe("Technologies picked up in last 12 months"),
  trend: z.array(TrendPointSchema).optional(),
  evidence: z.array(EvidenceSchema).min(1).max(15),
  confidence: ConfidenceSchema,
});

export const OwnershipSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .describe("Aggregate ownership 0-100. Formula: 100 x (1 - cleanups / analyzed). Null if solo-maintained."),
  subtitle: z.string().max(250),
  reasoning: z
    .string()
    .max(2000)
    .describe(
      "Full audit trail: how many commits analyzed per repo, how cleanups were identified, which repos are solo-maintained and why, review-to-code ratio calculation."
    ),
  commitsAnalyzed: z.number().int().nonnegative(),
  commitsRequiringCleanup: z.number().int().nonnegative(),
  soloMaintainedRepos: z
    .array(z.string())
    .optional()
    .describe("Repos where the user is the only contributor"),
  reviewToCodeRatio: z
    .number()
    .optional()
    .describe("PRs reviewed / PRs authored. >1 = reviews more than writes."),
  totalReviewsSubmitted: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Total PR reviews the user has submitted across all repos"),
  trend: z.array(TrendPointSchema).optional(),
  evidence: z.array(EvidenceSchema).min(1).max(15),
  confidence: ConfidenceSchema,
});

// ============ RADAR ============

export const RadarDimensionSchema = z.object({
  trait: z.string().max(30).describe("Axis label: 'Backend', 'Testing', 'DevOps'"),
  value: z.number().min(0).max(100).describe("Score 0-100"),
});

// ============ SHIPPED PROJECTS ============

export const ShippedProjectSchema = z.object({
  name: z.string().max(100).describe("Project name: 'Distributed Task Queue'"),
  meta: z.string().max(200).describe("Context: 'Solo . 3 wks . Oct 25'"),
  description: z.string().max(200).describe("One line about what it does: 'Web platform + React Native companion'"),
  stack: z.array(z.string()).describe("Tech stack tags"),
  repos: z.array(z.string()).describe("Repo names in this system"),
  highlight: z
    .object({
      label: z.string().max(30).describe("What this metric is: 'Durability', 'Built in', 'Scale', 'Languages'"),
      value: z.string().max(40).describe("The impressive number: '34%', '10 days', '60+ components', '5 languages'"),
    })
    .describe(
      "The MOST compelling metric for this project. NEVER show N/A. " +
      "Pick the best available: durability % (if repo >6mo), build velocity (always available), " +
      "scale (lines/components), stack breadth, or team contribution %."
    ),
  kpi: z
    .string()
    .max(200)
    .nullable()
    .describe("User-provided impact metric. Null = not yet provided."),
});

// ============ TECHNICAL DEPTH ============

export const TechnicalDepthSchema = z.object({
  skill: z.string().max(40).describe("Skill name: 'Go', 'React', 'PostgreSQL'"),
  level: z.number().min(0).max(100).describe("Proficiency 0-100"),
  projectCount: z
    .number()
    .int()
    .nonnegative()
    .describe("How many repos/projects use this skill"),
  description: z
    .string()
    .max(200)
    .describe("What depth looks like: 'Concurrency, channels, pprof'"),
});

// ============ CODE REVIEW PROFILE ============

export const CodeReviewProfileSchema = z.object({
  totalReviews: z.number().int().nonnegative(),
  reviewToCodeRatio: z
    .number()
    .describe("Reviews submitted / PRs authored"),
  avgCommentsPerReview: z.number().describe("Average inline comments per review"),
  depth: z
    .enum(["surface", "moderate", "thorough"])
    .describe("Overall review depth assessment"),
  evidence: z.array(EvidenceSchema).max(5),
});

// ============ EXTERNAL CONTRIBUTION ============

export const ExternalContributionSchema = z.object({
  repoFullName: z.string().describe("'facebook/react', 'kubernetes/kubernetes'"),
  prCount: z.number().int().nonnegative().describe("PRs authored to this repo"),
  mergedCount: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative().optional(),
  significance: z.enum(["high", "medium", "low"]),
  summary: z.string().max(300).describe("What the user contributed"),
  languages: z.array(z.string()),
});

// ============ TEMPORAL DATA ============

export const TemporalDataSchema = z.object({
  commitsByHour: z
    .array(z.number())
    .length(24)
    .optional()
    .describe("Commits per hour of day [0..23]"),
  commitsByDayOfWeek: z
    .array(z.number())
    .length(7)
    .optional()
    .describe("Commits per day [Mon..Sun]"),
  prCycleTimeByMonth: z
    .array(TrendPointSchema)
    .optional()
    .describe("Average PR cycle time (days) by month"),
  durabilityByQuarter: z
    .array(TrendPointSchema)
    .optional()
    .describe("Durability score trend by quarter"),
  languageAdoptionTimeline: z
    .array(
      z.object({
        language: z.string(),
        firstSeen: z.string(),
        locByQuarter: z.array(TrendPointSchema),
      })
    )
    .optional(),
  streaks: z
    .object({
      longestConsecutiveDays: z.number().int().optional(),
      currentStreakDays: z.number().int().optional(),
    })
    .optional(),
});

// ============ PER-REPO ANALYSIS (what repo-analyzer submits) ============

export const RepoAnalysisResultSchema = z.object({
  repoName: z.string(),
  archetype: ArchetypeSchema,

  repoSummary: z.object({
    totalCommitsByUser: z.number().int().nonnegative(),
    totalCommitsInRepo: z.number().int().nonnegative(),
    firstCommitDate: z.string().nullable(),
    lastCommitDate: z.string().nullable(),
    primaryLanguages: z.array(z.string()),
    activeDays: z.number().int().nonnegative(),
  }),

  durability: z.object({
    score: z.number().min(0).max(100).nullable(),
    reasoning: z.string().max(2000).describe("Show your work: formula with numbers, why null if null, caveats"),
    linesSampled: z.number().int().nonnegative(),
    linesSurviving: z.number().int().nonnegative(),
    durableReplacedLines: z.number().int().nonnegative().optional(),
    meaningfulRewrites: z.number().int().nonnegative(),
    noiseRewrites: z.number().int().nonnegative(),
    byCategory: z
      .partialRecord(CodeCategorySchema, z.number().min(0).max(100))
      .optional(),
    evidence: z.array(EvidenceSchema).min(1).max(10),
    confidence: ConfidenceSchema,
  }),

  adaptability: z.object({
    rampUpDays: z.number().nullable(),
    reasoning: z.string().max(2000).describe("Show your work: how rampUpDays was calculated, why null if null"),
    languagesShipped: z.array(z.string()),
    recentNewTech: z.array(z.string()),
    evidence: z.array(EvidenceSchema).min(1).max(10),
    confidence: ConfidenceSchema,
  }),

  ownership: z.object({
    score: z.number().min(0).max(100).nullable(),
    reasoning: z.string().max(2000).describe("Show your work: cleanup count, classification examples, why null if null"),
    commitsAnalyzed: z.number().int().nonnegative(),
    commitsRequiringCleanup: z.number().int().nonnegative(),
    soloMaintained: z.boolean(),
    evidence: z.array(EvidenceSchema).min(1).max(10),
    confidence: ConfidenceSchema,
  }),

  commitClassifications: z
    .array(
      z.object({
        sha: z.string(),
        date: z.string().optional(),
        message: z.string().max(200),
        category: CommitCategorySchema,
        meaningful: z.boolean(),
        rationale: z.string().max(300),
      })
    )
    .max(50),

  notes: z.string().max(2000),
});

// ============ SYSTEM MAPPING (what system-mapper submits) ============

export const SystemMappingResultSchema = z.object({
  systems: z.array(
    z.object({
      name: z.string().max(100),
      description: z.string().max(300),
      repos: z.array(z.string()).min(1),
      archetype: ArchetypeSchema,
    })
  ),
  standalone: z.array(z.string()).describe("Repos not in any system"),
});

// ============ EVALUATION (what evaluator submits) ============

export const EvaluationResultSchema = z.object({
  score: z.number().min(0).max(100).describe("Overall quality score"),
  notes: z.string().max(1000).describe("Specific feedback"),
  reject: z.boolean().describe("True if profile is too low quality to ship"),
  suggestions: z
    .array(z.string().max(300))
    .max(10)
    .describe("Actionable improvements"),
});

// ============ PROFILE RESULT (TOP-LEVEL OUTPUT) ============

export const ProfileResultSchema = z.object({
  // Identity
  handle: z.string(),
  generatedAt: z.string().describe("ISO timestamp"),

  // AI-generated narrative
  hook: z
    .string()
    .max(120)
    .describe("One-liner tagline: 'I build interfaces users dont have to think about'"),
  subtitle: z
    .string()
    .max(300)
    .describe("Role + experience + stack: 'Backend . 3 years . Go, Python . Fintech'"),

  // Core metrics (aggregated across repos)
  durability: DurabilitySchema,
  adaptability: AdaptabilitySchema,
  ownership: OwnershipSchema,

  // Skill fingerprint (radar chart)
  radar: z
    .array(RadarDimensionSchema)
    .min(4)
    .max(8)
    .describe("4-8 dimensions, agent-chosen based on data"),

  // Data-backed insight cards
  insights: z
    .array(InsightCardSchema)
    .min(4)
    .max(8)
    .describe("Most compelling data stories about this engineer"),

  // Shipped systems (cross-repo projects)
  shipped: z.array(ShippedProjectSchema),

  // Technical depth
  technicalDepth: z.array(TechnicalDepthSchema),

  // Code review profile
  codeReview: CodeReviewProfileSchema.optional(),

  // Per-repo analysis details (for drill-down)
  repoAnalyses: z.array(
    z.object({
      repoName: z.string(),
      archetype: ArchetypeSchema,
      commitCount: z.number().int(),
      durabilityScore: z.number().min(0).max(100).nullable(),
      ownershipScore: z.number().min(0).max(100).nullable(),
      languagesShipped: z.array(z.string()),
      role: z
        .string()
        .max(60)
        .describe("User's role: 'primary author', 'reviewer', 'contributor'"),
      system: z
        .string()
        .nullable()
        .describe("Which shipped system this belongs to, or null"),
    })
  ),

  // External contributions
  externalContributions: z.array(ExternalContributionSchema).optional(),

  // Temporal data for frontend charts
  temporal: TemporalDataSchema.optional(),

  // Evaluation
  evaluationScore: z.number().min(0).max(100).optional(),
  evaluationNotes: z.string().max(1000).optional(),

  // User-editable fields (null = not yet provided by user)
  openTo: z
    .array(z.string())
    .nullable()
    .describe("User-provided availability: ['Full-time', 'Contract']"),

  // Pipeline execution metadata
  pipelineMeta: z.object({
    totalReposFound: z.number().int(),
    significantRepos: z.number().int(),
    systemsIdentified: z.number().int(),
    externalReposAnalyzed: z.number().int(),
    totalDurationMs: z.number().int(),
    agentCalls: z.number().int(),
    estimatedCostUsd: z.number().optional(),
  }),
});

// ============ PROFILE CARD (lean frontend payload) ============
//
// The frontend gets this — concise, no heavy descriptions or reasoning.
// Reasoning, evidence, and audit trails live in the full ProfileResult
// which powers the developer dashboard where they iterate on their profile.

export const ProfileCardSchema = z.object({
  handle: z.string(),
  generatedAt: z.string(),
  hook: z.string(),
  subtitle: z.string(),

  durability: z.object({
    score: z.number().min(0).max(100).nullable(),
    subtitle: z.string(),
  }),
  adaptability: z.object({
    score: z.number().min(0).max(100).nullable(),
    subtitle: z.string(),
    languages: z.array(z.object({ name: z.string(), proficiency: z.number() })),
  }),
  ownership: z.object({
    score: z.number().min(0).max(100).nullable(),
    subtitle: z.string(),
  }),

  radar: z.array(z.object({ trait: z.string(), value: z.number() })),

  insights: z.array(z.object({
    stat: z.string(),
    label: z.string(),
    subtitle: z.string(),
    chart: InsightChartDataSchema.optional(),
  })),

  shipped: z.array(z.object({
    name: z.string(),
    meta: z.string(),
    description: z.string(),
    stack: z.array(z.string()),
    highlight: z.object({ label: z.string(), value: z.string() }),
    kpi: z.string().nullable(),
  })),

  technicalDepth: z.array(z.object({
    skill: z.string(),
    level: z.number(),
    projectCount: z.number(),
    description: z.string(),
  })),

  codeReview: z.object({
    totalReviews: z.number(),
    reviewToCodeRatio: z.number(),
    depth: z.string(),
  }).optional(),

  openTo: z.array(z.string()).nullable(),
});

/**
 * Derive the lean frontend card from the full profile result.
 * Strips: reasoning, evidence, per-repo details, temporal data, pipeline meta.
 */
export function toProfileCard(full: ProfileResult): ProfileCard {
  return {
    handle: full.handle,
    generatedAt: full.generatedAt,
    hook: full.hook,
    subtitle: full.subtitle,
    durability: { score: full.durability.score, subtitle: full.durability.subtitle },
    adaptability: { score: full.adaptability.score, subtitle: full.adaptability.subtitle, languages: full.adaptability.languages },
    ownership: { score: full.ownership.score, subtitle: full.ownership.subtitle },
    radar: full.radar,
    insights: full.insights.map((i) => ({ stat: i.stat, label: i.label, subtitle: i.subtitle, chart: i.chart })),
    shipped: full.shipped.map((s) => ({ name: s.name, meta: s.meta, description: s.description, stack: s.stack, highlight: s.highlight, kpi: s.kpi })),
    technicalDepth: full.technicalDepth,
    codeReview: full.codeReview ? { totalReviews: full.codeReview.totalReviews, reviewToCodeRatio: full.codeReview.reviewToCodeRatio, depth: full.codeReview.depth } : undefined,
    openTo: full.openTo,
  };
}

// ============ TYPE EXPORTS ============

export type ProfileCard = z.infer<typeof ProfileCardSchema>;
export type Archetype = z.infer<typeof ArchetypeSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type CodeCategory = z.infer<typeof CodeCategorySchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type TrendPoint = z.infer<typeof TrendPointSchema>;
export type InsightCard = z.infer<typeof InsightCardSchema>;
export type InsightChartData = z.infer<typeof InsightChartDataSchema>;
export type RadarDimension = z.infer<typeof RadarDimensionSchema>;
export type ShippedProject = z.infer<typeof ShippedProjectSchema>;
export type TechnicalDepth = z.infer<typeof TechnicalDepthSchema>;
export type CodeReviewProfile = z.infer<typeof CodeReviewProfileSchema>;
export type ExternalContribution = z.infer<typeof ExternalContributionSchema>;
export type TemporalData = z.infer<typeof TemporalDataSchema>;
export type RepoAnalysisResult = z.infer<typeof RepoAnalysisResultSchema>;
export type SystemMappingResult = z.infer<typeof SystemMappingResultSchema>;
export type EvaluationResultOutput = z.infer<typeof EvaluationResultSchema>;
export type ProfileResult = z.infer<typeof ProfileResultSchema>;

