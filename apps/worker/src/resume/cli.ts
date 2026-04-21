#!/usr/bin/env bun
/**
 * Dev CLI for the resume pipeline.
 *
 * Usage:
 *   bun run resume <handle> [--model anthropic/claude-opus-4.7]
 *
 * Writes JSON to:
 *   profiles/{handle}/resume.json   (local, always)
 *   resumes/{handle}/draft.json     (R2, when cloud env is configured)
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import dotenv from "dotenv";
import { runResumePipeline } from "./pipeline.js";
import { resolveSession } from "../session.js";
import { SessionUsage } from "../session.js";

dotenv.config();

async function main() {
  const handle = process.argv[2];
  if (!handle) {
    console.error("Usage: bun run resume <github-handle> [--model <id>]");
    process.exit(1);
  }

  const modelFlagIdx = process.argv.indexOf("--model");
  const model =
    modelFlagIdx > 0 ? process.argv[modelFlagIdx + 1] : "anthropic/claude-sonnet-4.6";

  const { session, resumed } = await resolveSession({
    handle,
    socials: {},
    model,
  });
  const usage = new SessionUsage();

  console.log(`\nResume pipeline — @${handle} — model=${model}`);
  console.log(`Session: ${session.dashboard_url}${resumed ? " (resumed)" : ""}\n`);

  const resume = await runResumePipeline({
    session,
    usage,
    onProgress: (text: string) => process.stdout.write(text),
  });

  const outPath = `profiles/${handle}/resume.json`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(resume, null, 2));
  console.log(`\n✓ Wrote ${outPath}`);
  console.log(`  ${resume.projects.length} projects, ${resume.buildLog.length} build-log, ${resume.skills.length} skills`);
  console.log(`  LLM calls: ${usage.llmCalls}, estimated cost: $${usage.estimatedCostUsd.toFixed(3)}`);
}

main().catch((err) => {
  console.error("\n❌ Pipeline failed:", err);
  process.exit(1);
});
