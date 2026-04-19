#!/usr/bin/env bun
/**
 * Cloud entrypoint for regenerating a single claim with user guidance.
 *
 * Spawned per-revise via Fly Machines API with an `init.cmd` override so
 * the same worker image serves both scan and revise flows. Reads scan
 * state from R2, reruns exactly one sub-agent (the one that produced the
 * target claim's beat) with the user's critique, and writes the updated
 * claim(s) back to D1 + a patched 13-profile.json back to R2.
 *
 * Required env:
 *   SCAN_ID, CLAIM_ID, GUIDANCE (non-empty),
 *   GITSHOW_CLOUD_MODE=1, OPENROUTER_API_KEY,
 *   CF_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   D1_DATABASE_ID, CF_API_TOKEN.
 *
 * Scope v1:
 *   beat=hook         → runAngleSelector + runHookWriter + runHookCritic
 *   beat=number       → runNumbersAgent (regenerates all 3)
 *   beat=disclosure   → runDisclosureAgent
 *   any other beat    → exits with "not supported" — those are editable
 *                        in-place via status='user_edited' (no Fly needed).
 */
import "dotenv/config";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";

import { R2Client } from "../src/cloud/r2.js";
import { D1Client } from "../src/cloud/d1.js";
import { DOPublishClient } from "@gitshow/shared/cloud/do-client";
import { sanitizeHandle, SessionUsage } from "../src/session.js";
import { applyGuardrails } from "../src/guardrails.js";
import { runAngleSelector } from "../src/agents/hook/angle-selector.js";
import { runHookWriter } from "../src/agents/hook/writer.js";
import { runHookCritic } from "../src/agents/hook/critic.js";
import { runNumbersAgent } from "../src/agents/numbers.js";
import { runDisclosureAgent } from "../src/agents/disclosure.js";
import { logger, requireEnv } from "../src/util.js";
import type {
  Profile,
  Claim,
  ScanSession,
  DiscoverOutput,
  WorkerOutput,
} from "../src/schemas.js";

const BASE_DIR = "profiles";
const HEARTBEAT_INTERVAL_MS = 30_000;

