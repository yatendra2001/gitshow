/**
 * Claim-first Zod schemas for the v2 AI pipeline.
 *
 * Every user-visible string on a profile is a `Claim` — never a bare string.
 * Claims point into a deduplicated `Artifact` dictionary by `evidence_ids`.
 * The frontend renders claims; a tooltip/side-panel shows the backing
 * artifacts; user approves / edits / rejects individual claims without
 * re-running the whole pipeline.
 *
 * ## Invariants
 * - Every Claim has at least one valid evidence_id.
 * - Every evidence_id resolves to an Artifact in the Profile's artifact dict.
 * - User edits are preserved across regeneration (status = "user_edited").
 *
 * These schemas also serve as the `submit_*` tool input shape for each
 * worker agent — the Zod validator enforces the evidence contract at the
 * tool boundary, not by post-hoc checking.
 */

import * as z from "zod/v4";

// ──────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ArtifactTypeSchema = z.enum([
  "commit",
  "pr",
  "repo",
  "release",
  "issue",
  "review",
  "web",
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

/**
 * Which section of the six-beat profile a claim belongs to.
 * - hook: the one-line tagline at the top
 * - number: one of the 3 KPIs (custom labels per developer)
 * - pattern: an insight card body ("5 pivots in 15 days without abandoning")
 * - disclosure: the optional honest-flaw + comeback
 * - shipped-line: one line on a shipped-project receipt
 * - technical-depth: a skill row in the appendix
 * - radar-axis: one axis on the technical radar
 */
export const BeatSchema = z.enum([
  "hook",
  "number",
  "pattern",
  "disclosure",
  "shipped-line",
  "technical-depth",
  "radar-axis",
]);
export type Beat = z.infer<typeof BeatSchema>;

