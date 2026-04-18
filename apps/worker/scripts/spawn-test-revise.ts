#!/usr/bin/env bun
/**
 * End-to-end smoke test for the revise-claim entrypoint.
 *
 * Picks an existing claim from D1 (hook/number/disclosure) for the given
 * scan_id, spawns a Fly machine with an init.cmd override that runs
 * `bun scripts/revise-claim.ts`, and tails scan_events until the
 * stage-end for `revise-claim` lands. Prints the before/after claim text.
 *
 * Usage:
 *   bun scripts/spawn-test-revise.ts <scan_id> <guidance...>
 *
 * Optional env:
 *   BEAT=hook|number|disclosure   pick a claim of this beat (default: hook)
 */
import "dotenv/config";
import { D1Client } from "../src/cloud/d1.js";
import { FlyClient } from "../src/cloud/fly.js";
import { sleep } from "../src/util.js";

async function main() {
  const args = process.argv.slice(2);
  const scanId = args[0];
  const guidance = args.slice(1).join(" ").trim();
  const targetBeat = (process.env.BEAT || "hook").trim();

  if (!scanId || !guidance) {
    console.error(
      'usage: bun scripts/spawn-test-revise.ts <scan_id> "<guidance...>"',
    );
    console.error('  env: BEAT=hook|number|disclosure (default: hook)');
    process.exit(1);
  }

  const d1 = D1Client.fromEnv();
  const fly = FlyClient.fromEnv();

  console.log("── Picking target claim ──");
  const pickResp = await d1.query(
    `SELECT id, beat, text FROM claims WHERE scan_id = ? AND beat = ? ORDER BY idx ASC LIMIT 1`,
    [scanId, targetBeat],
  );
  const pick = pickResp.result?.[0]?.results?.[0] as
    | { id: string; beat: string; text: string }
    | undefined;
  if (!pick) {
    console.error(`no claim with beat="${targetBeat}" in scan ${scanId}`);
    console.error(`Hint: run \`bun scripts/scan-status.ts ${scanId}\` to see what's available.`);
    process.exit(1);
  }
  console.log(`  claim_id: ${pick.id}`);
  console.log(`  beat:     ${pick.beat}`);
  console.log(`  before:   ${pick.text}`);
  console.log(`  guidance: ${guidance}`);

  console.log("\n── Fly spawn (revise-claim entrypoint) ──");
  const machine = await fly.spawnScanMachine({
    scanId,
    name: `revise-${pick.id.replace(/[^a-zA-Z0-9-]/g, "-")}-${Date.now()}`,
    initCmd: ["bun", "scripts/revise-claim.ts"],
    env: {
      SCAN_ID: scanId,
      CLAIM_ID: pick.id,
      GUIDANCE: guidance,
      GITSHOW_CLOUD_MODE: "1",
    },
  });
  console.log(`  machine_id: ${machine.id} (${machine.state}) region=${machine.region}`);

  // Baseline = largest existing event id for this scan BEFORE we spawn, so
  // historical revise-claim events from earlier runs don't leak into this tail.
  const baselineResp = await d1.query(
    `SELECT COALESCE(MAX(id), 0) as max_id FROM scan_events WHERE scan_id = ?`,
    [scanId],
  );
  const baselineId = Number(
    (baselineResp.result?.[0]?.results?.[0] as { max_id: number } | undefined)?.max_id ?? 0,
  );
  console.log(`  event baseline: id > ${baselineId}`);

  // hook regen = 3 LLM calls (~3-5 min end-to-end). numbers/disclosure is
  // 1 LLM call (~2 min). 360s covers the slow case with headroom.
  const timeoutSec = Number(process.env.TIMEOUT_SEC ?? 360);
  console.log(`\n── Tailing scan_events for stage=revise-claim (timeout ${timeoutSec}s) ──`);
  const startedAt = Date.now();
  const timeoutMs = timeoutSec * 1000;
  let seenStart = false;
  let seenEnd = false;
  let lastEventId = baselineId;

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(3000);
    const evResp = await d1.query(
      `SELECT id, kind, stage, duration_ms, message, at
       FROM scan_events
       WHERE scan_id = ? AND id > ? AND stage = 'revise-claim'
       ORDER BY id ASC`,
      [scanId, lastEventId],
    );
    const events = (evResp.result?.[0]?.results ?? []) as Array<{
      id: number;
      kind: string;
      stage: string;
      duration_ms: number | null;
      message: string | null;
      at: number;
    }>;
    for (const ev of events) {
      const t = ((ev.at - startedAt) / 1000).toFixed(1);
      const extra = ev.duration_ms != null ? ` ${ev.duration_ms}ms` : "";
      const msg = ev.message ? ` "${ev.message.slice(0, 120)}"` : "";
      console.log(`  +${t.padStart(6)}s  [${ev.kind}] ${ev.stage}${extra}${msg}`);
      lastEventId = ev.id;
      if (ev.kind === "stage-start") seenStart = true;
      if (ev.kind === "stage-end" || ev.kind === "error") seenEnd = true;
    }
    if (seenEnd) break;
  }

  if (!seenStart) {
    console.log("\n⏱  no revise-claim events seen — machine may have failed before reaching the pipeline.");
    console.log(`   fly logs -a ${process.env.FLY_APP_NAME ?? "gitshow-worker"} | tail -200`);
    process.exit(1);
  }

  console.log("\n── After ──");
  const afterResp = await d1.query(
    `SELECT id, beat, text FROM claims WHERE scan_id = ? AND beat = ? ORDER BY idx ASC`,
    [scanId, targetBeat],
  );
  const after = (afterResp.result?.[0]?.results ?? []) as Array<{
    id: string;
    beat: string;
    text: string;
  }>;
  for (const c of after) {
    console.log(`  [${c.beat}] (${c.id})`);
    console.log(`    ${c.text}`);
  }

  console.log(`\nscan_id: ${scanId}`);
  console.log(`machine_id: ${machine.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
