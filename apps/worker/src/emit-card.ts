/**
 * Emit a slim ProfileCard from the full Profile.
 *
 * Drops: the full artifact dictionary, per-claim metadata we don't need on
 * the frontend, stage timings. Keeps: every claim with its text + label +
 * confidence + status + a 3-artifact preview the UI can link to.
 *
 * Typical size: 20–60 KB (vs. 2–5 MB for full profile.json).
 */

import type {
  Profile,
  ProfileCard,
  CardClaim,
  ProfileCriticOutput,
  Charts,
  TimelineChartEntry,
  TeamHistogram,
  DailyActivity,
  Artifact,
  HiringManagerOutput,
} from "./schemas.js";

export interface EmitCardInput {
  profile: Profile;
  critic?: ProfileCriticOutput;
  primary_shape?: string;
  /** Timeline entries from the timeline agent. */
  timeline?: TimelineChartEntry[];
  /** Optional dev stability signal (see agents/hook/stability-check.ts). */
  stability?: {
    hook_similarity: number;
    verdict: "stable" | "mixed" | "unstable" | "skipped";
    note: string;
  };
  /** Senior hiring-manager verdict (see agents/hiring-manager.ts). */
  hiringReview?: HiringManagerOutput;
}

export function emitCard(input: EmitCardInput): ProfileCard {
  const { profile } = input;

  const makeCardClaim = (c: typeof profile.claims[number], primary = true): CardClaim => {
    const preview = c.evidence_ids.slice(0, 3).flatMap((id) => {
      const a = profile.artifacts[id];
      if (!a) return [];
      return [{
        id,
        type: a.type,
        url: a.source_url,
        title: a.title.slice(0, 160),
      }];
    });
    return {
      id: c.id,
      beat: c.beat,
      text: c.text,
      label: c.label,
      sublabel: c.sublabel,
      confidence: c.confidence,
      status: c.status,
      evidence_count: c.evidence_ids.length,
      evidence_preview: preview,
      primary,
    };
  };

  // HARD GATE: block confidence=low claims from the card entirely.
  // If the critic said it's unreliable, the UI doesn't render it. The
  // full profile still carries them in 13-profile.json for audit / edit;
  // they just don't leak to the frontend card. Prevents the "999 / 1,003
  // features", "EY Scholar", and self-reported-credential class of error
  // without any prompt changes.
  const trustedClaims = profile.claims.filter((c) => c.confidence !== "low");

  // Compute which pattern claims are primary (shown in main panel) vs.
  // secondary (additional context). Caps primary at 6; selects by
  // confidence first, then by evidence depth. The rest are still on the
  // card so users can see them — just flagged secondary.
  const MAX_PRIMARY_PATTERNS = 6;
  const confRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const patternClaimsRanked = trustedClaims
    .filter((c) => c.beat === "pattern")
    .map((c) => ({
      claim: c,
      score: (confRank[c.confidence] ?? 0) * 100 + c.evidence_ids.length,
    }))
    .sort((a, b) => b.score - a.score);
  const primaryPatternIds = new Set(
    patternClaimsRanked.slice(0, MAX_PRIMARY_PATTERNS).map((x) => x.claim.id),
  );

  const claims = trustedClaims.map((c) =>
    makeCardClaim(c, c.beat !== "pattern" || primaryPatternIds.has(c.id)),
  );
  const by = (beat: string) => claims.filter((c) => c.beat === beat);

  const hookArr = by("hook");
  const disclosureArr = by("disclosure");

  const elapsed = profile.meta.stage_timings.reduce(
    (s, st) => s + st.duration_ms,
    0,
  );

  const charts = deriveCharts(profile, input.timeline);

  const card: ProfileCard = {
    handle: profile.handle,
    generated_at: profile.generated_at,
    pipeline_version: profile.pipeline_version,
    primary_shape: input.primary_shape,
    distinctive_paragraph: profile.distinctive_paragraph,

    hook: hookArr[0] ?? null,
    numbers: by("number"),
    // Primary patterns first; secondary after. Frontend can render primary
    // in the main panel and secondary under an "additional context" divider.
    patterns: by("pattern").sort(
      (a, b) => Number(b.primary) - Number(a.primary),
    ),
    disclosure: disclosureArr[0] ?? null,
    shipped: by("shipped-line"),

    charts,

    critic: input.critic
      ? {
          forwardable: input.critic.forwardable,
          overall_score: input.critic.overall_score,
          top_strengths: input.critic.top_strengths,
          top_gaps: input.critic.top_gaps,
          flagged_claim_ids: input.critic.flagged_claims.map((f) => f.claim_id),
        }
      : undefined,

    meta: {
      session_id: profile.meta.session.id,
      session_url: profile.meta.session.dashboard_url,
      total_claims: profile.claims.length,
      total_artifacts: Object.keys(profile.artifacts).length,
      llm_calls: profile.meta.llm_calls,
      web_calls: profile.meta.web_calls,
      github_search_calls: profile.meta.github_search_calls,
      estimated_cost_usd: profile.meta.estimated_cost_usd,
      elapsed_ms: elapsed,
      errors: profile.meta.errors.length,
      stability: input.stability,
      hiring_review: input.hiringReview
        ? {
            verdict: input.hiringReview.verdict,
            overall_score: input.hiringReview.overall_score,
            would_forward: input.hiringReview.forwarding_test.would_a_senior_eng_forward_this,
            why: input.hiringReview.forwarding_test.why_or_why_not,
            block_triggers: input.hiringReview.block_triggers,
            top_fixes: input.hiringReview.top_three_fixes,
          }
        : undefined,
    },
  };

  return card;
}

