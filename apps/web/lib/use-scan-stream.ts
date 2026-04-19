"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScanEventEnvelope, PipelineEvent } from "@gitshow/shared/events";

/**
 * useScanStream — hybrid realtime + backfill subscriber.
 *
 * - On mount: GET /api/scan/<id>/events?since=0 to backfill history.
 * - Opens WS to /api/ws/scan/<id> for live events. The DO's hello frame
 *   replays up to 200 recent events (should overlap the D1 backfill;
 *   we dedupe by envelope id).
 * - Falls back to 2s polling when the WS can't open / stays closed
 *   (mobile Safari, office proxies, etc.).
 * - Returns: events (dedup'd + ordered), claims (by beat), terminalLines
 *   (kind=stream only), status, and a disconnected flag.
 *
 * Events are tuned for smooth rendering — we keep the full envelope
 * list in state but consumers commonly project to (a) the latest
 * per-phase stage-start/end, (b) the reasoning stream, (c) the raw
 * terminal tail. Helpers below do those projections cheaply.
 */

interface UseScanStreamOptions {
  scanId: string;
  /** When true, skip both fetch + WS (used by /s/demo). */
  disabled?: boolean;
}

interface UseScanStreamResult {
  envelopes: ScanEventEnvelope[];
  terminalLines: string[];
  lastEventId: number;
  isConnected: boolean;
  /** Current connection mode for debugging. */
  mode: "ws" | "polling" | "idle";
}

