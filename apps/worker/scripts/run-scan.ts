#!/usr/bin/env bun
/**
 * Cloud entrypoint for the worker.
 *
 * Spawned per-scan via the Fly Machines API. Reads scan config from env vars
 * supplied at machine create-time, runs the existing pipeline, and mirrors
 * every checkpoint into R2 + every progress event into D1 so the web app
 * can render live status and resume a failed scan on retry.
 *
 * Required env (production):
 *   SCAN_ID, HANDLE, GH_TOKEN, OPENROUTER_API_KEY,
 *   CF_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   D1_DATABASE_ID, CF_API_TOKEN,
 *   GITSHOW_CLOUD_MODE=1
 *
 * Optional env:
 *   MODEL (default: anthropic/claude-sonnet-4.6)
 *   TWITTER, LINKEDIN, WEBSITE, CONTEXT_NOTES
 *   FLY_MACHINE_ID (Fly injects this automatically on machines)
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { runPipeline, type PipelineEvent } from "../src/pipeline.js";
import { ScanCheckpoint } from "../src/checkpoint.js";
import { sanitizeHandle } from "../src/session.js";
import { R2Client } from "../src/cloud/r2.js";
import { D1Client } from "../src/cloud/d1.js";
import { DOPublishClient } from "@gitshow/shared/cloud/do-client";
import type { PipelineEvent as StructuredEvent } from "@gitshow/shared/events";
import { logger, requireEnv } from "../src/util.js";
import type { ScanSession, ScanSocials } from "../src/schemas.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const BASE_DIR = "profiles";

async function main() {
  if (process.env.GITSHOW_CLOUD_MODE !== "1") {
    logger.error(
      "run-scan: GITSHOW_CLOUD_MODE is not '1' — refusing to run in cloud mode. " +
        "For local runs use `bun run profile` (src/scan.ts).",
    );
    process.exit(1);
  }

  const scanId = requireEnv("SCAN_ID");
  const handle = requireEnv("HANDLE");
  const model = process.env.MODEL || "anthropic/claude-sonnet-4.6";
  const flyMachineId = process.env.FLY_MACHINE_ID || null;

  const socials: ScanSocials = {};
  if (process.env.TWITTER) socials.twitter = process.env.TWITTER;
  if (process.env.LINKEDIN) socials.linkedin = process.env.LINKEDIN;
  if (process.env.WEBSITE) socials.website = process.env.WEBSITE;

  const session: ScanSession = {
    id: scanId,
    handle,
    socials,
    context_notes: process.env.CONTEXT_NOTES || undefined,
    started_at: new Date().toISOString(),
    dashboard_url: `https://openrouter.ai/sessions/${scanId}`,
    model,
    cost_cap_usd: Number.POSITIVE_INFINITY,
  };

  const r2 = R2Client.fromEnv();
  const d1 = D1Client.fromEnv();
  const doClient = DOPublishClient.fromEnv({ logger });
  const scanLog = logger.child({ scan_id: scanId, handle });

  scanLog.info({ model, fly_machine_id: flyMachineId }, "boot");

  await d1.updateScanStatus(scanId, {
    status: "running",
    fly_machine_id: flyMachineId,
    error: null,
  });

  const heartbeat = setInterval(() => {
    void d1.heartbeat(scanId).catch((err) => {
      scanLog.error({ err }, "heartbeat failed");
    });
  }, HEARTBEAT_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(heartbeat);
    try {
      await d1.updateScanStatus(scanId, {
        status: "failed",
        error: `interrupted by ${signal}`,
      });
    } catch (err) {
      scanLog.error({ err }, "shutdown mark-failed write failed");
    }
    process.exit(143);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    const localDir = join(BASE_DIR, sanitizeHandle(handle));
    const hydratedCount = await r2.hydrateToLocal(scanId, localDir);
    scanLog.info({ files_from_r2: hydratedCount, local_dir: localDir }, "hydrated");

    const ckpt = new ScanCheckpoint(session, BASE_DIR, async (filename, data) => {
      await r2.uploadStageFile(scanId, filename, data);
    });

    const onEvent = (ev: PipelineEvent) => {
      if (ev.kind === "stream") {
        if (process.env.GITSHOW_DEBUG) process.stderr.write(ev.text);
        // Stream lines go to DO only (realtime Terminal component) — too
        // noisy for D1.
        if (doClient) {
          void doClient.publish(scanId, { kind: "stream", text: ev.text });
        }
        return;
      }

      // Build the structured event that both sinks see. We map the
      // pipeline's legacy event shape (durationMs, detail) into the
      // unified @gitshow/shared/events shape.
      const structured = toStructured(ev);

      const eventInsert = d1.insertEvent(scanId, {
        kind: structured.kind,
        stage: "stage" in structured ? (structured.stage ?? null) : null,
        worker: "worker" in structured ? (structured.worker ?? null) : null,
        status: "status" in structured ? (structured.status ?? null) : null,
        duration_ms:
          "duration_ms" in structured ? (structured.duration_ms ?? null) : null,
        message:
          structured.kind === "stage-warn" || structured.kind === "error"
            ? structured.message
            : "detail" in structured && structured.detail
              ? structured.detail
              : null,
        // Structured kinds carry their full payload in data_json for the
        // browser to decode without rebuilding the schema. Stage
        // boundaries stay flat.
        data_json:
          structured.kind === "reasoning" ||
          structured.kind === "test-result" ||
          structured.kind === "eval-axes" ||
          structured.kind === "usage" ||
          structured.kind === "plan"
            ? structured
            : null,
      });

      const statusUpdate =
        structured.kind === "stage-start"
          ? d1.updateScanStatus(scanId, { current_phase: structured.stage })
          : structured.kind === "stage-end"
            ? d1.updateScanStatus(scanId, {
                last_completed_phase: structured.stage,
              })
            : Promise.resolve();

      // DO publish runs in parallel with the D1 write and is purely
      // fire-and-forget — a failed publish must never hurt the pipeline.
      if (doClient) {
        void doClient.publish(scanId, structured);
      }

      void Promise.all([eventInsert, statusUpdate]).catch((err) => {
        scanLog.error({ err, kind: ev.kind }, "event-log write failed");
      });
    };

    const profile = await runPipeline({
      session,
      checkpoint: ckpt,
      onEvent,
    });

    let idx = 0;
    for (const claim of profile.claims) {
      await d1.upsertClaim(scanId, {
        id: claim.id,
        beat: claim.beat,
        idx: idx++,
        text: claim.text,
        label: claim.label ?? null,
        sublabel: claim.sublabel ?? null,
        evidence_ids: claim.evidence_ids,
        confidence: claim.confidence,
        status: claim.status,
      });
    }

    const cardMeta = await readCardMeta(localDir);
    await d1.updateScanCompletion(scanId, {
      cost_cents: Math.round((profile.meta.estimated_cost_usd ?? 0) * 100),
      llm_calls: profile.meta.llm_calls ?? 0,
      hook_similarity: cardMeta.hookSimilarity,
      hiring_verdict: cardMeta.hiringVerdict,
      hiring_score: cardMeta.hiringScore,
    });

    clearInterval(heartbeat);
    scanLog.info(
      {
        claims: profile.claims.length,
        cost_usd: profile.meta.estimated_cost_usd,
        llm_calls: profile.meta.llm_calls,
        // D1 writes that exhausted their retry budget. Expect 0 in normal
        // ops; non-zero means we silently dropped heartbeats/events and
        // someone should check the `d1.query.failed` lines above.
        d1_failure_count: d1.failureCount,
      },
      "done",
    );
    process.exit(0);
  } catch (err) {
    clearInterval(heartbeat);
    const msg = err instanceof Error ? err.message : String(err);
    scanLog.error({ err }, "pipeline failed");
    try {
      await d1.updateScanStatus(scanId, { status: "failed", error: msg.slice(0, 2000) });
    } catch (dbErr) {
      scanLog.error({ err: dbErr }, "failed to mark scan as failed");
    }
    process.exit(1);
  }
}

/**
 * Bridge the pipeline's in-process event type to the shared
 * PipelineEvent type that ScanLiveDO + the web app consume. The
 * pipeline uses `durationMs` (camelCase, legacy); shared uses
 * `duration_ms`. Also inserts defaults for optional fields so
 * downstream code doesn't have to null-check.
 */
