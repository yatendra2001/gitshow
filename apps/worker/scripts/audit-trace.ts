#!/usr/bin/env bun
/**
 * Pretty-print a per-scan trace packet from R2.
 *
 * Usage: bun scripts/audit-trace.ts <scanId>
 *        bun scripts/audit-trace.ts <scanId> --raw    # dump full JSON
 *        bun scripts/audit-trace.ts <scanId> --llm    # only LLM calls
 *        bun scripts/audit-trace.ts <scanId> --web    # only TinyFish + linkedin
 */
import "dotenv/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "../src/util.js";
import {
  traceR2Key,
  type FinalizedTrace,
  type TraceEvent,
} from "../src/resume/observability/trace.js";

const scanId = process.argv[2];
if (!scanId) {
  console.error(
    "usage: bun scripts/audit-trace.ts <scanId> [--raw|--llm|--web]",
  );
  process.exit(1);
}
const flags = new Set(process.argv.slice(3));

const client = new S3Client({
  region: "auto",
  endpoint: `https://${requireEnv("CF_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
  },
});

const resp = await client.send(
  new GetObjectCommand({
    Bucket: requireEnv("R2_BUCKET_NAME"),
    Key: traceR2Key(scanId),
  }),
);
const body = await resp.Body!.transformToString();
const trace = JSON.parse(body) as FinalizedTrace;

if (flags.has("--raw")) {
  console.log(body);
  process.exit(0);
}

const { meta, summary, resume, events } = trace;

// ─── header ─────────────────────────────────────────────────────────
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  scan ${meta.scanId}  ·  @${meta.handle}  ·  ${meta.model}`);
console.log(
  `  ${new Date(meta.startedAt).toISOString()}  ·  ${(meta.durationMs ?? 0) / 1000}s`,
);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

// ─── summary ────────────────────────────────────────────────────────
if (resume) {
  console.log(`RESUME SHAPE`);
  const pad = (n: number, target = 3) => String(n).padStart(target);
  const bar = (n: number, max: number) => "█".repeat(Math.min(n, max));
  console.log(`  work        ${pad(resume.work)}  ${bar(resume.work, 20)}`);
  console.log(`  education   ${pad(resume.education)}  ${bar(resume.education, 10)}`);
  console.log(`  projects    ${pad(resume.projects)}  ${bar(resume.projects, 10)}`);
  console.log(`  skills      ${pad(resume.skills)}  ${bar(resume.skills, 20)}`);
  console.log(`  buildLog    ${pad(resume.buildLog)}  ${bar(resume.buildLog, 30)}`);
  console.log(`  blog        ${pad(resume.blog)}  ${bar(resume.blog, 10)}`);
  console.log(`  summary len ${pad(resume.personSummaryLen)} chars`);
  console.log();
}

console.log(`CALLS`);
console.log(
  `  tinyfish search  ${summary.tinyfishSearchesOk}/${summary.tinyfishSearches} ok`,
);
console.log(
  `  tinyfish fetch   ${summary.tinyfishFetchesOk}/${summary.tinyfishFetches} ok`,
);
console.log(
  `  llm              ${summary.llmCalls} calls  ·  $${summary.totalLlmCostUsd.toFixed(4)}`,
);
console.log();

console.log(`STAGES`);
for (const s of summary.stages) {
  const dur = (s.durationMs / 1000).toFixed(1).padStart(7);
  const ok = s.ok ? "✓" : "✗";
  console.log(`  ${ok} ${dur}s  ${s.label}`);
}
console.log();

// ─── timeline ───────────────────────────────────────────────────────
console.log(`TIMELINE`);
for (const e of events) {
  if (flags.has("--llm") && e.kind !== "llm.call") continue;
  if (flags.has("--web") && e.kind !== "tinyfish.search" && e.kind !== "tinyfish.fetch" && e.kind !== "linkedin.fetch") continue;
  console.log(renderEvent(e));
}
console.log();

function renderEvent(e: TraceEvent): string {
  const hhmmss = new Date(e.t).toISOString().slice(11, 19);
  const head = `  ${hhmmss}  `;
  switch (e.kind) {
    case "stage.start":
      return `${head}▸ stage.start  ${e.label}`;
    case "stage.end":
      return `${head}${e.ok ? "✓" : "✗"} stage.end    ${e.label}  (${(e.durationMs / 1000).toFixed(1)}s)${e.error ? ` · ${e.error}` : ""}`;
    case "tinyfish.search": {
      const status = e.ok ? "✓" : "✗";
      const topLine = (e.topResults ?? [])
        .slice(0, 2)
        .map((r) => `    · ${r.title.slice(0, 80)}  [${r.url}]`)
        .join("\n");
      return (
        `${head}${status} search       "${e.query.slice(0, 80)}"  (${e.resultCount} results, ${e.durationMs}ms)${e.error ? ` · ${e.error}` : ""}` +
        (topLine ? "\n" + topLine : "")
      );
    }
    case "tinyfish.fetch": {
      const status = e.ok ? "✓" : "✗";
      const perUrl = e.perUrl
        .slice(0, 5)
        .map((p) => `    · ${p.textChars} chars  ${p.title?.slice(0, 60) ?? "(no title)"}  [${p.url.slice(0, 80)}]${p.error ? ` · ${p.error}` : ""}`)
        .join("\n");
      return (
        `${head}${status} fetch        ${e.urls.length} url(s)  (${e.durationMs}ms)${e.requestError ? ` · ${e.requestError}` : ""}` +
        (perUrl ? "\n" + perUrl : "")
      );
    }
    case "linkedin.fetch": {
      const status = e.ok ? "✓" : e.tier === "skipped" ? "—" : "✗";
      return `${head}${status} linkedin     tier=${e.tier}  ${e.textChars ?? 0} chars  ${e.title ? `title="${e.title.slice(0, 40)}"` : ""}  ${e.reason ?? ""}`.trimEnd();
    }
    case "llm.call": {
      const status = e.ok ? "✓" : "✗";
      const tokens = e.outputTokens ? `  ${e.outputTokens}tok` : "";
      return `${head}${status} llm          ${e.label.padEnd(26)}  ${e.model.padEnd(34)}  ${(e.durationMs / 1000).toFixed(1)}s${tokens}${e.error ? "  · " + e.error.slice(0, 80) : ""}`;
    }
    case "note":
      return `${head}• ${e.label.padEnd(26)}  ${e.message}`;
    case "evaluator":
      return `${head}${e.pass ? "✓" : "✗"} evaluator    ${e.issueCount} issues\n${e.issues.map((i) => `    · [${i.severity}] ${i.section}: ${i.message}`).join("\n")}`;
  }
}
