/**
 * Profile Evaluator agent — LLM-as-judge for profile quality.
 *
 * Model: Sonnet (needs critical judgment).
 * Input: complete ProfileResult draft.
 * Output: EvaluationResult { score, notes, reject, suggestions }.
 */

import * as z from "zod/v4";
import { runAgentWithSubmit } from "./base.js";
import { EVALUATOR_PROMPT } from "../prompts/evaluator.js";
import { EvaluationResultSchema } from "../schemas.js";
import type { EvaluationResultOutput } from "../schemas.js";
import type { ProfileResult } from "../schemas.js";

export async function runEvaluator(
  profile: Omit<ProfileResult, "evaluationScore" | "evaluationNotes" | "pipelineMeta" | "generatedAt">,
  config: {
    model?: string;
    onProgress?: (text: string) => void;
  } = {}
): Promise<EvaluationResultOutput> {
  const inputMessage = buildEvaluatorInput(profile);

  const { result } = await runAgentWithSubmit({
    model: config.model ?? "anthropic/claude-sonnet-4.6",
    systemPrompt: EVALUATOR_PROMPT,
    input: inputMessage,
    submitToolName: "submit_evaluation",
    submitToolDescription:
      "Submit the profile quality evaluation. Score 0-100 with specific feedback.",
    submitSchema: EvaluationResultSchema,
    reasoning: { effort: "high" },
    onProgress: config.onProgress,
  });

  return result;
}

function buildEvaluatorInput(
  profile: Omit<ProfileResult, "evaluationScore" | "evaluationNotes" | "pipelineMeta" | "generatedAt">
): string {
  const sections: string[] = [];

  sections.push(`## Profile to Evaluate`);
  sections.push(``);
  sections.push(`**Handle:** @${profile.handle}`);
  sections.push(`**Hook:** "${profile.hook}"`);
  sections.push(`**Subtitle:** "${profile.subtitle}"`);
  sections.push(``);

  // Core metrics
  sections.push(`### Core Metrics`);
  sections.push(
    `Durability: ${profile.durability.score ?? "null"} (${profile.durability.confidence})`
  );
  sections.push(`  Subtitle: "${profile.durability.subtitle}"`);
  sections.push(
    `  Lines: ${profile.durability.linesSurviving} surviving, ${profile.durability.durableReplacedLines ?? 0} durable, ${profile.durability.meaningfulRewrites} ephemeral`
  );
  sections.push(
    `  Evidence count: ${profile.durability.evidence.length}`
  );
  sections.push(``);
  sections.push(
    `Adaptability: ${profile.adaptability.score ?? "null"} (${profile.adaptability.confidence})`
  );
  sections.push(`  Subtitle: "${profile.adaptability.subtitle}"`);
  sections.push(
    `  Languages: ${profile.adaptability.languages.map((l) => `${l.name}(${l.proficiency})`).join(", ")}`
  );
  sections.push(
    `  Evidence count: ${profile.adaptability.evidence.length}`
  );
  sections.push(``);
  sections.push(
    `Ownership: ${profile.ownership.score ?? "null"} (${profile.ownership.confidence})`
  );
  sections.push(`  Subtitle: "${profile.ownership.subtitle}"`);
  sections.push(
    `  Analyzed: ${profile.ownership.commitsAnalyzed}, Cleanup: ${profile.ownership.commitsRequiringCleanup}`
  );
  sections.push(
    `  Review ratio: ${profile.ownership.reviewToCodeRatio ?? "N/A"}`
  );
  sections.push(``);

  // Radar
  sections.push(`### Radar (${profile.radar.length} dimensions)`);
  for (const dim of profile.radar) {
    sections.push(`  ${dim.trait}: ${dim.value}`);
  }
  sections.push(``);

  // Insights
  sections.push(`### Insights (${profile.insights.length} cards)`);
  for (const ins of profile.insights) {
    const hasChart = ins.chart ? ` [${ins.chart.type} chart]` : "";
    sections.push(`  "${ins.stat}" — ${ins.label}${hasChart}`);
    sections.push(`    ${ins.subtitle}`);
  }
  sections.push(``);

  // Shipped
  sections.push(`### Shipped (${profile.shipped.length} projects)`);
  for (const proj of profile.shipped) {
    sections.push(
      `  ${proj.name} — ${proj.meta} — [${proj.stack.join(", ")}] — ${proj.highlight.label}: ${proj.highlight.value}`
    );
  }
  sections.push(``);

  // Technical depth
  sections.push(
    `### Technical Depth (${profile.technicalDepth.length} skills)`
  );
  for (const td of profile.technicalDepth) {
    sections.push(
      `  ${td.skill}: ${td.level}/100 (${td.projectCount} projects) — ${td.description}`
    );
  }
  sections.push(``);

  // Repo analyses summary
  sections.push(
    `### Per-Repo Analyses (${profile.repoAnalyses.length} repos)`
  );
  for (const ra of profile.repoAnalyses) {
    sections.push(
      `  ${ra.repoName}: dur=${ra.durabilityScore ?? "null"}, own=${ra.ownershipScore ?? "null"}, commits=${ra.commitCount}, role="${ra.role}"`
    );
  }
  sections.push(``);

  // Verification data for the evaluator
  sections.push(`### Verification Points`);
  if (profile.durability.score !== null) {
    const { linesSurviving, durableReplacedLines, meaningfulRewrites } =
      profile.durability;
    const durable = durableReplacedLines ?? 0;
    const denom = linesSurviving + durable + meaningfulRewrites;
    const expected =
      denom > 0
        ? Math.round(((linesSurviving + durable) / denom) * 100)
        : null;
    sections.push(
      `Durability formula check: (${linesSurviving} + ${durable}) / (${linesSurviving} + ${durable} + ${meaningfulRewrites}) x 100 = ${expected}`
    );
    sections.push(
      `Reported score: ${profile.durability.score}. ${Math.abs((profile.durability.score ?? 0) - (expected ?? 0)) <= 2 ? "PASS" : "FAIL — score doesn't match formula"}`
    );
  }
  sections.push(``);

  sections.push(`---`);
  sections.push(
    `Evaluate this profile using the scoring rubric. Call submit_evaluation with your assessment.`
  );

  return sections.join("\n");
}
