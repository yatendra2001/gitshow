#!/usr/bin/env bun
/**
 * Run a .sql migration file against the configured D1 database.
 *
 * Usage:  bun scripts/run-migration.ts <path-to-migration.sql>
 *
 * Requires CF_ACCOUNT_ID, D1_DATABASE_ID, CF_API_TOKEN in env (.env is loaded).
 * Splits on bare `;` statement terminators (comments and strings handled
 * crudely — the schema file sticks to simple DDL so this is safe).
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { D1Client } from "../src/cloud/d1.js";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: bun scripts/run-migration.ts <path-to-migration.sql>");
    process.exit(1);
  }

  const sql = await readFile(file, "utf-8");
  const statements = splitStatements(sql);
  console.log(`running ${statements.length} statements from ${file}`);

  const d1 = D1Client.fromEnv();
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]!;
    const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}… `);
    try {
      await d1.query(stmt);
      console.log("ok");
    } catch (err) {
      console.log("FAIL");
      console.error(err);
      process.exit(1);
    }
  }
  console.log("done.");
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
  console.error(err);
  process.exit(1);
});