// ──────────────────────────────────────────────────────────────
// Chart derivation — pure projection from artifacts
// ──────────────────────────────────────────────────────────────

function deriveCharts(
  profile: Profile,
  timeline: TimelineChartEntry[] | undefined,
): Charts {
  // Primary repo selection needs to reflect "where the user actually
  // works" today — not just "highest absolute user_commits on a
  // looks_like_team_repo". Old hackathon wins like Tevo-SIH-2022-Winner
  // were getting picked because their user_commits was inflated
  // relative to the short window; current employers like flightcast-core
  // lost even though they'd been active for 20+ months.
  //
  // New score per repo:
  //   rawScore = user_commits
  //   * recencyMultiplier (1.0 if last commit ≤60d, tapering to 0.2 by 2y)
  //   * windowMultiplier  (1.5 if active for ≥6mo, 1.0 otherwise)
  //   * teamBonus         (1.3 if looks_like_team_repo, else 1.0)
  //
  // Fallback: if nothing passes a minimal threshold, pick the inventory
  // repo with the most recent last-commit regardless of other signals.
  const inventoryArtifacts = Object.values(profile.artifacts).filter((a) => {
    const m = a.metadata as Record<string, unknown>;
    return m.is_inventory === true;
  });

  const now = Date.now();
  const scored = inventoryArtifacts
    .map((a) => {
      const m = a.metadata as Record<string, unknown>;
      const userCommits = Number(m.user_commits ?? 0);
      if (userCommits === 0) return null;
      const lastCommitAt = toTimestamp(m.last_commit_at ?? m.pushed_at);
      const firstCommitAt = toTimestamp(m.first_commit_at ?? m.created_at);
      const recencyDays =
        lastCommitAt > 0 ? (now - lastCommitAt) / 86_400_000 : 9999;
      const windowDays =
        firstCommitAt > 0 && lastCommitAt > 0
          ? (lastCommitAt - firstCommitAt) / 86_400_000
          : 0;
      // Recency taper: 1.0 at ≤60d old, 0.2 at ≥730d old, linear between.
      const recency =
        recencyDays <= 60
          ? 1
          : recencyDays >= 730
            ? 0.2
            : 1 - ((recencyDays - 60) / (730 - 60)) * 0.8;
      const window = windowDays >= 180 ? 1.5 : 1;
      const team = m.looks_like_team_repo ? 1.3 : 1;
      const score = userCommits * recency * window * team;
      return { artifact: a, m, score, lastCommitAt };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score);

  let primary = scored[0]?.artifact;
  if (!primary && inventoryArtifacts.length > 0) {
    primary = [...inventoryArtifacts].sort(
      (a, b) =>
        toTimestamp((b.metadata as Record<string, unknown>).last_commit_at) -
        toTimestamp((a.metadata as Record<string, unknown>).last_commit_at),
    )[0];
  }

  let team: TeamHistogram | null = null;
  let daily: DailyActivity | null = null;
  if (primary) {
    const m = primary.metadata as Record<string, unknown>;
    team = buildTeamHistogram(m, profile.handle);
    daily = buildDailyActivity(m);
  }

  return {
    timeline: timeline ?? [],
    primary_repo_team: team,
    primary_repo_daily_activity: daily,
  };
}

function toTimestamp(v: unknown): number {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

function buildTeamHistogram(
  meta: Record<string, unknown>,
  userHandle: string,
): TeamHistogram {
  const others = Array.isArray(meta.other_top_contributors)
    ? (meta.other_top_contributors as Array<{
        name: string;
        email: string;
        commits: number;
      }>)
    : [];
  const userCommits = Number(meta.user_commits ?? 0);
  const totalCommits = Number(meta.total_commits ?? 0);
  const repo = String(meta.repo ?? "");

  const rows = [
    { name: userHandle, commits: userCommits, is_user: true },
    ...others.map((c) => ({
      name: c.name || c.email,
      commits: c.commits,
      is_user: false,
    })),
  ]
    .filter((r) => r.commits > 0)
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 8);

  return {
    repo,
    total_commits: totalCommits,
    contributors: rows,
  };
}

function buildDailyActivity(
  meta: Record<string, unknown>,
): DailyActivity | null {
  const days = meta.daily_activity as
    | Array<{ date: string; ins: number; del: number; c: number }>
    | undefined;
  if (!days || days.length === 0) return null;
  return {
    repo: String(meta.repo ?? ""),
    days,
  };
}