export function useScanStream({
  scanId,
  disabled = false,
}: UseScanStreamOptions): UseScanStreamResult {
  const [envelopes, setEnvelopes] = useState<ScanEventEnvelope[]>([]);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [mode, setMode] = useState<"ws" | "polling" | "idle">("idle");
  const seenIds = useRef<Set<number>>(new Set());
  const lastEventIdRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  const ingestEnvelope = useCallback((env: ScanEventEnvelope) => {
    if (env.event.kind === "stream") {
      setTerminalLines((prev) => {
        const next = [...prev, (env.event as { text: string }).text];
        // Cap the terminal tail at ~2000 lines.
        return next.length > 2000 ? next.slice(-2000) : next;
      });
      return;
    }
    if (seenIds.current.has(env.id)) return;
    seenIds.current.add(env.id);
    if (env.id > lastEventIdRef.current) lastEventIdRef.current = env.id;
    setEnvelopes((prev) => {
      const next = [...prev, env];
      // Sort by id so out-of-order arrivals between WS + polling don't
      // scramble the UI.
      next.sort((a, b) => a.id - b.id);
      return next;
    });
  }, []);

  const ingestMany = useCallback(
    (items: ScanEventEnvelope[]) => items.forEach(ingestEnvelope),
    [ingestEnvelope],
  );

  // ── Polling fallback ──────────────────────────────────────────────
  const pollOnce = useCallback(async () => {
    try {
      const resp = await fetch(
        `/api/scan/${encodeURIComponent(scanId)}/events?since=${lastEventIdRef.current}`,
        { cache: "no-store" },
      );
      if (!resp.ok) return;
      const data = (await resp.json()) as {
        events: ScanEventEnvelope[];
        terminal: boolean;
      };
      ingestMany(data.events ?? []);
      return data.terminal;
    } catch {
      return false;
    }
  }, [scanId, ingestMany]);

  // ── WebSocket connect ─────────────────────────────────────────────
  const openWebSocket = useCallback(() => {
    if (closedRef.current) return;
    try {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/api/ws/scan/${encodeURIComponent(scanId)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setMode("ws");
        setIsConnected(true);
      };
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data?.kind === "hello" && Array.isArray(data.backlog)) {
            ingestMany(data.backlog as ScanEventEnvelope[]);
          } else if (data?.id !== undefined && data?.event) {
            ingestEnvelope(data as ScanEventEnvelope);
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        if (!closedRef.current) {
          setMode("polling");
          // Reconnect after a short delay; polling keeps data flowing
          // in the meantime.
          setTimeout(openWebSocket, 3000);
        }
      };
      ws.onerror = () => {
        setMode("polling");
      };
    } catch {
      setMode("polling");
    }
  }, [scanId, ingestEnvelope, ingestMany]);

  useEffect(() => {
    if (disabled) return;
    closedRef.current = false;

    // 1. Initial backfill from D1.
    void pollOnce().then((terminal) => {
      if (terminal) return; // scan already done, no WS needed
      // 2. Open WS for live updates.
      openWebSocket();
    });

    // 3. Polling loop runs alongside as a safety net. 2s while the WS
    // is connected is cheap + keeps us moving if the DO drops a publish.
    const poll = async () => {
      const terminal = await pollOnce();
      if (terminal || closedRef.current) return;
      pollTimerRef.current = setTimeout(poll, 2000);
    };
    pollTimerRef.current = setTimeout(poll, 2000);

    return () => {
      closedRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [disabled, openWebSocket, pollOnce]);

  return {
    envelopes,
    terminalLines,
    lastEventId: lastEventIdRef.current,
    isConnected,
    mode,
  };
}

// ─── Projections ───────────────────────────────────────────────────

export interface PhaseState {
  phase: string;
  status: "pending" | "running" | "done" | "warn" | "failed";
  duration_ms?: number;
  detail?: string;
  workers: Array<{
    name: string;
    status: "running" | "done" | "failed";
    detail?: string;
  }>;
  warnings: string[];
}

/**
 * Project a flat event stream into per-phase state for the Task list.
 * Handles out-of-order arrivals (WS + polling) safely.
 */
export function projectPhases(
  envelopes: ScanEventEnvelope[],
  pipelinePhases: readonly string[],
): PhaseState[] {
  const byName = new Map<string, PhaseState>();
  for (const p of pipelinePhases) {
    byName.set(p, { phase: p, status: "pending", workers: [], warnings: [] });
  }
  for (const env of envelopes) {
    const e = env.event;
    if (e.kind === "stage-start" && e.stage) {
      const row =
        byName.get(e.stage) ??
        ({ phase: e.stage, status: "pending", workers: [], warnings: [] } as PhaseState);
      row.status = "running";
      row.detail = e.detail ?? row.detail;
      byName.set(e.stage, row);
    } else if (e.kind === "stage-end" && e.stage) {
      const row =
        byName.get(e.stage) ??
        ({ phase: e.stage, status: "pending", workers: [], warnings: [] } as PhaseState);
      row.status = "done";
      row.duration_ms = e.duration_ms ?? row.duration_ms;
      row.detail = e.detail ?? row.detail;
      byName.set(e.stage, row);
    } else if (e.kind === "stage-warn" && e.stage) {
      const row = byName.get(e.stage);
      if (row) {
        row.warnings.push(e.message);
        if (row.status === "running") row.status = "warn";
      }
    } else if (e.kind === "worker-update" && e.worker) {
      // Attribute worker updates to the current running phase.
      const running = Array.from(byName.values()).find(
        (r) => r.status === "running" || r.status === "warn",
      );
      if (running) {
        const existing = running.workers.find((w) => w.name === e.worker);
        if (existing) {
          existing.status = e.status;
          existing.detail = e.detail ?? existing.detail;
        } else {
          running.workers.push({
            name: e.worker,
            status: e.status,
            detail: e.detail,
          });
        }
      }
    } else if (e.kind === "error" && e.stage) {
      const row = byName.get(e.stage);
      if (row) row.status = "failed";
    }
  }
  return Array.from(byName.values());
}

/**
 * Find the current `running` phase, or the last done one if all done.
 */
export function currentPhase(phases: PhaseState[]): PhaseState | null {
  const running = phases.find(
    (p) => p.status === "running" || p.status === "warn",
  );
  if (running) return running;
  const done = phases.filter((p) => p.status === "done");
  return done[done.length - 1] ?? null;
}

/**
 * Pull the latest `usage` event for the cost HUD.
 */
export function latestUsage(envelopes: ScanEventEnvelope[]): {
  cost_cents: number;
  llm_calls: number;
  total_tokens: number;
} | null {
  for (let i = envelopes.length - 1; i >= 0; i--) {
    const e = envelopes[i]!.event;
    if (e.kind === "usage") {
      return {
        cost_cents: e.cost_cents,
        llm_calls: e.llm_calls,
        total_tokens: e.total_tokens,
      };
    }
  }
  return null;
}

/**
 * Most recent eval-axes verdict (for TestResults component).
 */
export function latestEvalAxes(envelopes: ScanEventEnvelope[]) {
  for (let i = envelopes.length - 1; i >= 0; i--) {
    const e = envelopes[i]!.event;
    if (e.kind === "eval-axes") return e;
  }
  return null;
}

/**
 * Recent reasoning lines for a given agent, newest first.
 */
export function reasoningFor(
  envelopes: ScanEventEnvelope[],
  agent: string,
  limit = 5,
): string[] {
  const out: string[] = [];
  for (let i = envelopes.length - 1; i >= 0 && out.length < limit; i--) {
    const e = envelopes[i]!.event;
    if (e.kind === "reasoning" && e.agent === agent) {
      out.push(e.text);
    }
  }
  return out.reverse();
}
