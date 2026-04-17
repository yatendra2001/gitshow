/**
 * Repo Analyzer agent — deep analysis of a single repo.
 *
 * Model: Sonnet (needs accurate judgment for ownership classification).
 * Input: StructuredInventory JSON for one repo.
 * Output: RepoAnalysisResult (per-repo scores, evidence, commit classifications).
 */

import * as z from "zod/v4";
import { runAgentWithSubmit, createBashTool } from "./base.js";
import { REPO_ANALYZER_PROMPT } from "../prompts/repo-analyzer.js";
import { RepoAnalysisResultSchema } from "../schemas.js";
import type { RepoAnalysisResult } from "../schemas.js";
import type { StructuredInventory } from "../types.js";
import { executeBash } from "../tools.js";

export async function runRepoAnalyzer(
  inventory: StructuredInventory,
  config: {
    model?: string;
    onProgress?: (text: string) => void;
  } = {}
): Promise<RepoAnalysisResult> {
  // Build the structured input message for the agent.
  // We send JSON — the agent doesn't need to parse markdown.
  const inputMessage = buildInputMessage(inventory);

  const bashTool = createBashTool(inventory.repoPath, executeBash);

  const { result } = await runAgentWithSubmit({
    model: config.model ?? "anthropic/claude-sonnet-4.6",
    systemPrompt: REPO_ANALYZER_PROMPT,
    input: inputMessage,
    extraTools: [bashTool],
    submitToolName: "submit_repo_analysis",
    submitToolDescription:
      "Submit the repo analysis result. Call exactly once with all metrics populated.",
    submitSchema: RepoAnalysisResultSchema,
    reasoning: { effort: "high" },
    onProgress: config.onProgress,
  });

  return result;
}

function buildInputMessage(inv: StructuredInventory): string {
  const sections: string[] = [];

  sections.push(`## Repo: ${inv.repoName}`);
  sections.push(`Path: ${inv.repoPath}`);
  sections.push(``);

  // Identity
  if (inv.identity) {
    sections.push(`## Resolved Identity`);
    sections.push(
      `${inv.identity.name} <${inv.identity.email}> — ${inv.identity.commits} commits`
    );
  } else {
    sections.push(`## Identity: UNRESOLVED`);
    sections.push(`Could not match handle to a git author.`);
  }
  sections.push(``);

  // Stats
  sections.push(`## Stats`);
  sections.push(`\`\`\`json`);
  sections.push(JSON.stringify(inv.stats, null, 2));
  sections.push(`\`\`\``);
  sections.push(``);

  // Surviving files lifecycle (the key durability data)
  sections.push(`## Surviving Files Lifecycle (FIFO pre-computed)`);
  sections.push(`Aggregate stats:`);
  sections.push(`\`\`\`json`);
  sections.push(JSON.stringify(inv.survivingStats, null, 2));
  sections.push(`\`\`\``);
  sections.push(``);

  // Per-file lifecycle details (top 50 by insertions for context)
  if (inv.fileLifecycles.length > 0) {
    const topLifecycles = inv.fileLifecycles
      .sort((a, b) => b.totalUserInsertions - a.totalUserInsertions)
      .slice(0, 50);

    sections.push(
      `Per-file details (top ${topLifecycles.length} of ${inv.fileLifecycles.length} by user insertions):`
    );
    sections.push(`\`\`\`json`);
    sections.push(JSON.stringify(topLifecycles, null, 2));
    sections.push(`\`\`\``);
    sections.push(``);
  }

  // Deleted files
  sections.push(`## Deleted File Lifecycle`);
  sections.push(`Aggregate stats:`);
  sections.push(`\`\`\`json`);
  sections.push(JSON.stringify(inv.deletedStats, null, 2));
  sections.push(`\`\`\``);
  if (inv.deletedFiles.length > 0) {
    sections.push(`\`\`\`json`);
    sections.push(JSON.stringify(inv.deletedFiles, null, 2));
    sections.push(`\`\`\``);
  }
  sections.push(``);

  // Blame
  if (inv.blameEntries.length > 0) {
    sections.push(`## Blame at HEAD (top ${inv.blameEntries.length} files)`);
    sections.push(`\`\`\`json`);
    sections.push(JSON.stringify(inv.blameEntries.slice(0, 50), null, 2));
    sections.push(`\`\`\``);
    sections.push(``);
  }

  // Ownership matrix
  sections.push(`## Ownership Matrix (${inv.ownershipEntries.length} entries)`);
  if (inv.ownershipEntries.length > 0) {
    // Send a representative sample — all with followups + a sample without
    const withFollowups = inv.ownershipEntries.filter(
      (e) => e.followups.length > 0
    );
    const withoutFollowups = inv.ownershipEntries.filter(
      (e) => e.followups.length === 0
    );

    sections.push(
      `Total: ${inv.ownershipEntries.length} substantive commits. ` +
        `${withFollowups.length} with follow-ups, ${withoutFollowups.length} without.`
    );
    sections.push(``);
    sections.push(`Entries with follow-ups (${withFollowups.length}):`);
    sections.push(`\`\`\`json`);
    sections.push(JSON.stringify(withFollowups.slice(0, 300), null, 2));
    sections.push(`\`\`\``);
    sections.push(``);

    if (withoutFollowups.length > 0) {
      sections.push(
        `Sample of entries WITHOUT follow-ups (${Math.min(50, withoutFollowups.length)} of ${withoutFollowups.length}):`
      );
      sections.push(`\`\`\`json`);
      // Evenly sample
      const step = Math.max(1, Math.floor(withoutFollowups.length / 50));
      const sample = withoutFollowups.filter((_, i) => i % step === 0).slice(0, 50);
      sections.push(
        JSON.stringify(
          sample.map((e) => ({
            sha: e.userCommitSha,
            date: e.userCommitDate,
            subject: e.userCommitSubject,
            category: e.category,
          })),
          null,
          2
        )
      );
      sections.push(`\`\`\``);
    }
  }
  sections.push(``);

  // Language breakdown
  sections.push(`## Language Breakdown`);
  sections.push(`\`\`\`json`);
  sections.push(JSON.stringify(inv.languageLoc, null, 2));
  sections.push(`\`\`\``);
  sections.push(``);

  // Top files
  sections.push(`## Top User Files (${inv.topFiles.length})`);
  sections.push(`\`\`\`json`);
  sections.push(JSON.stringify(inv.topFiles.slice(0, 100), null, 2));
  sections.push(`\`\`\``);
  sections.push(``);

  // Temporal
  sections.push(`## Temporal Data`);
  sections.push(`\`\`\`json`);
  sections.push(JSON.stringify(inv.temporal, null, 2));
  sections.push(`\`\`\``);
  sections.push(``);

  // Commit list (summary — too large to include all)
  const commitCount = inv.commits.length;
  sections.push(`## Commit List (${commitCount} total)`);
  if (commitCount > 200) {
    sections.push(
      `Showing first 100 + last 100 commits (use \`run\` tool to explore more):`
    );
    const first100 = inv.commits.slice(0, 100);
    const last100 = inv.commits.slice(-100);
    sections.push(`\`\`\`json`);
    sections.push(JSON.stringify([...first100, ...last100], null, 2));
    sections.push(`\`\`\``);
  } else {
    sections.push(`\`\`\`json`);
    sections.push(JSON.stringify(inv.commits, null, 2));
    sections.push(`\`\`\``);
  }
  sections.push(``);

  sections.push(`---`);
  sections.push(
    `Analyze this repository. Read ALL the data above. Compute durability, adaptability, ownership. When ready, call submit_repo_analysis.`
  );

  return sections.join("\n");
}
