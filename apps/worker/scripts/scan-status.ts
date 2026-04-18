#!/usr/bin/env bun
/**
 * Peek at a scan's current state without re-running the full spawn script.
 *
 * Usage:
 *   bun scripts/scan-status.ts <scan_id>
 *   bun scripts/scan-status.ts             # shows the 10 most recent scans
 */
import "dotenv/config";
import { D1Client } from "../src/cloud/d1.js";

const scanId = process.argv[2];
const d1 = D1Client.fromEnv();

if (!scanId) {
  const resp = await d1.query(
    `SELECT id, handle, status, current_phase, last_completed_phase,
            last_heartbeat, error, cost_cents, llm_calls, completed_at
     FROM scans
     ORDER BY created_at DESC
     LIMIT 10`,
  );
  const rows = resp.result?.[0]?.results ?? [];
  for (const r of rows as Array<Record<string, unknown>>) {
    console.log(JSON.stringify(r));
  }
  process.exit(0);
}

const scanResp = await d1.query(`SELECT * FROM scans WHERE id = ?`, [scanId]);
const scan = scanResp.result?.[0]?.results?.[0];
if (!scan) {
  console.error(`no scan with id ${scanId}`);
  process.exit(1);
}

console.log("── scan ──");
console.log(JSON.stringify(scan, null, 2));

const eventsResp = await d1.query(
  `SELECT kind, stage, worker, status, duration_ms, message, at
   FROM scan_events WHERE scan_id = ? ORDER BY id DESC LIMIT 20`,
  [scanId],
);
const events = ((eventsResp.result?.[0]?.results ?? []) as Array<{
  kind: string;
  stage: string | null;
  worker: string | null;
  status: string | null;
  duration_ms: number | null;
  message: string | null;
  at: number;
}>).reverse();

console.log("\n── last 20 events (oldest → newest) ──");
for (const e of events) {
  const bits: string[] = [
    new Date(e.at).toISOString().slice(11, 19),
    `[${e.kind}]`,
  ];
  if (e.stage) bits.push(e.stage);
  if (e.worker) bits.push(`worker=${e.worker}`);
  if (e.status) bits.push(`status=${e.status}`);
  if (e.duration_ms != null) bits.push(`${e.duration_ms}ms`);
  if (e.message) bits.push(`"${e.message.slice(0, 80)}"`);
  console.log("  " + bits.join(" "));
}

const claimsResp = await d1.query(
  `SELECT COUNT(*) as n FROM claims WHERE scan_id = ?`,
  [scanId],
);
const n = (claimsResp.result?.[0]?.results?.[0] as { n: number } | undefined)?.n ?? 0;
console.log(`\nclaims upserted: ${n}`);