function toStructured(ev: PipelineEvent): StructuredEvent {
  switch (ev.kind) {
    case "stage-start":
      return { kind: "stage-start", stage: ev.stage, detail: ev.detail };
    case "stage-end":
      return {
        kind: "stage-end",
        stage: ev.stage,
        duration_ms: ev.durationMs,
        detail: ev.detail,
      };
    case "stage-warn":
      return {
        kind: "stage-warn",
        stage: ev.stage,
        message: ev.message,
      };
    case "worker-update":
      return {
        kind: "worker-update",
        worker: ev.worker,
        status: ev.status,
        detail: ev.detail,
      };
    case "stream":
      // Shouldn't reach here — stream is handled directly in onEvent.
      return { kind: "stream", text: ev.text };
  }
}

async function readCardMeta(localDir: string): Promise<{
  hookSimilarity: number | null;
  hiringVerdict: string | null;
  hiringScore: number | null;
}> {
  try {
    const raw = await readFile(join(localDir, "14-card.json"), "utf-8");
    const card = JSON.parse(raw) as {
      meta?: {
        stability?: { hook_similarity?: number };
        hiring_review?: { verdict?: string; overall_score?: number };
      };
    };
    return {
      hookSimilarity: card.meta?.stability?.hook_similarity ?? null,
      hiringVerdict: card.meta?.hiring_review?.verdict ?? null,
      hiringScore: card.meta?.hiring_review?.overall_score ?? null,
    };
  } catch {
    return { hookSimilarity: null, hiringVerdict: null, hiringScore: null };
  }
}

main().catch((err) => {
  logger.error({ err }, "run-scan: unhandled error");
  process.exit(1);
});
