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
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { D1Client } from "../src/cloud/d1.js";
import { logger } from "../src/util.js";

const migrateLog = logger.child({ src: "migration" });

async function main() {
  const file = process.argv[2];
  if (!file) {
    migrateLog.error("usage: bun scripts/run-migration.ts <path-to-migration.sql>");
    process.exit(1);
  }

  const sql = await readFile(file, "utf-8");
  const statements = splitStatements(sql);
  migrateLog.info({ file, statements: statements.length }, "applying migration");

  const d1 = D1Client.fromEnv();
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
  migrateLog.info({ file }, "migration done");
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
