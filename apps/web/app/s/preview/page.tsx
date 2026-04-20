"use client";

/**
 * /s/preview — hardcoded-events visual test harness for the scan page.
 *
 * Useful for iterating on the progress UI without running a real scan.
 * Not linked from anywhere in prod; hit it directly when tweaking the
 * running or succeeded views.
 */

import * as React from "react";
import type { ScanEventEnvelope } from "@gitshow/shared/events";
import type { ScanRow } from "@/lib/scans";
import { ProgressPane } from "@/components/scan/progress-pane";

const NOW = Date.now();

const SEED_ENVELOPES: ScanEventEnvelope[] = [
  {
    id: 1,
    scan_id: "preview",
    at: NOW - 60_000,
    event: { kind: "stage-start", stage: "github-fetch" },
  },
  {
    id: 2,
    scan_id: "preview",
    at: NOW - 55_000,
    event: {
      kind: "stage-end",
      stage: "github-fetch",
      duration_ms: 5000,
      detail: "96 repos · 200 PRs · 45 reviews",
    },
  },
  {
    id: 3,
    scan_id: "preview",
    at: NOW - 54_000,
    event: { kind: "stage-start", stage: "inventory" },
  },
  {
    id: 4,
    scan_id: "preview",
    at: NOW - 50_000,
    event: {
      kind: "worker-update",
      worker: "doac-stuff/flightcast-core",
      status: "running",
    },
  },
  {
    id: 5,
    scan_id: "preview",
    at: NOW - 40_000,
    event: {
      kind: "worker-update",
      worker: "doac-stuff/flightcast-core",
      status: "done",
      detail: "2,688 commits by you across 20 months",
    },
  },
  {
    id: 6,
    scan_id: "preview",
    at: NOW - 39_000,
    event: {
      kind: "stage-end",
      stage: "inventory",
      duration_ms: 15_000,
      detail: "Read 25 repos",
    },
  },
  {
    id: 7,
    scan_id: "preview",
    at: NOW - 38_000,
    event: { kind: "stage-start", stage: "workers" },
  },
  {
    id: 8,
    scan_id: "preview",
    at: NOW - 35_000,
    event: {
      kind: "worker-update",
      worker: "cross-repo",
      status: "running",
    },
  },
];

const SEED_TERMINAL: string[] = [
  "[pipeline] boot — handle=yatendra2001",
  "[pipeline] github-fetch ok (96 repos, 200 PRs)",
  "info  - repo-filter: 25 deep, 71 light",
  "[pipeline] workers: 6 parallel agents",
];

const SEED_SCAN: ScanRow = {
  id: "preview",
  user_id: "preview-user",
  handle: "yatendra2001",
  session_id: "preview-session",
  model: "anthropic/claude-sonnet-4.6",
  status: "running",
  current_phase: "workers",
  last_completed_phase: "discover",
  fly_machine_id: null,
  last_heartbeat: NOW,
  error: null,
  cost_cents: 312,
  llm_calls: 4,
  hook_similarity: null,
  hiring_verdict: null,
  hiring_score: null,
  socials_json: null,
  context_notes: null,
  created_at: NOW - 60_000,
  updated_at: NOW,
  completed_at: null,
};

export default function PreviewPage() {
  return (
    <div className="h-screen w-full">
      <ProgressPane
        scan={SEED_SCAN}
        envelopes={SEED_ENVELOPES}
        terminalLines={SEED_TERMINAL}
        partialCard={null}
        card={null}
      />
    </div>
  );
}
