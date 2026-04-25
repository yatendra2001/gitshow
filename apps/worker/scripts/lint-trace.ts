#!/usr/bin/env bun
/**
 * Trace anti-pattern linter (per session-8 §11.4). Catches the common
 * regressions that would otherwise reach users silently.
 *
 * Usage: bun scripts/lint-trace.ts <scanId>
 *        bun scripts/lint-trace.ts <scanId> --budget=1.50  # USD ceiling
 *
 * Exit codes: 0 = clean, 1 = findings printed as markdown.
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
  console.error("usage: bun scripts/lint-trace.ts <scanId> [--budget=N]");
  process.exit(1);
}

const argFlags = process.argv.slice(3);
const budget = (() => {
  const b = argFlags.find((a) => a.startsWith("--budget="));
  return b ? Number(b.slice("--budget=".length)) : 0.5;
})();

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

interface Finding {
  rule: string;
  severity: "warn" | "error";
  message: string;
}
const findings: Finding[] = [];

const events: TraceEvent[] = trace.events ?? [];
const evs = <K extends TraceEvent["kind"]>(kind: K) =>
  events.filter((e): e is Extract<TraceEvent, { kind: K }> => e.kind === kind);

// ─── Rule 1 — fetcher ran but emitted 0 facts and didn't error ─────
{
  const ends = evs("fetcher.end");
  const errs = new Set(evs("fetcher.error").map((e) => e.label));
  for (const end of ends) {
    if (end.factsEmitted === 0 && !errs.has(end.label) && end.status !== "error") {
      findings.push({
        rule: "fetcher-silent-empty",
        severity: "warn",
        message: `fetcher ${end.label} ran ${(end.durationMs / 1000).toFixed(1)}s and emitted 0 facts with no error — likely parse bug.`,
      });
    }
  }
}

// ─── Rule 2 — TinyFish search rate-limited or malformed ────────────
{
  const fails = evs("tinyfish.search").filter((e) => !e.ok);
  if (fails.length > 0) {
    findings.push({
      rule: "tinyfish-search-fail",
      severity: "warn",
      message: `${fails.length} TinyFish search(es) failed — first error: ${fails[0]?.error?.slice(0, 120) ?? "(no detail)"}`,
    });
  }
}

// ─── Rule 3 — LinkedIn tier 3 always walled ────────────────────────
{
  const t3 = evs("linkedin.tier.attempt").filter((e) => e.tier === 3);
  if (t3.length > 0 && t3.every((e) => !e.ok)) {
    findings.push({
      rule: "linkedin-tier3-walled",
      severity: "warn",
      message: `Playwright (tier 3) walled on every attempt (${t3.length} tries) — Googlebot UA may be detected.`,
    });
  }
}

// ─── Rule 4 — KG merger LLM ran but produced 0 decisions ───────────
{
  const llmEvts = evs("kg.merger.llm");
  for (const ev of llmEvts) {
    if (ev.pairCount > 0 && ev.decisions.length === 0) {
      findings.push({
        rule: "kg-merger-no-decisions",
        severity: "warn",
        message: `KG merger ran on ${ev.pairCount} pair(s) but emitted 0 decisions — Opus pair-resolution prompt may be off.`,
      });
    }
  }
}

// ─── Rule 5 — Repo Judge too harsh ─────────────────────────────────
{
  const verdicts = evs("judge.verdict");
  if (verdicts.length >= 5) {
    const featured = verdicts.filter((e) => e.shouldFeature).length;
    const ratio = featured / verdicts.length;
    if (ratio < 0.2) {
      findings.push({
        rule: "judge-too-harsh",
        severity: "warn",
        message: `Repo Judge featured ${featured}/${verdicts.length} (${(ratio * 100).toFixed(0)}%) — prompt may be too harsh.`,
      });
    }
  }
}

// ─── Rule 6 — LLM tokens but tiny output (force-submit retry) ──────
{
  for (const ev of evs("llm.call")) {
    const used = (ev.inputTokens ?? 0) + (ev.outputTokens ?? 0);
    const outLen = (ev.output ?? "").length;
    if (used > 8000 && outLen < 50) {
      findings.push({
        rule: "llm-retry-storm",
        severity: "warn",
        message: `${ev.label}: used ${used} tokens but output is ${outLen} chars — likely force-submit retry storm.`,
      });
    }
  }
}

// ─── Rule 7 — same URL fetched ≥3 times ────────────────────────────
{
  const counts = new Map<string, number>();
  for (const ev of evs("tinyfish.fetch")) {
    for (const u of ev.urls) {
      counts.set(u, (counts.get(u) ?? 0) + 1);
    }
  }
  for (const [url, n] of counts) {
    if (n >= 3) {
      findings.push({
        rule: "tinyfish-url-repeat",
        severity: "warn",
        message: `${url} fetched ${n}× — dedup regression.`,
      });
    }
  }
}

// ─── Rule 8 — wall clock outliers ──────────────────────────────────
{
  for (const ev of evs("stage.end")) {
    if (ev.durationMs > 120_000) {
      findings.push({
        rule: "slow-stage",
        severity: "warn",
        message: `stage ${ev.label} took ${(ev.durationMs / 1000).toFixed(0)}s (>120s).`,
      });
    }
  }
}

// ─── Rule 8b — fetcher hit its outer wall-clock cap ───────────────
//   When this fires, the fetcher's own trace event may still
//   say "status=ok" because it kept running after we gave up on it
//   — but safeFetch returned [] and any facts were dropped.
{
  for (const ev of evs("note")) {
    if (ev.label?.startsWith("fetcher-timeout:")) {
      findings.push({
        rule: "fetcher-timeout-data-loss",
        severity: "error",
        message: `${ev.message} — bump FETCHER_TIMEOUTS_MS for this fetcher; the trace's fetcher.end event is misleading.`,
      });
    }
  }
}

// ─── Rule 9 — total LLM cost > budget ──────────────────────────────
{
  const total = trace.summary.totalLlmCostUsd;
  if (total > budget) {
    findings.push({
      rule: "cost-runaway",
      severity: "error",
      message: `total LLM cost $${total.toFixed(2)} exceeded budget $${budget.toFixed(2)}.`,
    });
  }
}

// ─── Rule 10 — hero prose call failed ──────────────────────────────
{
  for (const ev of evs("render.hero-prose.call")) {
    if (!ev.ok) {
      findings.push({
        rule: "hero-prose-failed",
        severity: "error",
        message: `hero-prose call failed (${ev.durationMs}ms) — fallback prose served.`,
      });
    }
  }
}

// ─── Output ────────────────────────────────────────────────────────
if (findings.length === 0) {
  console.log(`# Trace lint: clean ✓\n\nscan ${scanId} — no anti-patterns.`);
  process.exit(0);
}

console.log(`# Trace lint: ${findings.length} finding(s) for scan ${scanId}\n`);
for (const f of findings) {
  console.log(`- **${f.severity.toUpperCase()}** [${f.rule}] ${f.message}`);
}
const hasError = findings.some((f) => f.severity === "error");
process.exit(hasError ? 1 : 0);
