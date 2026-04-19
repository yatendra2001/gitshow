"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientSubscribeFrame,
  ClientPongFrame,
  ScanEventEnvelope,
  ServerFrame,
  ServerDoneFrame,
} from "@gitshow/shared/events";

/**
 * useScanStream — pure WebSocket scan subscriber.
 *
 * Lifecycle:
 *   1. On mount: one-shot GET /api/scan/<id>/events?since=0 to fill
 *      anything older than the DO ring buffer.
 *   2. Open WS to /api/ws/scan/<id>. Server sends a `hello` with the
 *      current ring. We ingest the backlog and record `seq`.
 *   3. Server pings every 20s; we reply with pong. If we miss a ping
 *      for > 45s, treat as dead and reconnect.
 *   4. On close/error, reconnect with exponential backoff (1s → 30s).
 *      On reconnect, send `subscribe { since: lastSeq }` so the DO
 *      replays only what we missed.
 *   5. If the DO replies with `gap { oldest_seq }`, do a one-shot
 *      GET /api/scan/<id>/events?since=<lastSeq>&until=<oldest_seq-1>
 *      to plug the hole, then resume live.
 *   6. On `done` frame, close cleanly and stop reconnecting.
 *
 * There is NO periodic polling. The only HTTP fetches are:
 *   - the initial backfill on mount
 *   - gap-plug fetches on reconnect (rare)
 */

interface UseScanStreamOptions {
  scanId: string;
  /** When true, skip all network activity. */
  disabled?: boolean;
}

export type StreamConnection = "live" | "reconnecting" | "lost" | "idle";

interface UseScanStreamResult {
  envelopes: ScanEventEnvelope[];
  terminalLines: string[];
  lastEventId: number;
  connection: StreamConnection;
  /** True once the scan has reached a terminal state (done frame). */
  isDone: boolean;
  doneStatus?: ServerDoneFrame["status"];
}

const MAX_TERMINAL_LINES = 2000;
const PING_TIMEOUT_MS = 45_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const LOST_CONNECTION_MS = 30_000;

