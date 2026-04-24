#!/usr/bin/env bun
/**
 * One-off audit: dump every interesting column + event count for a scan,
 * plus the shape of the resume JSON (counts per section). Used for
 * diagnosing why a "succeeded" scan still produces thin output.
 *
 * Usage: bun scripts/audit-scan.ts <scan_id>
 */
import "dotenv/config";
import { D1Client } from "../src/cloud/d1.js";

const scanId = process.argv[2];
if (!scanId) {
  console.error("usage: bun scripts/audit-scan.ts <scan_id>");
  process.exit(1);
}

const d1 = D1Client.fromEnv();

const scanResp = await d1.query(`SELECT * FROM scans WHERE id = ?`, [scanId]);
const scan = scanResp.result?.[0]?.results?.[0] as Record<string, unknown> | undefined;
if (!scan) {
  console.error(`no scan with id ${scanId}`);
  process.exit(1);
}

console.log("== columns ==");
for (const k of Object.keys(scan)) {
  const v = scan[k];
  if (v === null || v === undefined) continue;
  const str = typeof v === "string" ? v : JSON.stringify(v);
  console.log(`${k}: ${str.slice(0, 200)}${str.length > 200 ? " …" : ""}`);
}

const evResp = await d1.query(
  `SELECT kind, stage, status, duration_ms, message FROM scan_events WHERE scan_id = ? ORDER BY at DESC, id DESC LIMIT 200`,
  [scanId],
);
const events = (evResp.result?.[0]?.results ?? []) as Array<{
  kind: string;
  stage: string | null;
  status: string | null;
  duration_ms: number | null;
  message: string | null;
}>;
console.log(`\n== ${events.length} events ==`);
const byStage: Record<string, { starts: number; ends: number; ms: number }> = {};
for (const e of events) {
  if (!e.stage) continue;
  byStage[e.stage] ??= { starts: 0, ends: 0, ms: 0 };
  if (e.kind === "stage-start") byStage[e.stage].starts++;
  if (e.kind === "stage-end") {
    byStage[e.stage].ends++;
    if (e.duration_ms) byStage[e.stage].ms += e.duration_ms;
  }
}
for (const [stage, s] of Object.entries(byStage).sort((a, b) => b[1].ms - a[1].ms)) {
  console.log(`  ${stage}: ${(s.ms / 1000).toFixed(1)}s (${s.starts} starts, ${s.ends} ends)`);
}

for (const col of ["resume_json", "blog_json"] as const) {
  const v = (scan as Record<string, unknown>)[col];
  if (typeof v !== "string") continue;
  try {
    const j = JSON.parse(v);
    console.log(`\n== ${col} top-level keys ==`);
    for (const k of Object.keys(j)) {
      const val = (j as Record<string, unknown>)[k];
      if (Array.isArray(val)) console.log(`  ${k}: [${val.length}]`);
      else if (typeof val === "string") console.log(`  ${k}: "${val.slice(0, 80)}${val.length > 80 ? "…" : ""}"`);
      else if (val && typeof val === "object") console.log(`  ${k}: {${Object.keys(val).length}}`);
      else console.log(`  ${k}: ${JSON.stringify(val)}`);
    }
  } catch {
    /* not JSON */
  }
}
