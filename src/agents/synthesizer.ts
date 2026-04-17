/**
 * Profile Synthesizer agent — produces the final unified profile.
 *
 * Model: Sonnet (needs strong judgment + creativity).
 * Input: all per-repo analyses + external contributions + systems + GitHub data.
 * Output: ProfileResult (the complete profile minus evaluation fields).
 */

import * as z from "zod/v4";
import { runAgentWithSubmit } from "./base.js";
import { SYNTHESIZER_PROMPT } from "../prompts/synthesizer.js";
import { ProfileResultSchema } from "../schemas.js";
import type { ProfileResult } from "../schemas.js";
import type { RepoAnalysisResult, ExternalContribution } from "../schemas.js";
import type {
  GitHubData,
  SystemMapping,
  TemporalPrecompute,
} from "../types.js";

interface SynthesizerInput {
  handle: string;
  githubData: GitHubData;
  systems: SystemMapping;
  repoAnalyses: RepoAnalysisResult[];
  externalContributions: ExternalContribution[];
  /** Aggregated temporal data across all repos. */
  aggregateTemporal: TemporalPrecompute | null;
  /** If this is a re-synthesis, include evaluator feedback. */
  evaluatorFeedback?: string;
}

// The synthesizer submits a partial ProfileResult (without evaluation + pipeline meta).
// We strip those fields from the schema for the submit tool.
const SynthesizerOutputSchema = ProfileResultSchema.omit({
  evaluationScore: true,
  evaluationNotes: true,
  pipelineMeta: true,
  generatedAt: true,
});

type SynthesizerOutput = z.infer<typeof SynthesizerOutputSchema>;

export async function runSynthesizer(
  input: SynthesizerInput,
  config: {
    model?: string;
    onProgress?: (text: string) => void;
  } = {}
): Promise<SynthesizerOutput> {
  const inputMessage = buildSynthesizerInput(input);

  const { result } = await runAgentWithSubmit({
    model: config.model ?? "anthropic/claude-sonnet-4.6",
    systemPrompt: SYNTHESIZER_PROMPT,
    input: inputMessage,
    submitToolName: "submit_profile",
    submitToolDescription:
      "Submit the complete developer profile. Call exactly once with all fields populated.",
    submitSchema: SynthesizerOutputSchema,
    reasoning: { effort: "high" },
    onProgress: config.onProgress,
  });

  return result;
}

function buildSynthesizerInput(input: SynthesizerInput): string {
  const sections: string[] = [];

  // GitHub profile
  sections.push(`## Developer: @${input.handle}`);
  sections.push(`Name: ${input.githubData.profile.name ?? input.handle}`);
  sections.push(`Bio: ${input.githubData.profile.bio ?? "(none)"}`);
  sections.push(`Location: ${input.githubData.profile.location ?? "(none)"}`);
  sections.push(
    `Public repos: ${input.githubData.profile.publicRepos}, Followers: ${input.githubData.profile.followers}`
  );
  sections.push(``);

  // System mapping
  sections.push(`## Systems Identified`);
  if (input.systems.systems.length > 0) {
    for (const sys of input.systems.systems) {
      sections.push(
        `- **${sys.name}** (${sys.archetype}): ${sys.repos.join(", ")}`
      );
      sections.push(`  ${sys.description}`);
    }
  }
  if (input.systems.standalone.length > 0) {
    sections.push(
      `Standalone repos: ${input.systems.standalone.join(", ")}`
    );
  }
  sections.push(``);

  // Per-repo analyses
  sections.push(
    `## Per-Repo Analyses (${input.repoAnalyses.length} repos)`
  );
  for (const ra of input.repoAnalyses) {
    sections.push(`### ${ra.repoName} (${ra.archetype})`);
    sections.push(
      `Commits: ${ra.repoSummary.totalCommitsByUser} / ${ra.repoSummary.totalCommitsInRepo}`
    );
    sections.push(`Active days: ${ra.repoSummary.activeDays}`);
    sections.push(
      `Durability: ${ra.durability.score ?? "null"} (${ra.durability.confidence})`
    );
    sections.push(
      `  Lines: ${ra.durability.linesSurviving} surviving, ${ra.durability.durableReplacedLines ?? 0} durable replaced, ${ra.durability.meaningfulRewrites} ephemeral`
    );
    if (ra.durability.byCategory) {
      const cats = Object.entries(ra.durability.byCategory)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      sections.push(`  byCategory: ${cats}`);
    }
    sections.push(
      `Ownership: ${ra.ownership.score ?? "null"} (${ra.ownership.confidence})`
    );
    sections.push(
      `  Analyzed: ${ra.ownership.commitsAnalyzed}, Cleanup: ${ra.ownership.commitsRequiringCleanup}, Solo: ${ra.ownership.soloMaintained}`
    );
    sections.push(
      `Adaptability: rampUp=${ra.adaptability.rampUpDays ?? "null"}, langs=[${ra.adaptability.languagesShipped.join(", ")}]`
    );
    sections.push(`Languages: ${ra.repoSummary.primaryLanguages.join(", ")}`);

    // Evidence summary (don't dump all — just key ones)
    const allEvidence = [
      ...ra.durability.evidence.filter((e) => e.impact === "high"),
      ...ra.ownership.evidence.filter((e) => e.impact === "high"),
    ].slice(0, 5);
    if (allEvidence.length > 0) {
      sections.push(`Key evidence:`);
      for (const ev of allEvidence) {
        sections.push(`  - [${ev.kind ?? ""}] ${ev.description}`);
      }
    }

    sections.push(`Notes: ${ra.notes}`);
    sections.push(``);
  }

  // External contributions
  if (input.externalContributions.length > 0) {
    sections.push(
      `## External Contributions (${input.externalContributions.length} repos)`
    );
    for (const ec of input.externalContributions) {
      sections.push(
        `- **${ec.repoFullName}**: ${ec.mergedCount}/${ec.prCount} merged, significance=${ec.significance}`
      );
      sections.push(`  ${ec.summary}`);
    }
    sections.push(``);
  }

  // Code review data
  const reviewCount = input.githubData.submittedReviews.length;
  const prCount = input.githubData.authoredPRs.filter(
    (p) => !p.isExternal
  ).length;
  if (reviewCount > 0 || prCount > 0) {
    sections.push(`## Code Review Data`);
    sections.push(`PRs authored: ${prCount}`);
    sections.push(`Reviews submitted: ${reviewCount}`);
    if (prCount > 0) {
      sections.push(
        `Review-to-code ratio: ${(reviewCount / Math.max(1, prCount)).toFixed(1)}x`
      );
    }
    sections.push(``);
  }

  // Temporal data
  if (input.aggregateTemporal) {
    sections.push(`## Temporal Data (aggregated across repos)`);
    sections.push(`\`\`\`json`);
    sections.push(JSON.stringify(input.aggregateTemporal, null, 2));
    sections.push(`\`\`\``);
    sections.push(``);
  }

  // Evaluator feedback (for re-synthesis)
  if (input.evaluatorFeedback) {
    sections.push(`## EVALUATOR FEEDBACK (from previous attempt)`);
    sections.push(
      `Your previous profile was rejected. Fix these issues:`
    );
    sections.push(input.evaluatorFeedback);
    sections.push(``);
  }

  sections.push(`---`);
  sections.push(
    `Synthesize all the above into a unified developer profile. Run the self-critique checklist. Then call submit_profile.`
  );

  return sections.join("\n");
}