export function useScanStream({
  scanId,
  disabled = false,
}: UseScanStreamOptions): UseScanStreamResult {
  const [envelopes, setEnvelopes] = useState<ScanEventEnvelope[]>([]);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [connection, setConnection] = useState<StreamConnection>("idle");
  const [isDone, setIsDone] = useState(false);
  const [doneStatus, setDoneStatus] = useState<ServerDoneFrame["status"] | undefined>();

  const seenIds = useRef<Set<number>>(new Set());
  const lastSeqRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);
  const gapPluggingRef = useRef(false);

  // ── Ingestion ─────────────────────────────────────────────────────
  const ingestEnvelope = useCallback((env: ScanEventEnvelope) => {
    if (env.event.kind === "stream") {
      setTerminalLines((prev) => {
        const next = [...prev, (env.event as { text: string }).text];
        return next.length > MAX_TERMINAL_LINES
          ? next.slice(-MAX_TERMINAL_LINES)
          : next;
      });
      return;
    }
    if (seenIds.current.has(env.id)) return;
    seenIds.current.add(env.id);
    if (env.id > lastSeqRef.current) lastSeqRef.current = env.id;
    setEnvelopes((prev) => {
      const next = [...prev, env];
      next.sort((a, b) => a.id - b.id);
      return next;
    });
  }, []);

  const ingestMany = useCallback(
    (items: ScanEventEnvelope[]) => items.forEach(ingestEnvelope),
    [ingestEnvelope],
  );

  // ── HTTP one-shot backfill (initial + gap plug) ───────────────────
  const fetchBackfill = useCallback(
    async (since: number, until?: number): Promise<boolean> => {
      try {
        const qs = new URLSearchParams({ since: String(since) });
        if (until !== undefined) qs.set("until", String(until));
        const resp = await fetch(
          `/api/scan/${encodeURIComponent(scanId)}/events?${qs.toString()}`,
          { cache: "no-store" },
        );
        if (!resp.ok) return false;
        const data = (await resp.json()) as {
          events: ScanEventEnvelope[];
          terminal: boolean;
        };
        ingestMany(data.events ?? []);
        return data.terminal;
      } catch {
        return false;
      }
    },
    [scanId, ingestMany],
  );

  // ── Keepalive watchdog ────────────────────────────────────────────
  const armPingWatchdog = useCallback(() => {
    if (pingWatchdogRef.current) clearTimeout(pingWatchdogRef.current);
    pingWatchdogRef.current = setTimeout(() => {
      // No ping for too long — force reconnect.
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
    }, PING_TIMEOUT_MS);
  }, []);

  const armLostTimer = useCallback(() => {
    if (lostTimerRef.current) clearTimeout(lostTimerRef.current);
    lostTimerRef.current = setTimeout(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setConnection("lost");
      }
    }, LOST_CONNECTION_MS);
  }, []);

  const clearLostTimer = useCallback(() => {
    if (lostTimerRef.current) {
      clearTimeout(lostTimerRef.current);
      lostTimerRef.current = null;
    }
  }, []);

  // ── WebSocket connect + frame router ──────────────────────────────
  const openWebSocket = useCallback(() => {
    if (closedRef.current || isDone) return;
    let ws: WebSocket;
    try {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/api/ws/scan/${encodeURIComponent(scanId)}`;
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setConnection("live");
      clearLostTimer();
      armPingWatchdog();

      // Ask the DO to resume from our last known seq. On the first
      // connection this is 0, which means "send the whole ring."
      // After a reconnect it's the highest id we've already seen.
      const sub: ClientSubscribeFrame = {
        kind: "subscribe",
        since: lastSeqRef.current,
      };
      try {
        ws.send(JSON.stringify(sub));
      } catch {
        /* socket already closed */
      }
    };

    ws.onmessage = async (evt) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(evt.data) as ServerFrame;
      } catch {
        return;
      }

      // Envelope (scan event)
      if ("id" in frame && "event" in frame) {
        ingestEnvelope(frame as ScanEventEnvelope);
        return;
      }

      switch ((frame as { kind?: string }).kind) {
        case "hello": {
          const hello = frame as Extract<ServerFrame, { kind: "hello" }>;
          if (Array.isArray(hello.backlog)) {
            ingestMany(hello.backlog);
          }
          armPingWatchdog();
          break;
        }
        case "ping": {
          const pong: ClientPongFrame = {
            kind: "pong",
            ts: (frame as { ts: number }).ts,
          };
          try {
            ws.send(JSON.stringify(pong));
          } catch {
            /* ignore */
          }
          armPingWatchdog();
          break;
        }
        case "gap": {
          if (gapPluggingRef.current) break;
          gapPluggingRef.current = true;
          const { oldest_seq } = frame as Extract<ServerFrame, { kind: "gap" }>;
          try {
            await fetchBackfill(lastSeqRef.current, oldest_seq - 1);
          } finally {
            gapPluggingRef.current = false;
          }
          break;
        }
        case "done": {
          const done = frame as ServerDoneFrame;
          setIsDone(true);
          setDoneStatus(done.status);
          closedRef.current = true;
          try {
            ws.close(1000, "done");
          } catch {
            /* ignore */
          }
          break;
        }
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (pingWatchdogRef.current) {
        clearTimeout(pingWatchdogRef.current);
        pingWatchdogRef.current = null;
      }
      if (closedRef.current || isDone) {
        setConnection("idle");
        return;
      }
      setConnection("reconnecting");
      armLostTimer();
      scheduleReconnect();
    };

    ws.onerror = () => {
      // `onerror` fires immediately before `onclose` in most browsers;
      // we handle reconnect in onclose. No-op here.
    };
  }, [
    scanId,
    ingestEnvelope,
    ingestMany,
    fetchBackfill,
    armPingWatchdog,
    armLostTimer,
    clearLostTimer,
    isDone,
  ]);

  // ── Reconnect scheduling ──────────────────────────────────────────
  const scheduleReconnect = useCallback(() => {
    if (closedRef.current || isDone) return;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    const attempt = reconnectAttemptsRef.current;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_MIN_MS * Math.pow(2, attempt),
    );
    reconnectAttemptsRef.current = attempt + 1;
    reconnectTimerRef.current = setTimeout(openWebSocket, delay);
  }, [openWebSocket, isDone]);

  // ── Lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (disabled) return;
    closedRef.current = false;
    setConnection("idle");

    // 1. Initial backfill — catches everything that happened before we
    //    got here. The WS's `hello` will probably duplicate some, but
    //    we dedupe by envelope id.
    void fetchBackfill(0).then((terminal) => {
      if (terminal) {
        // Scan already reached a terminal state; skip WS entirely.
        setIsDone(true);
        return;
      }
      openWebSocket();
    });

    return () => {
      closedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pingWatchdogRef.current) clearTimeout(pingWatchdogRef.current);
      if (lostTimerRef.current) clearTimeout(lostTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
  }, [disabled, fetchBackfill, openWebSocket]);

  return {
    envelopes,
    terminalLines,
    lastEventId: lastSeqRef.current,
    connection,
    isDone,
    doneStatus,
  };
}

// ─── Projections (kept as-is, UI consumers unchanged) ──────────────

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
 * Handles out-of-order arrivals safely.
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
        ({
          phase: e.stage,
          status: "pending",
          workers: [],
          warnings: [],
        } as PhaseState);
      row.status = "running";
      row.detail = e.detail ?? row.detail;
      byName.set(e.stage, row);
    } else if (e.kind === "stage-end" && e.stage) {
      const row =
        byName.get(e.stage) ??
        ({
          phase: e.stage,
          status: "pending",
          workers: [],
          warnings: [],
        } as PhaseState);
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
