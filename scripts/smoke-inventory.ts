#!/usr/bin/env bun
/**
 * Smoke test: runs gatherInventory on a repo and dumps structured stats
 * plus a slice of the formatted-for-agent output. No Claude API calls.
 *
 * Usage: bun scripts/smoke-inventory.ts <repo-path> <handle>
 */
import { gatherInventory, formatInventoryForAgent } from "../src/git-inventory.js";

async function main() {
  const [, , repo, handle] = process.argv;
  if (!repo || !handle) {
    console.error("Usage: bun scripts/smoke-inventory.ts <repo-path> <handle>");
    process.exit(1);
  }

  const started = Date.now();
  console.log(`[smoke] gathering inventory for ${repo} @${handle}...`);
  const inv = await gatherInventory(repo, handle);
  const ms = Date.now() - started;

  console.log();
  console.log(`=== STRUCTURED ===`);
  console.log(`  time: ${ms}ms`);
  console.log(`  repoName: ${inv.repoName}`);
  console.log(`  isGitRepo: ${inv.isGitRepo}`);
  console.log(`  totalCommitsAll: ${inv.totalCommitsAll}`);
  console.log(`  totalContributors: ${inv.totalContributors}`);
  console.log(`  resolvedIdentity: ${JSON.stringify(inv.resolvedIdentity)}`);
  console.log(`  userCommitCount: ${inv.userCommitCount}`);
  console.log(`  activeDays: ${inv.activeDays}`);
  console.log(`  ownershipStats: ${JSON.stringify(inv.ownershipStats)}`);
  console.log(`  userCommits chars: ${inv.userCommits.length}`);
  console.log(`  userCommitsOverflow: ${inv.userCommitsOverflow}`);
  console.log(`  topUserFiles chars: ${inv.topUserFiles.length}`);
  console.log(`  languageLoc chars: ${inv.languageLoc.length}`);
  console.log(`  blameRendered chars: ${inv.blameRendered.length}`);
  console.log(`  ownershipMatrixRendered chars: ${inv.ownershipMatrixRendered.length}`);
  console.log();

  const formatted = formatInventoryForAgent(inv);
  console.log(`=== FORMATTED TOTAL: ${formatted.length} chars (~${Math.round(formatted.length / 4)} tokens) ===`);
  console.log();
  console.log(`=== FORMATTED FIRST 6000 CHARS ===`);
  console.log(formatted.slice(0, 6000));
  console.log();
  console.log(`=== (end preview, ${formatted.length - 6000} more chars truncated) ===`);
}

main().catch((err) => {
  console.error("[smoke] error:", err);
  process.exit(1);
});