async function main() {
  if (process.env.GITSHOW_CLOUD_MODE !== "1") {
    logger.error("revise-claim: GITSHOW_CLOUD_MODE must be '1'");
    process.exit(1);
  }

  const scanId = requireEnv("SCAN_ID");
  const claimId = requireEnv("CLAIM_ID");
  const guidance = (process.env.GUIDANCE || "").trim();
  if (!guidance) {
    logger.error("revise-claim: GUIDANCE env is empty — a revise requires user steering");
    process.exit(1);
  }

  const r2 = R2Client.fromEnv();
  const d1 = D1Client.fromEnv();
  const doClient = DOPublishClient.fromEnv({ logger });
  const reviseLog = logger.child({ scan_id: scanId, claim_id: claimId });

  reviseLog.info({ guidance_len: guidance.length }, "boot");

  const scanRow = await fetchScanRow(d1, scanId);
  const claimRow = await fetchClaimRow(d1, scanId, claimId);
  reviseLog.info({ handle: scanRow.handle, beat: claimRow.beat }, "loaded");

  const heartbeat = setInterval(() => {
    void d1.heartbeat(scanId).catch((err) => {
      reviseLog.error({ err }, "heartbeat failed");
    });
  }, HEARTBEAT_INTERVAL_MS);

  const reviseStart = Date.now();
  void d1
    .insertEvent(scanId, {
      kind: "stage-start",
      stage: "revise-claim",
      message: `claim=${claimId} beat=${claimRow.beat}`,
    })
    .catch(() => {});
  if (doClient) {
    void doClient.publish(scanId, {
      kind: "stage-start",
      stage: "revise-claim",
      detail: `claim=${claimId} beat=${claimRow.beat}`,
    });
  }

  try {
    const localDir = join(BASE_DIR, sanitizeHandle(scanRow.handle));
    await mkdir(localDir, { recursive: true });
    const hydrated = await r2.hydrateToLocal(scanId, localDir);
    reviseLog.info({ files_from_r2: hydrated }, "hydrated");

    const discover = await readJson<DiscoverOutput>(join(localDir, "05-discover.json"));
    // 06-workers.json is saved as `{outputs, artifactsSnapshot}` (see pipeline.ts
    // saveWorkers call) — unwrap the outputs array.
    const workersFile = await readJson<{ outputs: WorkerOutput[] }>(
      join(localDir, "06-workers.json"),
    );
    const workerOutputs = workersFile.outputs;
    const profile = await readJson<Profile>(join(localDir, "13-profile.json"));

    const session: ScanSession = {
      id: scanRow.session_id,
      handle: scanRow.handle,
      socials: {},
      context_notes: scanRow.context_notes ?? undefined,
      started_at: new Date(scanRow.created_at).toISOString(),
      dashboard_url: `https://openrouter.ai/sessions/${scanRow.session_id}`,
      model: scanRow.model,
      cost_cap_usd: Number.POSITIVE_INFINITY,
    };
    const usage = new SessionUsage();

    let updated: Profile;
    switch (claimRow.beat) {
      case "hook":
        updated = await regenerateHook({ session, usage, discover, workerOutputs, profile, guidance });
        break;
      case "number":
        updated = await regenerateNumbers({ session, usage, discover, workerOutputs, profile, guidance });
        break;
      case "disclosure":
        updated = await regenerateDisclosure({ session, usage, discover, workerOutputs, profile, guidance });
        break;
      default:
        throw new Error(
          `revise-claim: regeneration not supported for beat="${claimRow.beat}". ` +
            `Users can still edit these directly via status='user_edited' (web app PATCH, no Fly).`,
        );
    }

    updated = applyGuardrails(updated).profile;

    await r2.uploadStageFile(scanId, "13-profile.json", updated);
    await replaceBeatClaims(d1, scanId, claimRow.beat, updated.claims);

    const elapsedMs = Date.now() - reviseStart;
    await d1.insertEvent(scanId, {
      kind: "stage-end",
      stage: "revise-claim",
      duration_ms: elapsedMs,
      message: `claim=${claimId} beat=${claimRow.beat} llm_calls=${usage.llmCalls}`,
    });
    if (doClient) {
      void doClient.publish(scanId, {
        kind: "stage-end",
        stage: "revise-claim",
        duration_ms: elapsedMs,
        detail: `claim=${claimId} beat=${claimRow.beat} llm_calls=${usage.llmCalls}`,
      });
    }

    clearInterval(heartbeat);
    reviseLog.info(
      {
        beat: claimRow.beat,
        llm_calls: usage.llmCalls,
        cost_usd: usage.estimatedCostUsd,
        elapsed_ms: elapsedMs,
        d1_failure_count: d1.failureCount,
      },
      "done",
    );
    process.exit(0);
  } catch (err) {
    clearInterval(heartbeat);
    const msg = err instanceof Error ? err.message : String(err);
    reviseLog.error({ err }, "revise-claim failed");
    await d1
      .insertEvent(scanId, {
        kind: "error",
        stage: "revise-claim",
        message: `claim=${claimId} err=${msg.slice(0, 400)}`,
      })
      .catch(() => {});
    if (doClient) {
      void doClient.publish(scanId, {
        kind: "error",
        stage: "revise-claim",
        message: `claim=${claimId} err=${msg.slice(0, 400)}`,
      });
    }
    process.exit(1);
  }
}

// ──────────────────────────────────────────────────────────────
// Per-beat regenerators
// ──────────────────────────────────────────────────────────────

interface ReviseInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  workerOutputs: WorkerOutput[];
  profile: Profile;
  guidance: string;
}

async function regenerateHook(input: ReviseInput): Promise<Profile> {
  const { session, usage, discover, workerOutputs, profile, guidance } = input;

  const newAngle = await runAngleSelector({
    session,
    usage,
    discover,
    workerOutputs,
    reviseInstruction: guidance,
  });

  const candidates = await runHookWriter({
    session,
    usage,
    discover,
    workerOutputs,
    artifacts: profile.artifacts,
    angle: newAngle,
    reviseInstruction: guidance,
  });

  const critique = await runHookCritic({
    session,
    usage,
    candidates,
    discover,
  });

  const winner =
    critique.winner_index !== null
      ? candidates.candidates[critique.winner_index]
      : candidates.candidates[
          [...critique.scores].sort(
            (a, b) =>
              b.specific + b.verifiable + b.surprising + b.earned -
              (a.specific + a.verifiable + a.surprising + a.earned),
          )[0].index
        ];

  const newHook: Claim = {
    id: `hook:${nanoid(8)}`,
    beat: "hook",
    text: winner.text,
    evidence_ids: winner.evidence_ids,
    confidence: "high",
    status: "ai_draft",
    prompt_version: "revise-claim-v1",
  };

  const withoutOldHook = profile.claims.filter((c) => c.beat !== "hook");
  return { ...profile, claims: [newHook, ...withoutOldHook] };
}

