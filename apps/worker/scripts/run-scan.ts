#!/usr/bin/env bun
/**
 * Cloud entrypoint for the worker.
 *
 * Spawned per-scan via the Fly Machines API. Reads scan config from env
 * vars supplied at machine create-time, runs the resume pipeline, and
 * mirrors progress events into D1 so the web app can render live status.
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
 *   BLOG_URLS (comma-separated, up to 5)
 *   FLY_MACHINE_ID (Fly injects this automatically on machines)
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";

import { runResumePipeline } from "../src/resume/pipeline.js";
import { createD1Phases } from "../src/resume/phases.js";
import { SessionUsage } from "../src/session.js";
import { D1Client } from "../src/cloud/d1.js";
import { DOPublishClient } from "@gitshow/shared/cloud/do-client";
import {
  ResendSender,
  renderScanComplete,
  renderScanFailed,
} from "@gitshow/shared/notifications/email";
import { logger, requireEnv } from "../src/util.js";

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL ?? "https://gitshow.io";
import type { ScanSession, ScanSocials } from "../src/schemas.js";

const HEARTBEAT_INTERVAL_MS = 30_000;

async function main() {
  if (process.env.GITSHOW_CLOUD_MODE !== "1") {
    logger.error(
      "run-scan: GITSHOW_CLOUD_MODE is not '1' — refusing to run in cloud mode. " +
        "For local runs use `bun run resume <handle>`.",
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

  // Up to 5 user-provided blog URLs — comma-separated via BLOG_URLS env.
  // Consumed by the blog-import agent in the resume pipeline.
  const blogUrls: string[] = (process.env.BLOG_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);

  const session: ScanSession = {
    id: scanId,
    handle,
    socials,
    blog_urls: blogUrls.length > 0 ? blogUrls : undefined,
    context_notes: process.env.CONTEXT_NOTES || undefined,
    started_at: new Date().toISOString(),
    dashboard_url: `https://openrouter.ai/sessions/${scanId}`,
    model,
    cost_cap_usd: Number.POSITIVE_INFINITY,
  };

  const d1 = D1Client.fromEnv();
  const doClient = DOPublishClient.fromEnv({ logger });
  const email = ResendSender.fromEnv({ logger });
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
    const usage = new SessionUsage();

    await runResumePipeline({
      session,
      usage,
      profileDir: `/tmp/gitshow/${scanId}`,
      writeToR2: true,
      phases: createD1Phases(d1, scanId),
      onGitHubFetched: async ({ accessState, dataSources }) => {
        try {
          await d1.updateScanFetchSnapshot(scanId, {
            access_state: accessState,
            data_sources: dataSources,
          });
        } catch (err) {
          scanLog.warn({ err }, "scan.fetch-snapshot.persist.failed");
        }
      },
      onProgress: (text) => {
        if (process.env.GITSHOW_DEBUG) process.stderr.write(text);
      },
    });

    await d1.updateScanStatus(scanId, {
      status: "succeeded",
      last_completed_phase: "resume",
    });
    await d1.updateScanCompletion(scanId, {
      cost_cents: Math.round(usage.estimatedCostUsd * 100),
      llm_calls: usage.llmCalls,
      hook_similarity: null,
      hiring_verdict: null,
      hiring_score: null,
    });

    try {
      const userId = await d1.getUserIdForScan(scanId);
      if (userId) {
        const profileUrl = `${PUBLIC_APP_URL}/app`;
        await d1.createNotification({
          id: `ntf_${randomUUID()}`,
          user_id: userId,
          kind: "scan-complete",
          scan_id: scanId,
          title: `Your gitshow portfolio is ready`,
          body: `@${handle} — draft ready to review and publish`,
          action_url: profileUrl,
        });

        if (email) {
          const contact = await d1.getUserContactById(userId);
          if (contact?.email) {
            const tpl = renderScanComplete({
              handle,
              claimCount: 0,
              profileUrl,
            });
            void email.send({
              to: contact.email,
              subject: tpl.subject,
              html: tpl.html,
              text: tpl.text,
              tags: [
                { name: "kind", value: "scan-complete" },
                { name: "scan_id", value: scanId },
              ],
            });
          }
        }
      }
    } catch (err) {
      scanLog.warn({ err }, "notification.create.failed");
    }

    if (doClient && process.env.REALTIME_ENDPOINT) {
      try {
        await fetch(
          `${process.env.REALTIME_ENDPOINT.replace(/\/+$/, "")}/scans/${encodeURIComponent(scanId)}/done`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Gitshow-Pipeline-Secret": process.env.PIPELINE_SHARED_SECRET!,
            },
            body: JSON.stringify({ status: "succeeded" }),
          },
        );
      } catch (err) {
        scanLog.warn({ err }, "done.publish.failed");
      }
    }

    clearInterval(heartbeat);
    scanLog.info(
      {
        pipeline: "resume",
        cost_usd: usage.estimatedCostUsd,
        llm_calls: usage.llmCalls,
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
      await d1.updateScanStatus(scanId, {
        status: "failed",
        error: msg.slice(0, 500),
      });
    } catch (dbErr) {
      scanLog.error({ err: dbErr }, "failed to mark scan as failed");
    }

    try {
      const userId = await d1.getUserIdForScan(scanId);
      if (userId && email) {
        const contact = await d1.getUserContactById(userId);
        if (contact?.email) {
          const tpl = renderScanFailed({ handle, error: msg });
          void email.send({
            to: contact.email,
            subject: tpl.subject,
            html: tpl.html,
            text: tpl.text,
            tags: [
              { name: "kind", value: "scan-failed" },
              { name: "scan_id", value: scanId },
            ],
          });
        }
      }
    } catch (emailErr) {
      scanLog.warn({ err: emailErr }, "failure.email.send.failed");
    }

    process.exit(1);
  }
}

main().catch((err) => {
  logger.error({ err }, "run-scan: unhandled");
  process.exit(1);
});
