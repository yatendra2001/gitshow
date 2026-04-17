/**
 * PR Analyst agent — evaluates external PR contributions.
 *
 * Model: Haiku for small PRs (<200 LOC), Sonnet for large.
 * Input: PR metadata + diff for external repos.
 * Output: ExternalContribution per repo.
 */

import * as z from "zod/v4";
import { runAgentWithSubmit, createBashTool } from "./base.js";
import { PR_ANALYST_PROMPT } from "../prompts/pr-analyst.js";
import { ExternalContributionSchema } from "../schemas.js";
import type { ExternalContribution } from "../schemas.js";
import type { GitHubPR } from "../types.js";
import { executeBash } from "../tools.js";

interface PRAnalystInput {
  repoFullName: string;
  prs: GitHubPR[];
}

export async function runPRAnalyst(
  input: PRAnalystInput,
  config: {
    model?: string;
    onProgress?: (text: string) => void;
  } = {}
): Promise<ExternalContribution> {
  const totalLoc = input.prs.reduce(
    (sum, pr) => sum + pr.additions + pr.deletions,
    0
  );
  const model = config.model ?? "anthropic/claude-sonnet-4.6";

  const prSummaries = input.prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    merged: pr.merged,
    mergedAt: pr.mergedAt,
    createdAt: pr.createdAt,
  }));

  const inputMessage = `## External Contribution Analysis

Repository: ${input.repoFullName}
PRs by this developer: ${input.prs.length}
Merged: ${input.prs.filter((p) => p.merged).length}
Total LOC changed: ${totalLoc}

### PR Details
\`\`\`json
${JSON.stringify(prSummaries, null, 2)}
\`\`\`

You can use the \`run\` tool to fetch more details:
- \`gh pr view ${input.prs[0]?.number} --repo ${input.repoFullName} --json body,reviews,comments\`
- \`gh pr diff ${input.prs[0]?.number} --repo ${input.repoFullName} | head 200\`

Evaluate these contributions and call submit_pr_analysis.`;

  // Give the agent gh CLI access for deeper investigation
  const bashTool = createBashTool("/tmp", executeBash);

  const { result } = await runAgentWithSubmit({
    model,
    systemPrompt: PR_ANALYST_PROMPT,
    input: inputMessage,
    extraTools: [bashTool],
    submitToolName: "submit_pr_analysis",
    submitToolDescription:
      "Submit the external contribution analysis for this repository.",
    submitSchema: ExternalContributionSchema,
    reasoning: { effort: "high" },
    onProgress: config.onProgress,
  });

  return result;
}