export const ClaimStatusSchema = z.enum([
  "ai_draft",       // freshly generated, not yet reviewed
  "user_approved",  // user clicked ✓
  "user_edited",    // user hand-edited the text (evidence retained)
  "user_rejected",  // user cut this claim
  "worker_failed",  // the source worker failed after retries; placeholder
]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

// ──────────────────────────────────────────────────────────────
// Artifact — the evidence atom
// ──────────────────────────────────────────────────────────────

/**
 * An Artifact is a single piece of evidence (a commit, PR, repo, web page, etc.).
 * Artifacts are deduplicated in a Profile-level dictionary keyed by `id`.
 * Multiple Claims can reference the same Artifact.
 */
export const ArtifactSchema = z.object({
  id: z.string().describe("Stable ID, e.g. 'commit:owner/repo@abcd123', 'pr:owner/repo#123'"),
  type: ArtifactTypeSchema,
  source_url: z.string().describe("Clickable URL (GitHub, web, etc.)"),
  title: z.string().max(300).describe("Short headline: commit message, PR title, page title"),
  excerpt: z.string().max(2000).optional().describe("Relevant snippet the claim uses"),
  metadata: z.record(z.string(), z.unknown()).default({}).describe(
    "Type-specific data: repo/author/date/additions/deletions for commit, " +
    "state/merged/review count for pr, stars/forks for repo, etc."
  ),
  recorded_at: z.string().describe("ISO timestamp when this artifact was fetched"),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

// ──────────────────────────────────────────────────────────────
// Claim — every user-visible string
// ──────────────────────────────────────────────────────────────

export const ClaimSchema = z.object({
  id: z.string().describe("Stable claim ID"),
  beat: BeatSchema,
  text: z.string().max(1000).describe("What renders on the page"),
  evidence_ids: z
    .array(z.string())
    .min(1)
    .describe("At least one artifact id that backs this claim"),
  confidence: ConfidenceSchema,
  status: ClaimStatusSchema.default("ai_draft"),
  user_override: z.string().optional().describe("Present when status = user_edited"),
  prompt_version: z
    .string()
    .optional()
    .describe("Version tag of the prompt that generated this claim (for targeted regen)"),

  // Optional beat-specific fields — let the shape of the claim
  // adapt to the beat without making every field a giant union.
  label: z
    .string()
    .max(80)
    .optional()
    .describe("For `number` beat: the custom metric label, e.g. '2 weeks' or '27%'"),
  sublabel: z
    .string()
    .max(200)
    .optional()
    .describe("For `number`/`shipped-line` beat: a one-line explanation under the headline"),
  extra: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Escape hatch for beat-specific extras (chart data, stack tags, etc.)"),
});
export type Claim = z.infer<typeof ClaimSchema>;

// ──────────────────────────────────────────────────────────────
// Worker output — what each parallel worker submits
// ──────────────────────────────────────────────────────────────

/**
 * Strict output contract for every worker agent.
 * The submit_worker_output tool is validated against this schema;
 * a claim missing evidence_ids fails the tool call and the worker retries.
 */
export const WorkerOutputSchema = z.object({
  worker: z
    .string()
    .describe("Worker name, e.g. 'cross-repo-patterns'"),
  claims: z
    .array(ClaimSchema.omit({ status: true, prompt_version: true }))
    .max(20)
    .describe("Claims produced by this worker. Each MUST reference >=1 evidence_id."),
  new_artifacts: z
    .array(ArtifactSchema)
    .default([])
    .describe(
      "New artifacts discovered via web/github-search tools that aren't " +
      "already in the base artifact table. The orchestrator merges these in."
    ),
  notes: z
    .string()
    .max(1000)
    .optional()
    .describe("Short free-form note for the orchestrator/critic (not shown to user)"),
});
export type WorkerOutput = z.infer<typeof WorkerOutputSchema>;

// ──────────────────────────────────────────────────────────────
// Hook-specific schemas (evaluator-optimizer loop)
// ──────────────────────────────────────────────────────────────

/**
 * Four mutually-exclusive framing choices for a profile hook. The
 * angle-selector picks one before the writer runs; the writer then
 * constrains all 5 candidates to lead with that angle. Route-then-execute
 * — narrows the writer's solution space so candidates stay focused and
 * stable across independent runs.
 */
export const HookAngleSchema = z.enum([
  "CREDENTIAL_ANCHOR",
  "OPERATOR_DENSITY",
  "BUILD_CADENCE",
  "DOMAIN_DEPTH",
]);
export type HookAngle = z.infer<typeof HookAngleSchema>;

export const HookAngleSelectionSchema = z.object({
  angle: HookAngleSchema,
  reason: z
    .string()
    .max(400)
    .describe(
      "One sentence explaining why this angle dominates for THIS developer. " +
      "Must cite the specific evidence (maintainer name, product name, team-scale stat, etc.).",
    ),
});
export type HookAngleSelection = z.infer<typeof HookAngleSelectionSchema>;

export const HookCandidateSchema = z.object({
  text: z.string().max(240).describe("Hook text — 1-3 short declarative sentences, no em-dash punchlines"),
  voice: z
    .string()
    .max(40)
    .describe(
      "Voice register label. Standard values: direct, understated, numeric, " +
      "personality, contrarian. When employment+scale data exists, the writer " +
      "may use identity-forward variants (direct-detail, numeric-context) — " +
      "values treated as free-form metadata by the critic.",
    ),
  evidence_ids: z
    .array(z.string())
    .min(1)
    .describe("Artifacts this hook draws from"),
  reasoning: z
    .string()
    .max(500)
    .describe("Why this hook captures this specific developer"),
});
export type HookCandidate = z.infer<typeof HookCandidateSchema>;

export const HookWriterOutputSchema = z.object({
  candidates: z.array(HookCandidateSchema).length(5).describe("Exactly 5 candidates, distinct voices"),
});
export type HookWriterOutput = z.infer<typeof HookWriterOutputSchema>;

export const HookCriticOutputSchema = z.object({
  winner_index: z
    .number()
    .int()
    .min(0)
    .max(4)
    .nullable()
    .describe("Index of the best candidate, or null if all fail"),
  scores: z
    .array(
      z.object({
        index: z.number().int(),
        specific: z.number().min(0).max(10),
        verifiable: z.number().min(0).max(10),
        surprising: z.number().min(0).max(10),
        earned: z.number().min(0).max(10),
        reasoning: z.string().max(300),
      })
    )
    .length(5),
  revise_instruction: z
    .string()
    .max(500)
    .optional()
    .describe("If winner is null, tell the writer what to change for the next round"),
});
export type HookCriticOutput = z.infer<typeof HookCriticOutputSchema>;

// ──────────────────────────────────────────────────────────────
// Discover output
// ──────────────────────────────────────────────────────────────

export const DiscoverOutputSchema = z.object({
  distinctive_paragraph: z
    .string()
    .max(2500)
    .describe(
      "Free-form paragraph: what makes this developer distinctive? " +
      "Specific, behavioral, surprising. No structure imposed."
    ),
  investigation_angles: z
    .array(z.string().max(200))
    .min(3)
    .max(10)
    .describe(
      "Threads worth pulling — concrete questions workers should try to answer " +
      "(e.g., 'look for whether hackathon wins are mentioned on personal site')"
    ),
  primary_shape: z
    .string()
    .max(80)
    .describe(
      "One-line archetype hint in the developer's own terms — " +
      "e.g. 'solo AI-app shipper', 'infra owner', 'OSS maintainer'. " +
      "Used to prime workers, not hard-coded as a category."
    ),
});
export type DiscoverOutput = z.infer<typeof DiscoverOutputSchema>;

// ──────────────────────────────────────────────────────────────
// Profile critic output
// ──────────────────────────────────────────────────────────────

export const ProfileCriticOutputSchema = z.object({
  forwardable: z
    .boolean()
    .describe("Would a senior engineer forward this profile to a founder? Final verdict."),
  overall_score: z.number().min(0).max(100),
  flagged_claims: z
    .array(
      z.object({
        claim_id: z.string(),
        reason: z.enum(["not_specific", "not_verifiable", "not_surprising", "not_earned", "generic", "factually_wrong"]),
        note: z.string().max(300),
      })
    )
    .max(30)
    .describe("Claims that should be regenerated or cut"),
  top_strengths: z.array(z.string().max(200)).max(5),
  top_gaps: z.array(z.string().max(200)).max(5),
});
export type ProfileCriticOutput = z.infer<typeof ProfileCriticOutputSchema>;

// ──────────────────────────────────────────────────────────────
// Hiring-manager evaluator — strict six-axis gate
// ──────────────────────────────────────────────────────────────
//
// The profile-critic above flags individual claims. This one runs AFTER
// everything else and produces an axis-level verdict (PASS / REVISE /
// BLOCK) with ordered top-three fixes. Models a senior hiring manager
// reading the profile cold.

export const HiringManagerAxisSchema = z.object({
  score: z.number().int().min(0).max(10),
  issues: z.array(z.string().max(400)).default([]),
  suggestions: z.array(z.string().max(400)).default([]),
});
export type HiringManagerAxis = z.infer<typeof HiringManagerAxisSchema>;

export const HiringManagerOutputSchema = z.object({
  verdict: z.enum(["PASS", "REVISE", "BLOCK"]),
  overall_score: z.number().int().min(0).max(100),
  axes: z.object({
    hook: HiringManagerAxisSchema,
    numeric_integrity: HiringManagerAxisSchema,
    pattern_selection: HiringManagerAxisSchema,
    voice: HiringManagerAxisSchema,
    evidence: HiringManagerAxisSchema,
    disclosure: HiringManagerAxisSchema,
  }),
  block_triggers: z.array(z.string().max(400)).default([]),
  top_three_fixes: z
    .array(
      z.object({
        axis: z.string().max(50),
        claim_id: z.string().optional(),
        fix: z.string().max(1000),
      })
    )
    .max(5),
  forwarding_test: z.object({
    would_a_senior_eng_forward_this: z.boolean(),
    why_or_why_not: z.string().max(400),
  }),
});
export type HiringManagerOutput = z.infer<typeof HiringManagerOutputSchema>;

// ──────────────────────────────────────────────────────────────
// Revision events — audit trail for user edits
// ──────────────────────────────────────────────────────────────

export const RevisionEventSchema = z.object({
  at: z.string().describe("ISO timestamp"),
  claim_id: z.string(),
  kind: z.enum(["approve", "reject", "edit", "regenerate"]),
  before: z.string().optional(),
  after: z.string().optional(),
  reason: z.string().max(500).optional(),
});
export type RevisionEvent = z.infer<typeof RevisionEventSchema>;

// ──────────────────────────────────────────────────────────────
// Scan session — one per profile scan
// ──────────────────────────────────────────────────────────────

export const ScanSocialsSchema = z.object({
  twitter: z.string().optional(),
  linkedin: z.string().optional(),
  website: z.string().optional(),
  other: z.array(z.string()).optional(),
});
export type ScanSocials = z.infer<typeof ScanSocialsSchema>;

export const ScanSessionSchema = z.object({
  id: z.string().describe("OpenRouter session_id (and our scan id)"),
  handle: z.string(),
  socials: ScanSocialsSchema,
  context_notes: z.string().optional().describe("User-provided freeform context"),
  started_at: z.string(),
  dashboard_url: z.string().describe("OpenRouter session dashboard URL"),
  model: z.string().describe("Default model, e.g. 'anthropic/claude-sonnet-4.6'"),
  /**
   * Advisory cost cap in USD. `Infinity` (default) = no cap; the pipeline
   * never aborts on cost. Users who want a guardrail can set a number.
   */
  cost_cap_usd: z.number().positive().default(Number.POSITIVE_INFINITY),
});
export type ScanSession = z.infer<typeof ScanSessionSchema>;

// ──────────────────────────────────────────────────────────────
// Pipeline metadata
// ──────────────────────────────────────────────────────────────

export const PipelineMetaSchema = z.object({
  pipeline_version: z.string().describe("Git sha or semver of the pipeline code"),
  session: ScanSessionSchema,
  stage_timings: z
    .array(
      z.object({
        stage: z.string(),
        started_at: z.string(),
        finished_at: z.string(),
        duration_ms: z.number().int().nonnegative(),
      })
    )
    .default([]),
  llm_calls: z.number().int().nonnegative().default(0),
  web_calls: z.number().int().nonnegative().default(0),
  github_search_calls: z.number().int().nonnegative().default(0),
  total_tokens: z.number().int().nonnegative().default(0),
  estimated_cost_usd: z.number().nonnegative().default(0),
  errors: z.array(z.string()).default([]),
});
export type PipelineMeta = z.infer<typeof PipelineMetaSchema>;

// ──────────────────────────────────────────────────────────────
// Profile — the final output
// ──────────────────────────────────────────────────────────────

export const ProfileSchema = z.object({
  handle: z.string(),
  generated_at: z.string(),
  pipeline_version: z.string(),

  /** Distinctive summary from the discover stage — for debugging and revision UI. */
  distinctive_paragraph: z.string(),

  /** Every user-visible string. Rendered in six-beat order by beat + display_order. */
  claims: z.array(ClaimSchema),

  /** Deduped evidence dictionary. */
  artifacts: z.record(z.string(), ArtifactSchema),

  /** Audit trail (empty on first generation). */
  revision_history: z.array(RevisionEventSchema).default([]),

  /** Pipeline execution metadata. */
  meta: PipelineMetaSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/** Group claims by beat, for rendering or iteration. */
export function claimsByBeat(profile: Profile): Record<Beat, Claim[]> {
  const acc: Record<Beat, Claim[]> = {
    hook: [],
    number: [],
    pattern: [],
    disclosure: [],
    "shipped-line": [],
    "technical-depth": [],
    "radar-axis": [],
  };
  for (const c of profile.claims) acc[c.beat].push(c);
  return acc;
}

/** Resolve evidence ids on a claim to full Artifacts. */
export function evidenceFor(profile: Profile, claim: Claim): Artifact[] {
  return claim.evidence_ids
    .map((id) => profile.artifacts[id])
    .filter((a): a is Artifact => a !== undefined);
}

// ──────────────────────────────────────────────────────────────
// ProfileCard — slim projection of Profile for the frontend
// ──────────────────────────────────────────────────────────────
//
// The full Profile includes the entire Artifact dictionary (often 2–5 MB).
// ProfileCard strips that to the claim-level essentials the UI actually
// renders, plus a tiny evidence preview per claim (up to 3 links). A full
// evidence drill-down still goes against the Profile JSON when needed.

export const CardClaimSchema = z.object({
  id: z.string(),
  beat: BeatSchema,
  text: z.string(),
  label: z.string().optional(),
  sublabel: z.string().optional(),
  confidence: ConfidenceSchema,
  status: ClaimStatusSchema,
  evidence_count: z.number().int().nonnegative(),
  evidence_preview: z
    .array(
      z.object({
        id: z.string(),
        type: ArtifactTypeSchema,
        url: z.string(),
        title: z.string(),
      })
    )
    .max(3),
  /**
   * For `pattern` beat only: true = show in the main patterns panel,
   * false = demote to "additional context". All non-pattern beats
   * default to `true`. Kept at claim level so a single `patterns[]`
   * array can be consumed by both old and new UIs.
   */
  primary: z.boolean().default(true),
});
export type CardClaim = z.infer<typeof CardClaimSchema>;

// Chart-ready data the UI can render directly — no fabrication needed.
export const TimelineChartEntrySchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12).optional(),
  label: z.string(),
  note: z.string().optional(),
  type: z.enum(["oss", "job", "solo", "win"]),
  major: z.boolean().default(false),
});
export type TimelineChartEntry = z.infer<typeof TimelineChartEntrySchema>;

export const TeamHistogramSchema = z.object({
  repo: z.string(),
  total_commits: z.number().int().nonnegative(),
  contributors: z.array(
    z.object({
      name: z.string(),
      commits: z.number().int().nonnegative(),
      is_user: z.boolean().default(false),
    })
  ),
});
export type TeamHistogram = z.infer<typeof TeamHistogramSchema>;

export const DailyActivitySchema = z.object({
  repo: z.string(),
  days: z.array(
    z.object({
      date: z.string().describe("YYYY-MM-DD"),
      ins: z.number().int().nonnegative(),
      del: z.number().int().nonnegative(),
      c: z.number().int().nonnegative(),
    })
  ),
});
export type DailyActivity = z.infer<typeof DailyActivitySchema>;

export const ChartsSchema = z.object({
  timeline: z.array(TimelineChartEntrySchema).default([]),
  primary_repo_team: TeamHistogramSchema.nullable().default(null),
  primary_repo_daily_activity: DailyActivitySchema.nullable().default(null),
});
export type Charts = z.infer<typeof ChartsSchema>;

export const ProfileCardSchema = z.object({
  handle: z.string(),
  generated_at: z.string(),
  pipeline_version: z.string(),
  primary_shape: z.string().optional(),
  distinctive_paragraph: z.string(),

  hook: CardClaimSchema.nullable(),
  numbers: z.array(CardClaimSchema),
  patterns: z.array(CardClaimSchema),
  disclosure: CardClaimSchema.nullable(),
  shipped: z.array(CardClaimSchema),

  charts: ChartsSchema.default({ timeline: [], primary_repo_team: null, primary_repo_daily_activity: null }),

  critic: z
    .object({
      forwardable: z.boolean(),
      overall_score: z.number(),
      top_strengths: z.array(z.string()),
      top_gaps: z.array(z.string()),
      flagged_claim_ids: z.array(z.string()),
    })
    .optional(),

  meta: z.object({
    session_id: z.string(),
    session_url: z.string(),
    total_claims: z.number().int().nonnegative(),
    total_artifacts: z.number().int().nonnegative(),
    llm_calls: z.number().int().nonnegative(),
    web_calls: z.number().int().nonnegative(),
    github_search_calls: z.number().int().nonnegative(),
    estimated_cost_usd: z.number(),
    elapsed_ms: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    /**
     * Always-on hook stability signal. Low similarity means the hook prompt
     * produced noticeably different hooks across two independent runs on the
     * same input.
     */
    stability: z
      .object({
        hook_similarity: z.number().min(0).max(1),
        verdict: z.enum(["stable", "mixed", "unstable", "skipped"]),
        note: z.string(),
      })
      .optional(),
    /**
     * Senior hiring-manager verdict + top-three fixes. The UI should show
     * a prominent banner for REVISE/BLOCK and (optionally) the fix list as
     * edit suggestions.
     */
    hiring_review: z
      .object({
        verdict: z.enum(["PASS", "REVISE", "BLOCK"]),
        overall_score: z.number().int().min(0).max(100),
        would_forward: z.boolean(),
        why: z.string(),
        block_triggers: z.array(z.string()).default([]),
        top_fixes: z
          .array(
            z.object({
              axis: z.string(),
              claim_id: z.string().optional(),
              fix: z.string(),
            })
          )
          .default([]),
      })
      .optional(),
  }),
});
export type ProfileCard = z.infer<typeof ProfileCardSchema>;
