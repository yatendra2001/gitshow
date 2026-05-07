#!/usr/bin/env bun
/**
 * Diagnose a possibly-stuck scan. Polls D1 + Fly Machines API for ~90s
 * and prints whether the worker is genuinely making progress (new
 * events / new fly machine state) or just heartbeating into the void.
 *
 * Usage: bun scripts/diagnose-stuck-scan.ts <scan_id>
 */
import "dotenv/config";

const scanId = process.argv[2];
if (!scanId) {
  console.error("Usage: bun scripts/diagnose-stuck-scan.ts <scan_id>");
  process.exit(1);
}

const accountId = process.env.CF_ACCOUNT_ID!;
const databaseId = process.env.D1_DATABASE_ID!;
const cfToken = process.env.CF_API_TOKEN!;
const flyToken = process.env.FLY_API_TOKEN!;
const flyApp = process.env.FLY_APP_NAME!;

const d1Url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

async function d1<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await fetch(d1Url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const j = (await r.json()) as { result?: Array<{ results?: T[] }> };
  return j.result?.[0]?.results ?? [];
}

interface ScanRow {
  id: string;
  status: string;
  current_phase: string | null;
  last_completed_phase: string | null;
  fly_machine_id: string | null;
  last_heartbeat: number;
  updated_at: number;
}

interface EventRow {
  at: number;
  kind: string;
  stage: string | null;
  message: string | null;
}

async function snapshot() {
  const [scan] = await d1<ScanRow>(
    `SELECT id, status, current_phase, last_completed_phase, fly_machine_id, last_heartbeat, updated_at FROM scans WHERE id = ?1`,
    [scanId],
  );
  const [{ n, last }] = await d1<{ n: number; last: number | null }>(
    `SELECT COUNT(*) as n, MAX(at) as last FROM scan_events WHERE scan_id = ?1`,
    [scanId],
  );
  return { scan, eventCount: n, lastEventAt: last };
}

async function fetchMachine(machineId: string) {
  const r = await fetch(
    `https://api.machines.dev/v1/apps/${flyApp}/machines/${machineId}`,
    { headers: { Authorization: `Bearer ${flyToken}` } },
  );
  if (!r.ok) {
    return { error: `${r.status} ${await r.text()}` };
  }
  return (await r.json()) as {
    id: string;
    state: string;
    updated_at: string;
    events?: Array<{ type: string; status: string; timestamp: number }>;
  };
}

const startedAt = Date.now();
const initial = await snapshot();
if (!initial.scan) {
  console.error(`scan ${scanId} not found`);
  process.exit(1);
}
const machineId = initial.scan.fly_machine_id;
console.log(`scan: ${scanId}`);
console.log(`status: ${initial.scan.status} / phase: ${initial.scan.current_phase} (last completed: ${initial.scan.last_completed_phase})`);
console.log(`fly machine: ${machineId}`);
console.log(`last heartbeat: ${new Date(initial.scan.last_heartbeat).toISOString()} (${((Date.now() - initial.scan.last_heartbeat) / 1000).toFixed(1)}s ago)`);
console.log(`events so far: ${initial.eventCount}, last at ${initial.lastEventAt ? new Date(initial.lastEventAt).toISOString() : "n/a"}`);
console.log("");

const baselineEvents = initial.eventCount;
const baselineHeartbeat = initial.scan.last_heartbeat;
const baselineMachineUpdated = machineId ? (await fetchMachine(machineId)) : null;
console.log(`fly machine state: ${baselineMachineUpdated && "state" in baselineMachineUpdated ? baselineMachineUpdated.state : "?"}`);
console.log("");

console.log("Polling every 15s for 90s...");
console.log("");

let heartbeatBumps = 0;
let eventBumps = 0;

for (let i = 1; i <= 6; i++) {
  await new Promise((r) => setTimeout(r, 15_000));
  const cur = await snapshot();
  const hbAge = ((Date.now() - cur.scan.last_heartbeat) / 1000).toFixed(1);
  const newEvents = cur.eventCount - baselineEvents;
  const heartbeatMoved = cur.scan.last_heartbeat !== baselineHeartbeat;
  if (heartbeatMoved) heartbeatBumps++;
  if (newEvents > 0) eventBumps++;
  console.log(
    `t+${(i * 15).toString().padStart(2)}s ` +
      `events=${cur.eventCount} (Δ${newEvents}) ` +
      `phase=${cur.scan.current_phase} ` +
      `hb=${hbAge}s-ago ` +
      `${heartbeatMoved ? "[HB-NEW]" : ""}`,
  );
}

console.log("");
console.log(`elapsed: ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
console.log(`heartbeat updates seen: ${heartbeatBumps} (worker process is alive: ${heartbeatBumps > 0 ? "YES" : "NO"})`);
console.log(`new pipeline events: ${eventBumps} (pipeline is making progress: ${eventBumps > 0 ? "YES" : "NO — HUNG"})`);

if (machineId) {
  const after = await fetchMachine(machineId);
  if ("error" in after) {
    console.log(`fly machine: error fetching (${after.error})`);
  } else {
    console.log(`fly machine: ${after.state}, last fly event: ${after.events?.[0] ? `${after.events[0].type}/${after.events[0].status} at ${new Date(after.events[0].timestamp).toISOString()}` : "n/a"}`);
  }
}
