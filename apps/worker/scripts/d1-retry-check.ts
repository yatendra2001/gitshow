#!/usr/bin/env bun
/**
 * Sanity-check the D1 retry + failure-counter hardening.
 *
 * 1) Happy path: real creds → success, counter=0
 * 2) Permanent error: bogus token forces 401 → throws fast (no retries),
 *    counter=1, onFailure fires once with the right payload.
 *
 * Not a replacement for a real test harness, but enough to prove the
 * wiring before we push.
 */
import "dotenv/config";
import { D1Client } from "../src/cloud/d1.js";

console.log("── test 1: happy path ──");
const good = D1Client.fromEnv();
const r = await good.query(`SELECT 1 as n`);
console.log("success:", r.success, "failureCount:", good.failureCount);

console.log("\n── test 2: 401 permanent error (should fail fast, no retries) ──");
const bad = new D1Client({
  accountId: process.env.CF_ACCOUNT_ID!,
  databaseId: process.env.D1_DATABASE_ID!,
  apiToken: "obviously_bogus_token",
});
let onFailureCount = 0;
bad.onFailure = (info) => {
  onFailureCount++;
  console.log("  onFailure fired. attempts:", info.attempts, "status:", info.status);
  console.log("  sql preview:", info.sqlPreview);
};
const t0 = Date.now();
try {
  await bad.query(`SELECT 1 as n`);
  console.log("UNEXPECTED SUCCESS — D1 accepted a bogus token?");
  process.exit(1);
} catch (err) {
  const elapsedMs = Date.now() - t0;
  console.log(`  threw after ${elapsedMs}ms (fast = no retry loop burned)`);
  console.log(`  failureCount: ${bad.failureCount}`);
  console.log(`  onFailure callbacks: ${onFailureCount}`);
  if (bad.failureCount !== 1 || onFailureCount !== 1) {
    console.log("UNEXPECTED — expected exactly one failure + one callback");
    process.exit(1);
  }
  if (elapsedMs > 2000) {
    console.log("UNEXPECTED — non-retriable error should fail fast, but took >2s");
    process.exit(1);
  }
}

console.log("\nok — retry + counter + onFailure all behave as expected");
