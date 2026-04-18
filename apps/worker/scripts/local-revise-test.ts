#!/usr/bin/env bun
/**
 * Local smoke test for revise-claim logic — runs the entrypoint in the
 * current process against real R2 + D1, skipping Fly entirely. Picks the
 * first claim of the target beat, prints before/after, prompts once.
 *
 * Usage:
 *   bun scripts/local-revise-test.ts <scan_id> <beat> <guidance...>
 *
 * e.g.
 *   bun scripts/local-revise-test.ts test-1776514662321-6q0hoG hook \
 *     "Lead with operator density and ship cadence, not credentials."
 */
import "dotenv/config";
import { D1Client } from "../src/cloud/d1.js";

const args = process.argv.slice(2);
const scanId = args[0];
const beat = args[1];
const guidance = args.slice(2).join(" ").trim();

if (!scanId || !beat || !guidance) {
  console.error('usage: bun scripts/local-revise-test.ts <scan_id> <beat> "<guidance...>"');
  console.error('  supported beats: hook, number, disclosure');
  process.exit(1);
}

const d1 = D1Client.fromEnv();

console.log("── Picking target claim ──");
const pickResp = await d1.query(
  `SELECT id, beat, text FROM claims WHERE scan_id = ? AND beat = ? ORDER BY idx ASC LIMIT 1`,
  [scanId, beat],
);
const pick = pickResp.result?.[0]?.results?.[0] as
  | { id: string; beat: string; text: string }
  | undefined;
if (!pick) {
  console.error(`no claim with beat="${beat}" in scan ${scanId}`);
  process.exit(1);
}
console.log(`  claim_id: ${pick.id}`);
console.log(`  before:   ${pick.text}`);
console.log(`  guidance: ${guidance}`);

process.env.GITSHOW_CLOUD_MODE = "1";
process.env.SCAN_ID = scanId;
process.env.CLAIM_ID = pick.id;
process.env.GUIDANCE = guidance;

console.log("\n── Running revise-claim entrypoint in-process ──\n");
await import("./revise-claim.js");
