#!/usr/bin/env node
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runScanner } from "./scanner.js";
import { parseArgs } from "./args.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.OPENROUTER_API_KEY) {
    process.stderr.write(
      "Error: OPENROUTER_API_KEY is not set. Copy .env.example to .env and fill it in (get your key at https://openrouter.ai/keys).\n"
    );
    process.exit(1);
  }

  const repoPath = resolve(args.repoPath);

  process.stderr.write(`[scan] Target: ${repoPath}\n`);
  process.stderr.write(`[scan] Handle: @${args.handle}\n`);
  process.stderr.write(`[scan] Model:  ${args.model}\n\n`);

  const result = await runScanner({
    repoPath,
    handle: args.handle,
    model: args.model,
  });

  const json = JSON.stringify(result, null, 2);

  if (args.out) {
    const outPath = resolve(args.out);
    await writeFile(outPath, json);
    process.stderr.write(`\n[scan] ✓ Result written to ${outPath}\n`);
  } else {
    process.stderr.write(`\n[scan] ✓ Result:\n`);
    process.stdout.write(json + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(
    `\n[scan] ✗ Error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
  }
  process.exit(1);
});
