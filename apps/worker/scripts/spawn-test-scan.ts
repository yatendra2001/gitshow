#!/usr/bin/env bun
/**
 * End-to-end smoke test for the cloud worker.
 *
 * Creates a fake user + scan row in D1, spawns a fresh Fly machine with the
 * scan's env wired up, then tails D1's scan_events table so you can watch
 * the pipeline boot, hydrate from R2, hit the first stage, and heartbeat.
 *
 * Usage:
 *   bun scripts/spawn-test-scan.ts <github-handle> [--timeout 120]
 *
 * Env requirements: everything in apps/worker/.env, plus FLY_API_TOKEN.
 * Also needs a real GH token for the handle's private repos — uses
 * `gh auth token` if GH_TOKEN isn't set.
 *
 * The spawned machine has `auto_destroy: true`, so whether it succeeds,
 * fails, or is killed, Fly cleans it up.
 */
import "dotenv/config";
import { nanoid } from "nanoid";
import { D1Client } from "../src/cloud/d1.js";
import { FlyClient } from "../src/cloud/fly.js";

interface Args {
  handle: string;
  timeoutSec: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const handle = args.find((a) => !a.startsWith("--"));
  if (!handle) {
    console.error("usage: bun scripts/spawn-test-scan.ts <github-handle> [--timeout 120]");
    process.exit(1);
  }
  const ti = args.indexOf("--timeout");
  const timeoutSec = ti >= 0 ? Number(args[ti + 1]) : 120;
  return { handle, timeoutSec };
}

async function getGhToken(): Promise<string> {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const proc = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(
      "no GH_TOKEN env set and `gh auth token` failed — set GH_TOKEN or run `gh auth login`",
    );
  }
  return out.trim();
}

async function ensureTestUser(d1: D1Client, userId: string): Promise<void> {
  await d1.query(
    `INSERT OR IGNORE INTO users (id, name, email) VALUES (?, ?, ?)`,
    [userId, "smoke-test", "smoke-test@gitshow.local"],
  );
}

async function insertScanRow(
  d1: D1Client,
  scanId: string,
  userId: string,
  handle: string,
): Promise<void> {
  const now = Date.now();
  await d1.query(
    `INSERT INTO scans (
      id, user_id, handle, session_id, model, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [scanId, userId, handle, scanId, "anthropic/claude-sonnet-4.6", "queued", now, now],
  );
}

async function fetchScanRow(d1: D1Client, scanId: string): Promise<{
  status: string;
  current_phase: string | null;
  last_completed_phase: string | null;
  last_heartbeat: number | null;
  error: string | null;
} | null> {
  const resp = await d1.query(
    `SELECT status, current_phase, last_completed_phase, last_heartbeat, error FROM scans WHERE id = ?`,
    [scanId],
  );
  const row = resp.result?.[0]?.results?.[0];
  return (row as {
    status: string;
    current_phase: string | null;
    last_completed_phase: string | null;
    last_heartbeat: number | null;
    error: string | null;
  } | undefined) ?? null;
}

async function fetchEventsSince(
  d1: D1Client,
  scanId: string,
  afterId: number,
): Promise<
  Array<{
    id: number;
    kind: string;
    stage: string | null;
    worker: string | null;
    status: string | null;
    duration_ms: number | null;
    message: string | null;
    at: number;
  }>
> {
  const resp = await d1.query(
    `SELECT id, kind, stage, worker, status, duration_ms, message, at
     FROM scan_events
     WHERE scan_id = ? AND id > ?
     ORDER BY id ASC`,
    [scanId, afterId],
  );
  return (resp.result?.[0]?.results ?? []) as Array<{
    id: number;
    kind: string;
    stage: string | null;
    worker: string | null;
    status: string | null;
    duration_ms: number | null;
    message: string | null;
    at: number;
  }>;
}

function fmtEvent(ev: {
  kind: string;
  stage: string | null;
  worker: string | null;
  status: string | null;
  duration_ms: number | null;
  message: string | null;
}): string {
  const bits: string[] = [`[${ev.kind}]`];
  if (ev.stage) bits.push(ev.stage);
  if (ev.worker) bits.push(`worker=${ev.worker}`);
  if (ev.status) bits.push(`status=${ev.status}`);
  if (ev.duration_ms != null) bits.push(`${ev.duration_ms}ms`);
  if (ev.message) bits.push(`"${ev.message.slice(0, 80)}"`);
  return bits.join(" ");
}

async function main() {
  const { handle, timeoutSec } = parseArgs();

  const ghToken = await getGhToken();
  const d1 = D1Client.fromEnv();
  const fly = FlyClient.fromEnv();

  const userId = "smoke-test-user";
  const scanId = `test-${Date.now()}-${nanoid(6)}`;

  console.log(`scan_id: ${scanId}`);
  console.log(`handle : ${handle}`);
  console.log(`image  : ${process.env.FLY_WORKER_IMAGE || `registry.fly.io/${process.env.FLY_APP_NAME}:latest`}`);

  console.log("\n── D1 setup ──");
  await ensureTestUser(d1, userId);
  await insertScanRow(d1, scanId, userId, handle);
  console.log("  scan row inserted (status=queued)");

  console.log("\n── Fly spawn ──");
  const machine = await fly.spawnScanMachine({
    scanId,
    env: {
      SCAN_ID: scanId,
      HANDLE: handle,
      GH_TOKEN: ghToken,
      GITSHOW_CLOUD_MODE: "1",
      MODEL: "anthropic/claude-sonnet-4.6",
    },
  });
  console.log(`  machine_id: ${machine.id} (${machine.state}) region=${machine.region}`);
  await d1.updateScanStatus(scanId, { fly_machine_id: machine.id });

  console.log(`\n── Tailing scan_events (timeout ${timeoutSec}s, Ctrl-C to stop) ──`);
  let lastEventId = 0;
  const startedAt = Date.now();

  while (true) {
    await sleep(3000);

    const events = await fetchEventsSince(d1, scanId, lastEventId);
    for (const ev of events) {
      const elapsed = ((ev.at - startedAt) / 1000).toFixed(1);
      console.log(`  +${elapsed.padStart(5)}s  ${fmtEvent(ev)}`);
      lastEventId = ev.id;
    }

    const row = await fetchScanRow(d1, scanId);
    if (row?.status === "succeeded") {
      console.log("\n✓ scan succeeded");
      break;
    }
    if (row?.status === "failed") {
      console.log(`\n✗ scan failed: ${row.error ?? "(no error message)"}`);
      break;
    }

    if ((Date.now() - startedAt) / 1000 > timeoutSec) {
      console.log(
        `\n⏱  timeout after ${timeoutSec}s — status=${row?.status ?? "?"} ` +
          `phase=${row?.current_phase ?? "?"}`,
      );
      console.log(`   machine ${machine.id} is still running — destroy with:`);
      console.log(`   fly machines destroy ${machine.id} -a ${process.env.FLY_APP_NAME} --force`);
      break;
    }
  }

  console.log(`\nscan_id: ${scanId}`);
  console.log(`machine_id: ${machine.id}`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
