#!/usr/bin/env bun
/**
 * Run a .sql migration file against the configured D1 database.
 *
 * Usage:  bun scripts/run-migration.ts <path-to-migration.sql>
 *
 * Requires CF_ACCOUNT_ID, D1_DATABASE_ID, CF_API_TOKEN in env (.env is loaded).
 * Splits on bare `;` statement terminators (comments and strings handled
 * crudely — the schema file sticks to simple DDL so this is safe).
 *
 * Runs in CI via .github/workflows/migrate-d1.yml, so output is pino
 * (JSON in CI, pretty locally).
 *
 * ── Idempotency ──
 * Each migration file is recorded by basename in a schema_migrations table
 * after successful apply. A subsequent re-run detects the record and
 * skips the file entirely, so destructive DDL (ALTER/DROP/RENAME) can be
 * authored freely without guarding every statement.
 *
 * If you need to re-apply a migration, run:
 *   bun apps/worker/scripts/run-migration.ts migrations/0002_live_events.sql --force
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { D1Client } from "../src/cloud/d1.js";
import { logger } from "../src/util.js";

const migrateLog = logger.child({ src: "migration" });

async function ensureTrackingTable(d1: D1Client): Promise<void> {
  await d1.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );
}

async function isApplied(d1: D1Client, version: string): Promise<boolean> {
  const resp = await d1.query(
    `SELECT version FROM schema_migrations WHERE version = ? LIMIT 1`,
    [version],
  );
  return (resp.result?.[0]?.results?.length ?? 0) > 0;
}

async function markApplied(d1: D1Client, version: string): Promise<void> {
  await d1.query(
    `INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
    [version, Date.now()],
  );
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const force = args.includes("--force");

  if (!file) {
    migrateLog.error("usage: bun scripts/run-migration.ts <path-to-migration.sql> [--force]");
    process.exit(1);
  }

  const version = basename(file).replace(/\.sql$/i, "");
  const sql = await readFile(file, "utf-8");
  const statements = splitStatements(sql);

  const d1 = D1Client.fromEnv();
  await ensureTrackingTable(d1);

  if (!force && (await isApplied(d1, version))) {
    migrateLog.info({ file, version }, "migration already applied — skipping");
    return;
  }

  migrateLog.info({ file, version, statements: statements.length, force }, "applying migration");

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]!;
    const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
    try {
      await d1.query(stmt);
      migrateLog.info({ n: i + 1, of: statements.length, preview }, "ok");
    } catch (err) {
      migrateLog.error({ err, n: i + 1, of: statements.length, preview }, "statement failed");
      process.exit(1);
    }
  }

  await markApplied(d1, version);
  migrateLog.info({ file, version }, "migration done");
}

function splitStatements(sql: string): string[] {
  const noComments = sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

main().catch((err) => {
  migrateLog.error({ err }, "run-migration: unhandled error");
  process.exit(1);
});
