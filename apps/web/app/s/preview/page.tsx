"use client";

/**
 * /s/preview — hardcoded-events visual test harness for the split pane.
 *
 * Useful for iterating on the progress-pane UI without running a scan.
 * Not linked from anywhere in prod; hit it directly when tweaking the
 * chat + agent UI.
 */

import * as React from "react";
import type { ScanEventEnvelope } from "@gitshow/shared/events";
import type { ScanRow } from "@/lib/scans";
import { ChatPane } from "@/components/scan/chat-pane";
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
      detail: "2,688 commits by you across 20 months — https://github.com/doac-stuff/flightcast-core",
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
  {
    id: 9,
    scan_id: "preview",
    at: NOW - 34_000,
    event: {
      kind: "worker-update",
      worker: "temporal",
      status: "running",
    },
  },
  {
    id: 10,
    scan_id: "preview",
    at: NOW - 33_000,
    event: {
      kind: "worker-update",
      worker: "content",
      status: "running",
    },
  },
  {
    id: 11,
    scan_id: "preview",
    at: NOW - 20_000,
    event: {
      kind: "reasoning",
      agent: "discover",
      text: "Yatendra's clearest signal is being the single top committer on doac-stuff/flightcast-core — 2,688 of 9,971 commits across a 27-person team over roughly 20 months.",
    },
  },
  {
    id: 12,
    scan_id: "preview",
    at: NOW - 10_000,
    event: {
      kind: "reasoning",
      agent: "discover",
      text: "Before that professional engagement solidified, he built a recognizable personal pattern of iterating on AI-powered product ideas in rapid cycles.",
    },
  },
  {
    id: 13,
    scan_id: "preview",
    at: NOW - 5_000,
    event: {
      kind: "worker-update",
      worker: "cross-repo",
      status: "done",
      detail: "Found 5 cross-repo patterns",
    },
  },
  {
    id: 14,
    scan_id: "preview",
    at: NOW - 1000,
    event: {
      kind: "worker-update",
      worker: "deep-dive",
      status: "running",
    },
  },
];

const SEED_TERMINAL: string[] = [
  "[pipeline] boot — handle=yatendra2001",
  "[pipeline] github-fetch ok (96 repos, 200 PRs)",
  "info  - repo-filter: 25 deep, 71 light",
  "[pipeline] inventory running (parallel, 3 workers)",
  "  clone doac-stuff/flightcast-core ok (2.3s)",
  "  clone AppFlowy-IO/AppFlowy ok (4.1s)",
  "  clone yatendra2001/catalyst ok (1.2s)",
  "[pipeline] discover running",
  "[pipeline] workers: 6 parallel agents",
  "  cross-repo running…",
  "  temporal running…",
  "  content running…",
  "  signal queued",
  "  deep-dive running",
  "ok  - cross-repo done (5 patterns)",
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
  const [messages] = React.useState([]);
  return (
    <div className="grid h-screen w-full grid-cols-[minmax(280px,25%)_1fr]">
      <ChatPane
        scan={SEED_SCAN}
        card={null}
        partialCard={null}
        messages={messages}
        onSendRevise={async () => {}}
        revisePending={false}
      />
      <ProgressPane
        scan={SEED_SCAN}
        envelopes={SEED_ENVELOPES}
        terminalLines={SEED_TERMINAL}
        partialCard={null}
        card={null}
        revisePending={null}
      />
    </div>
  );
}