async function regenerateNumbers(input: ReviseInput): Promise<Profile> {
  const { session, usage, discover, workerOutputs, profile, guidance } = input;

  const priorNumbers: WorkerOutput = {
    worker: "numbers",
    claims: profile.claims
      .filter((c) => c.beat === "number")
      .map((c) => ({
        id: c.id,
        beat: c.beat,
        text: c.text,
        evidence_ids: c.evidence_ids,
        confidence: c.confidence,
        label: c.label,
        sublabel: c.sublabel,
        extra: c.extra,
      })),
    new_artifacts: [],
  };

  const out = await runNumbersAgent({
    session,
    usage,
    discover,
    workerOutputs,
    artifacts: profile.artifacts,
    reviseInstruction: guidance,
    priorNumbers,
  });

  const fresh: Claim[] = out.claims.map((c) => ({
    id: c.id && c.id.length > 0 ? c.id : `number:${nanoid(6)}`,
    beat: "number",
    text: c.text,
    evidence_ids: c.evidence_ids,
    confidence: c.confidence,
    status: "ai_draft",
    prompt_version: "revise-claim-v1",
    label: c.label,
    sublabel: c.sublabel,
    extra: c.extra,
  }));
  const rest = profile.claims.filter((c) => c.beat !== "number");
  return { ...profile, claims: [...rest, ...fresh] };
}

async function regenerateDisclosure(input: ReviseInput): Promise<Profile> {
  const { session, usage, discover, workerOutputs, profile, guidance } = input;

  const priorDisclosure: WorkerOutput = {
    worker: "disclosure",
    claims: profile.claims
      .filter((c) => c.beat === "disclosure")
      .map((c) => ({
        id: c.id,
        beat: c.beat,
        text: c.text,
        evidence_ids: c.evidence_ids,
        confidence: c.confidence,
        label: c.label,
        sublabel: c.sublabel,
        extra: c.extra,
      })),
    new_artifacts: [],
  };

  const out = await runDisclosureAgent({
    session,
    usage,
    discover,
    workerOutputs,
    artifacts: profile.artifacts,
    reviseInstruction: guidance,
    priorDisclosure,
  });

  const fresh: Claim[] = out.claims.map((c) => ({
    id: c.id && c.id.length > 0 ? c.id : `disclosure:${nanoid(6)}`,
    beat: "disclosure",
    text: c.text,
    evidence_ids: c.evidence_ids,
    confidence: c.confidence,
    status: "ai_draft",
    prompt_version: "revise-claim-v1",
    label: c.label,
    sublabel: c.sublabel,
    extra: c.extra,
  }));
  const rest = profile.claims.filter((c) => c.beat !== "disclosure");
  return { ...profile, claims: [...rest, ...fresh] };
}

// ──────────────────────────────────────────────────────────────
// D1 helpers
// ──────────────────────────────────────────────────────────────

interface ScanRow {
  id: string;
  handle: string;
  session_id: string;
  model: string;
  context_notes: string | null;
  created_at: number;
}

async function fetchScanRow(d1: D1Client, scanId: string): Promise<ScanRow> {
  const resp = await d1.query(
    `SELECT id, handle, session_id, model, context_notes, created_at FROM scans WHERE id = ?`,
    [scanId],
  );
  const row = resp.result?.[0]?.results?.[0] as ScanRow | undefined;
  if (!row) throw new Error(`no scan with id ${scanId}`);
  return row;
}

interface ClaimRow {
  id: string;
  beat: string;
  text: string;
}

async function fetchClaimRow(
  d1: D1Client,
  scanId: string,
  claimId: string,
): Promise<ClaimRow> {
  const resp = await d1.query(
    `SELECT id, beat, text FROM claims WHERE id = ? AND scan_id = ?`,
    [claimId, scanId],
  );
  const row = resp.result?.[0]?.results?.[0] as ClaimRow | undefined;
  if (!row) throw new Error(`no claim ${claimId} in scan ${scanId}`);
  return row;
}

/**
 * Replace all claims of a given beat for a scan. The sub-agents above
 * produce fresh sets (numbers picks 3, disclosure picks 0-1, hook picks 1),
 * so we can't reliably merge — we clear the beat and re-upsert.
 */
async function replaceBeatClaims(
  d1: D1Client,
  scanId: string,
  beat: string,
  allClaims: Claim[],
): Promise<void> {
  await d1.query(`DELETE FROM claims WHERE scan_id = ? AND beat = ?`, [scanId, beat]);
  const forBeat = allClaims.filter((c) => c.beat === beat);
  let idx = 0;
  for (const c of forBeat) {
    await d1.upsertClaim(scanId, {
      id: c.id,
      beat: c.beat,
      idx: idx++,
      text: c.text,
      label: c.label ?? null,
      sublabel: c.sublabel ?? null,
      evidence_ids: c.evidence_ids,
      confidence: c.confidence,
      status: c.status,
    });
  }
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as T;
}

main().catch((err) => {
  logger.error({ err }, "revise-claim: unhandled error");
  process.exit(1);
});
