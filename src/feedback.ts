/**
 * User feedback system.
 *
 * After a profile is generated, the user can submit corrections via
 * a feedback.json file. The pipeline re-analyzes affected repos/metrics
 * with the user's context, and the agent investigates whether the
 * correction is valid.
 *
 * Flow:
 * 1. User reads profile + reasoning
 * 2. User writes feedback.json with corrections
 * 3. `bun run profile -- --handle X --feedback` re-runs with corrections
 * 4. Affected repo analyzers get user context injected
 * 5. Synthesis agent sees corrections + investigation results
 * 6. Updated profile includes feedbackApplied notes
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { UserFeedback, UserCorrection } from "./types.js";

const FEEDBACK_FILENAME = "feedback.json";

/**
 * Load user feedback from the checkpoint directory.
 * Returns null if no feedback file exists.
 */
export async function loadFeedback(
  checkpointDir: string
): Promise<UserFeedback | null> {
  const path = join(checkpointDir, FEEDBACK_FILENAME);
  if (!existsSync(path)) return null;

  try {
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw);

    // Validate basic structure
    if (!data.corrections || !Array.isArray(data.corrections)) {
      console.warn(`[feedback] Invalid feedback.json — missing corrections array`);
      return null;
    }

    return data as UserFeedback;
  } catch (err) {
    console.warn(
      `[feedback] Failed to parse feedback.json: ${(err as Error).message}`
    );
    return null;
  }
}

/**
 * Create an empty feedback template file for the user to fill in.
 */
export async function createFeedbackTemplate(
  checkpointDir: string,
  handle: string
): Promise<string> {
  const template: UserFeedback = {
    handle,
    submittedAt: "",
    corrections: [
      {
        target: "durability",
        repo: "owner/repo-name",
        issue:
          "Describe what you think is wrong. Example: 'The deleted onboarding files were moved to a new directory, not removed. This was a refactor, not a durability failure.'",
        expectedImpact:
          "What you think the correct result should be. Example: 'Durability should be higher — these are file moves, not deletions.'",
      },
    ],
  };

  const path = join(checkpointDir, FEEDBACK_FILENAME);
  await writeFile(path, JSON.stringify(template, null, 2));
  return path;
}

/**
 * Format feedback corrections into context that gets injected into agent prompts.
 *
 * For repo-specific corrections: injected into that repo's analyzer prompt.
 * For general corrections: injected into the synthesis prompt.
 */
export function formatFeedbackForRepoAgent(
  corrections: UserCorrection[],
  repoName: string
): string | null {
  const relevant = corrections.filter(
    (c) =>
      c.repo?.toLowerCase() === repoName.toLowerCase() ||
      (!c.repo && c.target !== "general" && c.target !== "insight")
  );

  if (relevant.length === 0) return null;

  const lines: string[] = [
    `## USER FEEDBACK — Corrections to investigate`,
    ``,
    `The developer reviewed your previous analysis and submitted corrections.`,
    `For each correction: INVESTIGATE whether they are right. Use \`run\` to check.`,
    `Do NOT blindly accept — verify with git data. Then report your finding.`,
    ``,
  ];

  for (let i = 0; i < relevant.length; i++) {
    const c = relevant[i]!;
    lines.push(`### Correction ${i + 1}: ${c.target}`);
    lines.push(`**User says:** ${c.issue}`);
    if (c.expectedImpact) {
      lines.push(`**Expected impact:** ${c.expectedImpact}`);
    }
    lines.push(
      `**Your job:** Investigate this claim. Use \`git log --follow\`, \`git show\`, etc. ` +
        `Report whether the user is correct, partially correct, or incorrect, with evidence.`
    );
    lines.push(``);
  }

  return lines.join("\n");
}

/**
 * Format general feedback for the synthesis agent.
 */
export function formatFeedbackForSynthesis(
  corrections: UserCorrection[]
): string | null {
  const general = corrections.filter(
    (c) => c.target === "general" || c.target === "insight" || !c.repo
  );

  if (general.length === 0) return null;

  const lines: string[] = [
    `## USER FEEDBACK — General corrections`,
    ``,
    `The developer reviewed the profile and submitted these corrections.`,
    `Incorporate the feedback where it's backed by data.`,
    ``,
  ];

  for (const c of general) {
    lines.push(`- **[${c.target}]** ${c.issue}`);
    if (c.expectedImpact) lines.push(`  Expected: ${c.expectedImpact}`);
  }

  return lines.join("\n");
}
