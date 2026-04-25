/**
 * Project Ranker — runs after every owned repo has been judged by
 * Kimi. Sonnet 4.6 sees a one-line card per judged repo (Kimi's
 * verdict + repo metadata) and picks the top N to feature on the
 * portfolio grid. Everything not picked falls through to the
 * chronological build-log/timeline section.
 *
 * Why Sonnet here (over Kimi or Opus):
 *   - Kimi already gave us per-repo CONTEXT. The decision now is
 *     comparative + taste-driven ("which 6 best represent this
 *     person's craft?"), which is the section-tier sweet spot.
 *   - Opus is overkill for a single ranking call with bounded I/O.
 *
 * The ranker is one LLM call regardless of how many repos were
 * judged — it sees the full slate at once so it can compare.
 */

import * as z from "zod/v4";
import { runAgentWithSubmit, type AgentEventEmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";
import type { RepoJudgeOutput } from "./repo-judge.js";

/** How many projects to surface in the curated "My Projects" grid. */
export const PROJECT_FEATURE_CAP = 6;

const PickSchema = z.object({
  /** Repo full name ("owner/name") matching one of the candidates. */
  repoFullName: z.string().min(3),
  /** Two-sentence reason for the pick — surfaced in trace.json. */
  reason: z.string().min(8).max(400),
});

export const ProjectRankerOutputSchema = z.object({
  /**
   * Picks in priority order (best first). Length 0..6. The ranker
   * MAY return fewer than 6 if the candidate slate is genuinely
   * weak — better to ship a tight grid than pad it with templates.
   */
  picks: z.array(PickSchema).max(PROJECT_FEATURE_CAP),
  /** One-paragraph rationale — kept short, used in trace.json. */
  rationale: z.string().min(8).max(800),
});
export type ProjectRankerOutput = z.infer<typeof ProjectRankerOutputSchema>;

const SYSTEM_PROMPT = `You are picking the top projects to feature on a developer's portfolio. The rest will appear in a chronological "build log" timeline below the grid — nothing is thrown away.

You receive one card per judged repo with:
  - repoFullName, primaryLanguage, stars, archived, fork
  - judgment.kind        (product / library / tool / experiment / tutorial-follow / template-clone / fork-contribution / contribution-mirror / dotfiles-config / coursework / empty-or-trivial / research-artifact)
  - judgment.polish      (shipped / working / wip / broken / not-code)
  - judgment.purpose     (one-line honest description from the per-repo judge)
  - judgment.shouldFeature (the per-repo judge's recommendation — advisory; you OVERRIDE)
  - judgment.reason      (the per-repo judge's rationale)

Rules for picking up to 6:
  - HARD EXCLUDE: contribution-mirror, dotfiles-config, empty-or-trivial, tutorial-follow, template-clone. Never feature these.
  - HARD EXCLUDE: archived AND polish=broken — those are dead and broken; the timeline can have them.
  - PREFER kind=product or kind=library with polish=shipped or polish=working.
  - PREFER repos where the judgment.purpose reads like a real product description ("Open-source X for Y") over generic ones ("A toy implementation of Z").
  - Stars are a tie-breaker, not a gate. A 0-star polished product beats a 200-star tutorial-follow.
  - Range matters: if you can pick 5 polished products and 1 strong library, that's better than 6 near-identical CRUD apps. But don't reach for diversity if one bucket is genuinely stronger.
  - You MAY return fewer than 6 picks if the slate is weak. A tight 4-project grid beats a padded 6.

Output: call submit_picks with the picks (best first) plus a one-paragraph rationale explaining your top-level shape (what you led with, what you pushed to the timeline). DO NOT call any other tool.`;

export interface ProjectRankerInput {
  session: ScanSession;
  usage: SessionUsage;
  judgments: Record<string, RepoJudgeOutput>;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
  emit?: AgentEventEmit;
}

export async function runProjectRanker(
  input: ProjectRankerInput,
): Promise<ProjectRankerOutput> {
  const { session, usage, judgments, trace, onProgress, emit } = input;

  const cards = formatJudgmentCards(judgments);
  if (cards.candidateCount === 0) {
    return { picks: [], rationale: "No judged repos to rank." };
  }

  // Single-shot rank — Sonnet sees ALL judged repos at once so it
  // can compare. The card body is bounded (~120 tokens per repo),
  // so even 200 repos fits comfortably in context.
  const userInput = [
    `## Candidates (${cards.candidateCount} judged repos)\n`,
    cards.body,
    `\n---`,
    `Pick up to ${PROJECT_FEATURE_CAP} for the portfolio grid. Anything you don't pick goes to the chronological build-log timeline below the grid.`,
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

  // Filter picks to ones that actually matched a candidate — if the
  // model hallucinates a repo name, we drop it rather than letting a
  // ghost-rank propagate into the KG.
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
    lines.push(`  kind=${j.judgment.kind}  polish=${j.judgment.polish}`);
    lines.push(`  purpose: ${j.judgment.purpose}`);
    lines.push(
      `  judge.shouldFeature=${j.judgment.shouldFeature}; reason: ${truncate(j.judgment.reason, 240)}`,
    );
    lines.push("");
  }
  return { body: lines.join("\n"), candidateCount: n };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
