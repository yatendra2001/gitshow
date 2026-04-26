/**
 * Project Ranker — runs after every owned repo has been judged by Kimi
 * AND investigated by Gemini grounded for external evidence. Sonnet 4.6
 * sees a card per repo (Kimi verdict + git-blame attribution + Gemini
 * external-traction report) and picks the top N to feature on the
 * portfolio grid. Everything not picked falls through to the
 * chronological build-log/timeline section.
 *
 * Three explicit ranking axes baked into the prompt:
 *   1. FAMOUS  — external traction (Gemini reception band + GitHub stars).
 *   2. DEPTH   — actual contribution (git-blame userShare + commit count).
 *   3. CHALLENGE — technical ambition (Kimi kind + technologies + novelty).
 *
 * Sonnet writes per-pick scores on each axis so we can debug the
 * verdict from trace.json without re-running.
 */

import * as z from "zod/v4";
import { runAgentWithSubmit, type AgentEventEmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";
import type { RepoJudgeOutput } from "./repo-judge.js";
import type { RepoEvidence } from "./repo-evidence.js";
import type { RepoStudy } from "../../repo-study.js";

/** How many projects to surface in the curated "My Projects" grid. */
export const PROJECT_FEATURE_CAP = 6;

const AxisScoreSchema = z.object({
  famous: z.number().min(0).max(10),
  depth: z.number().min(0).max(10),
  challenge: z.number().min(0).max(10),
});

const PickSchema = z.object({
  /** Repo full name ("owner/name") matching one of the candidates. */
  repoFullName: z.string().min(3),
  /** Two-sentence reason for the pick — surfaced in trace.json. */
  reason: z.string().min(8).max(400),
  /** Per-axis 0-10 score so we can debug the ranking. */
  axisScores: AxisScoreSchema,
});

export const ProjectRankerOutputSchema = z.object({
  picks: z.array(PickSchema).max(PROJECT_FEATURE_CAP),
  /** One-paragraph rationale — kept short, used in trace.json. */
  rationale: z.string().min(8).max(800),
});
export type ProjectRankerOutput = z.infer<typeof ProjectRankerOutputSchema>;

const SYSTEM_PROMPT = `You are picking the top projects to feature on a developer's portfolio.
The rest will appear in a chronological "build log" timeline below the
grid — nothing is thrown away.

Each candidate card has:
  - repoFullName, primaryLanguage, stars, archived, fork
  - userShare    (0..1 — fraction of repo lines this user authored, from git blame)
  - userCommits  (commits authored by this user / total non-merge commits)
  - userLines    (lines authored by this user / total)
  - judgment.kind   (product / library / tool / experiment / tutorial-follow / template-clone / fork-contribution / contribution-mirror / dotfiles-config / coursework / empty-or-trivial / research-artifact)
  - judgment.polish (shipped / working / wip / broken / not-code)
  - judgment.purpose (one-line honest description from Kimi)
  - judgment.shouldFeature (Kimi's recommendation — advisory; you OVERRIDE)
  - judgment.technologies (extracted tech stack, max 10)
  - evidence.reception (viral / notable / niche / unknown — Gemini grounded)
  - evidence.mentions (real external mentions Gemini cited via URL)
  - evidence.report (markdown summary of external traction)

────────────────────────────────────────────────────────────────────
RANK ON THREE AXES, EACH 0-10. Score all picks, even at the bottom.

1. FAMOUS — external impact / reach
   10 = viral (HN front page, 1k+ stars + press, viral tweets)
    7 = notable (covered on dev.to / podcasts / multiple blog posts)
    4 = niche (some external mentions but small audience)
    1 = unknown (no external info beyond the GitHub repo itself)
   Use evidence.reception as the primary signal; stars are secondary.

2. DEPTH — evidence the user actually built this
   10 = userShare ≥ 0.8 with 50+ commits over months
    7 = userShare ≥ 0.5 with substantial commit history
    4 = userShare ≥ 0.2 with credible work
    1 = userShare < 0.1 (likely fork / template / drive-by)
   Treat this as a TRUTH check. A polished-looking repo with userShare
   < 0.1 is almost certainly someone else's work.

3. CHALLENGE — technical ambition / showcases skill
   10 = research-grade or novel system (distributed, ML, infra, compiler, ...)
    7 = real product / library with non-trivial domain logic
    4 = competent app or tool above CRUD baseline
    1 = tutorial output, template clone, glue script

────────────────────────────────────────────────────────────────────
HARD EXCLUDES — never pick these regardless of axis scores:
- judgment.kind in {contribution-mirror, dotfiles-config, empty-or-trivial,
  tutorial-follow, template-clone}
- archived AND polish=broken (it's dead and broken)
- userShare < 0.10 on substantial repos (>5 KB total source) — fork or
  barely-touched template, doesn't represent the user's craft

────────────────────────────────────────────────────────────────────
SELECTION RULES:
- Compose the top 6 to maximize sum-of-axis-scores while keeping each
  pick credible on DEPTH (depth ≥ 4 always — never feature work the
  user didn't really do).
- Prefer a famous-OSS contribution (high FAMOUS, depth ≥ 4) over a
  similar-quality unknown personal repo. External validation is real
  signal.
- A 0-star polished solo build with depth=10 challenge=7 beats a
  200-star tutorial-follow.
- Keep range — if you can pick 4 polished products + 1 strong library +
  1 famous OSS contribution, that's better than 6 near-identical CRUD
  apps. But don't reach for diversity if one bucket is genuinely
  stronger.
- You MAY return fewer than 6 picks if the slate is weak. A tight 4-
  project grid beats a padded 6.
- Order picks BEST-FIRST. Pick #0 should be the user's strongest work
  on the combined axes.

────────────────────────────────────────────────────────────────────
Output — call submit_picks once with picks in best-first order plus a
one-paragraph rationale explaining your top-level shape (what you led
with, what you pushed to the timeline, any tough calls).`;

export interface ProjectRankerInput {
  session: ScanSession;
  usage: SessionUsage;
  judgments: Record<string, RepoJudgeOutput>;
  /** Per-repo evidence reports from the Gemini grounded stage. */
  evidence?: Record<string, RepoEvidence>;
  /** Per-repo blame stats keyed by full name (provided when available). */
  studies?: Record<string, RepoStudy>;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
  emit?: AgentEventEmit;
}

export async function runProjectRanker(
  input: ProjectRankerInput,
): Promise<ProjectRankerOutput> {
  const { session, usage, judgments, evidence, studies, trace, onProgress, emit } = input;

  const cards = formatJudgmentCards(judgments, studies, evidence);
  if (cards.candidateCount === 0) {
    return { picks: [], rationale: "No judged repos to rank." };
  }

  const userInput = [
    `## Candidates (${cards.candidateCount} judged repos)\n`,
    cards.body,
    `\n---`,
    `Pick up to ${PROJECT_FEATURE_CAP} for the portfolio grid. Anything you don't pick goes to the chronological build-log timeline below the grid.`,
    `Score every pick on FAMOUS, DEPTH, CHALLENGE (0-10 each).`,
    `Call submit_picks once.`,
  ].join("\n");

  const { result } = await runAgentWithSubmit({
    model: modelForRole("section"),
    systemPrompt: SYSTEM_PROMPT,
    input: userInput,
    submitToolName: "submit_picks",
    submitToolDescription:
      "Submit the ranked top picks for the portfolio grid. Call exactly once.",
    submitSchema: ProjectRankerOutputSchema,
    reasoning: { effort: "medium" },
    session,
    usage,
    label: "project-ranker",
    onProgress,
    trace,
    emit,
  });

  const validNames = new Set(Object.keys(judgments));
  const filteredPicks = result.picks.filter((p) =>
    validNames.has(p.repoFullName),
  );

  return {
    picks: filteredPicks,
    rationale: result.rationale,
  };
}

function formatJudgmentCards(
  judgments: Record<string, RepoJudgeOutput>,
  studies?: Record<string, RepoStudy>,
  evidence?: Record<string, RepoEvidence>,
): { body: string; candidateCount: number } {
  const lines: string[] = [];
  let n = 0;
  for (const [fullName, j] of Object.entries(judgments)) {
    n += 1;
    const r = j.repo;
    const stars = r.stargazerCount ?? 0;
    const flags = [
      r.isArchived ? "archived" : "",
      r.isFork ? "fork" : "",
      r.isPrivate ? "private" : "",
    ]
      .filter(Boolean)
      .join(",");
    const meta = [
      `lang=${r.primaryLanguage ?? "?"}`,
      `stars=${stars}`,
      flags ? `flags=${flags}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`### ${fullName}`);
    lines.push(`  meta: ${meta}`);
    const study = studies?.[fullName];
    if (study) {
      lines.push(
        `  attribution: userShare=${(study.userShare * 100).toFixed(0)}%  userCommits=${study.userCommits}/${study.totalCommits}  userLines=${study.userLines}/${study.totalLines}`,
      );
    } else {
      lines.push(`  attribution: (not available — study did not run)`);
    }
    lines.push(`  kind=${j.judgment.kind}  polish=${j.judgment.polish}`);
    lines.push(`  purpose: ${j.judgment.purpose}`);
    if (j.judgment.technologies && j.judgment.technologies.length > 0) {
      lines.push(`  technologies: ${j.judgment.technologies.join(", ")}`);
    }
    lines.push(
      `  judge.shouldFeature=${j.judgment.shouldFeature}; reason: ${truncate(j.judgment.reason, 240)}`,
    );

    const ev = evidence?.[fullName];
    if (ev) {
      lines.push(
        `  evidence.reception=${ev.reception}  mentions=${ev.mentions.length}`,
      );
      if (ev.mentions.length > 0) {
        lines.push(
          `  evidence.mentions: ${ev.mentions
            .slice(0, 3)
            .map((m) => `${m.source}: ${truncate(m.title, 80)}`)
            .join(" | ")}`,
        );
      }
      if (ev.reportMarkdown) {
        lines.push(`  evidence.report:`);
        for (const ln of ev.reportMarkdown.split("\n")) {
          lines.push(`    ${ln}`);
        }
      }
    } else {
      lines.push(`  evidence: (skipped — kind in noise list)`);
    }
    lines.push("");
  }
  return { body: lines.join("\n"), candidateCount: n };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
