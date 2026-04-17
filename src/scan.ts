#!/usr/bin/env node
/**
 * GitShow CLI entry point — profile mode.
 */
import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { parseArgs } from "./args.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.OPENROUTER_API_KEY) {
    process.stderr.write(
      "Error: OPENROUTER_API_KEY is not set. Copy .env.example to .env and fill it in.\n"
    );
    process.exit(1);
  }

  const { runPipeline } = await import("./pipeline.js");

  process.stderr.write(`[gitshow] Profile generation for @${args.handle}\n`);
  process.stderr.write(`[gitshow] Model: ${args.model}\n`);
  process.stderr.write(`[gitshow] Concurrency: ${args.concurrency}\n\n`);

  const result = await runPipeline({
    handle: args.handle,
    model: args.model,
    concurrency: args.concurrency,
    outPath: args.outPath,
    onProgress: (event) => {
      const pct = event.percent ? ` [${event.percent}%]` : "";
      process.stderr.write(`[gitshow${pct}] ${event.message}\n`);
    },
  });

  const json = JSON.stringify(result, null, 2);

  if (args.outPath) {
    const outPath = resolve(args.outPath);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, json);
    process.stderr.write(
      `\n[gitshow] Profile written to ${outPath}\n`
    );
    process.stderr.write(
      `[gitshow] Score: ${result.evaluationScore ?? "N/A"}/100\n`
    );
    process.stderr.write(
      `[gitshow] Duration: ${Math.round(result.pipelineMeta.totalDurationMs / 1000)}s\n`
    );
    process.stderr.write(
      `[gitshow] Agent calls: ${result.pipelineMeta.agentCalls}\n`
    );
  } else {
    process.stdout.write(json + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(
    `\n[gitshow] Error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
  }
  process.exit(1);
});
