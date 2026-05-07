#!/usr/bin/env bun
/**
 * Recover a hung scan: mark it `failed` in D1 and destroy the Fly
 * machine so the slot stops burning compute. Idempotent — re-running
 * on a finished scan is a no-op.
 *
 * Usage:
 *   bun scripts/recover-stuck-scan.ts <scan_id> [--reason "..."]
 *   bun scripts/recover-stuck-scan.ts --all-stuck            # any status=running scan with stale heartbeat
 *   bun scripts/recover-stuck-scan.ts --all-stuck --dry-run
 */
import "dotenv/config";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const reasonIdx = args.indexOf("--reason");
const reason =
  reasonIdx >= 0 && args[reasonIdx + 1]
    ? args[reasonIdx + 1]
    : "pipeline hung — manually recovered after no events for >25min";
const allStuck = args.includes("--all-stuck");
const positional = args.filter(
  (a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")),
);

const accountId = process.env.CF_ACCOUNT_ID!;
const databaseId = process.env.D1_DATABASE_ID!;
const cfToken = process.env.CF_API_TOKEN!;
const flyToken = process.env.FLY_API_TOKEN!;
const flyApp = process.env.FLY_APP_NAME!;
const d1Url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

interface Scan {
  id: string;
  handle: string;
  status: string;
  current_phase: string | null;
  last_completed_phase: string | null;
  fly_machine_id: string | null;
  last_heartbeat: number;
  created_at: number;
}

async function d1<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await fetch(d1Url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  if (!r.ok) {
    throw new Error(`d1 ${r.status}: ${await r.text()}`);
  }
  const j = (await r.json()) as { result?: Array<{ results?: T[] }>; errors?: Array<{ message: string }> };
  if (j.errors?.length) throw new Error(`d1 errors: ${j.errors.map((e) => e.message).join("; ")}`);
  return j.result?.[0]?.results ?? [];
}

async function destroyMachine(machineId: string): Promise<{ ok: boolean; status?: number; body?: string }> {
  const r = await fetch(
    `https://api.machines.dev/v1/apps/${flyApp}/machines/${machineId}?force=true`,
    { method: "DELETE", headers: { Authorization: `Bearer ${flyToken}` } },
  );
  if (r.status === 404) return { ok: true, status: 404, body: "already gone" };
  if (!r.ok) return { ok: false, status: r.status, body: await r.text() };
  return { ok: true, status: r.status };
}

async function fetchEventCount(scanId: string): Promise<number> {
  const rows = await d1<{ n: number }>(
    `SELECT COUNT(*) AS n FROM scan_events WHERE scan_id = ?`,
    [scanId],
  );
  return rows[0]?.n ?? 0;
}

async function loadScansToRecover(): Promise<Scan[]> {
  if (allStuck) {
    // "Stuck" means status=running AND no scan_events in the last
    // 25 minutes. Heartbeat is unreliable as a liveness signal — it's
    // exactly the symptom we're hunting, not the disease.
    const threshold = Date.now() - 25 * 60_000;
    return await d1<Scan>(
      `SELECT s.id, s.handle, s.status, s.current_phase, s.last_completed_phase,
              s.fly_machine_id, s.last_heartbeat, s.created_at
       FROM scans s
       WHERE s.status = 'running'
         AND COALESCE((SELECT MAX(at) FROM scan_events e WHERE e.scan_id = s.id), s.created_at) < ?
       ORDER BY s.created_at ASC`,
      [threshold],
    );
  }
  if (positional.length === 0) {
    console.error(
      "Usage: bun scripts/recover-stuck-scan.ts <scan_id> [--reason \"...\"]\n" +
        "       bun scripts/recover-stuck-scan.ts --all-stuck [--dry-run]",
    );
    process.exit(1);
  }
  const scans: Scan[] = [];
  for (const id of positional) {
    const [scan] = await d1<Scan>(
      `SELECT id, handle, status, current_phase, last_completed_phase,
              fly_machine_id, last_heartbeat, created_at
       FROM scans WHERE id = ?`,
      [id],
    );
    if (!scan) {
      console.error(`scan ${id} not found in D1`);
      continue;
    }
    scans.push(scan);
  }
  return scans;
}

async function recoverOne(scan: Scan): Promise<{ scan: string; status: string }> {
  const ageH = ((Date.now() - scan.created_at) / 3600_000).toFixed(1);
  const lastEventCount = await fetchEventCount(scan.id);
  console.log(
    `\n[${scan.id}] @${scan.handle} age=${ageH}h status=${scan.status} ` +
      `phase=${scan.current_phase} last_completed=${scan.last_completed_phase} ` +
      `events=${lastEventCount} machine=${scan.fly_machine_id ?? "(none)"}`,
  );
  if (scan.status !== "running") {
    console.log(`  → already in terminal state (${scan.status}), skipping D1 update`);
  }
  if (dryRun) {
    console.log(`  → DRY RUN: would mark failed and destroy ${scan.fly_machine_id}`);
    return { scan: scan.id, status: "dry-run" };
  }

  if (scan.fly_machine_id) {
    const res = await destroyMachine(scan.fly_machine_id);
    if (res.ok) {
      console.log(`  ✓ destroyed fly machine ${scan.fly_machine_id} (status ${res.status})`);
    } else {
      console.log(`  ✗ destroy failed: ${res.status} ${res.body}`);
    }
  }

  if (scan.status === "running") {
    await d1(
      `UPDATE scans
       SET status = 'failed',
           error = ?,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?`,
      [reason, Date.now(), Date.now(), scan.id],
    );
    console.log(`  ✓ marked scan failed in D1`);

    await d1(
      `INSERT INTO scan_events (scan_id, kind, stage, message, at)
       VALUES (?, 'error', 'recovery', ?, ?)`,
      [scan.id, `manual-recover: ${reason}`.slice(0, 480), Date.now()],
    );
  }

  return { scan: scan.id, status: "recovered" };
}

const scans = await loadScansToRecover();
if (scans.length === 0) {
  console.log("No scans to recover.");
  process.exit(0);
}
console.log(`Recovering ${scans.length} scan(s)${dryRun ? " (DRY RUN)" : ""}:`);
const results = [];
for (const s of scans) {
  results.push(await recoverOne(s));
}
console.log("\nSummary:");
for (const r of results) console.log(`  ${r.scan}: ${r.status}`);
