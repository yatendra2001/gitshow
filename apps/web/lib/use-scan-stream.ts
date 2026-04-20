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
/** D1 backfill page size. Route caps at 500; this stays under that. */
const BACKFILL_PAGE_LIMIT = 500;
/** Safety cap on total backfill pages per gap fill, to avoid runaways. */
const BACKFILL_MAX_PAGES = 40;

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
  /**
   * Snapshot of `lastSeqRef` at the moment each WS connection opens.
   * Used to compute gap ranges correctly — we can't read `lastSeqRef`
   * after the hello arrives because its backlog has already advanced
   * the pointer past the gap we're trying to fill.
   */
  const preWsSeqRef = useRef(0);
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

  // ── HTTP backfill ─────────────────────────────────────────────────
  //
  // One D1 call. Returns the events it got (caller decides what to do
  // with them) and the scan's terminal flag. `ingestMany` is applied
  // here so pagination logic can just inspect event counts.
  const fetchBackfillPage = useCallback(
    async (
      since: number,
      until?: number,
      limit = BACKFILL_PAGE_LIMIT,
    ): Promise<{ count: number; lastId: number; terminal: boolean } | null> => {
      try {
        const qs = new URLSearchParams({
          since: String(since),
          limit: String(limit),
        });
        if (until !== undefined) qs.set("until", String(until));
        const resp = await fetch(
          `/api/scan/${encodeURIComponent(scanId)}/events?${qs.toString()}`,
          { cache: "no-store" },
        );
        if (!resp.ok) return null;
        const data = (await resp.json()) as {
          events: ScanEventEnvelope[];
          terminal: boolean;
        };
        const events = data.events ?? [];
        if (events.length > 0) ingestMany(events);
        return {
          count: events.length,
          lastId: events.length > 0 ? events[events.length - 1].id : since,
          terminal: data.terminal,
        };
      } catch {
        return null;
      }
    },
    [scanId, ingestMany],
  );

  /**
   * Paginate D1 backfill over `(since, untilInclusive]`. Keeps calling
   * fetchBackfillPage, advancing `since` to the last id we got, until
   * either the range is covered, a page returns short (DB exhausted),
   * or the safety cap trips.
   *
   * Exists because a full scan emits ~3000 structured events — more
   * than one page of 500 can carry. The old one-shot backfill lost
   * every event past the first page, which is why the phase list
   * showed an empty run of pending rows ending in a lone completed
   * phase once the realtime WS started delivering tail events.
   */
  const paginateBackfill = useCallback(
    async (
      sinceExclusive: number,
      untilInclusive?: number,
    ): Promise<boolean> => {
      let cursor = sinceExclusive;
      let terminal = false;
      for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
        if (untilInclusive !== undefined && cursor >= untilInclusive) break;
        const result = await fetchBackfillPage(cursor, untilInclusive);
        if (!result) break;
        terminal = result.terminal;
        if (result.count === 0) break;
        if (result.lastId <= cursor) break;
        cursor = result.lastId;
        if (result.count < BACKFILL_PAGE_LIMIT) break;
      }
      return terminal;
    },
    [fetchBackfillPage],
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
      // Connect DIRECT to the realtime worker. Routing through the
      // Next/OpenNext web worker breaks WS upgrades (the `webSocket`
      // field on the Response object doesn't survive the proxy). The
      // realtime worker is publicly addressable and the scan_id is a
      // nanoid, so this is safe for MVP.
      const realtimeHost =
        (typeof window !== "undefined" &&
          (
            window as unknown as { __GITSHOW_REALTIME_HOST__?: string }
          ).__GITSHOW_REALTIME_HOST__) ||
        "gitshow-realtime.yatendra2001kumar.workers.dev";
      const url = `wss://${realtimeHost}/scans/${encodeURIComponent(scanId)}/ws`;
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

      // Snapshot where we were BEFORE hello's backlog advances
      // lastSeqRef. Hello + gap frame handlers use this to compute
      // the missing-range correctly.
      preWsSeqRef.current = lastSeqRef.current;

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
          const backlog = Array.isArray(hello.backlog) ? hello.backlog : [];
          // If the DO's ring starts newer than what we already have,
          // there's a hole between `preWsSeqRef` and the first backlog
          // id. Fill it from D1 first — otherwise the UI renders an
          // empty run of phases terminating in a lone "done" row,
          // because only the tail of the scan made it into the ring.
          if (backlog.length > 0) {
            const oldestInBacklog = backlog[0].id;
            const expectedNext = preWsSeqRef.current + 1;
            if (
              oldestInBacklog > expectedNext &&
              !gapPluggingRef.current
            ) {
              gapPluggingRef.current = true;
              try {
                await paginateBackfill(
                  preWsSeqRef.current,
                  oldestInBacklog - 1,
                );
              } finally {
                gapPluggingRef.current = false;
              }
            }
            ingestMany(backlog);
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
            // Use the pre-WS seq. `lastSeqRef` has been advanced by
            // hello's backlog and can sit past `oldest_seq`, which
            // would produce an empty SQL range (since > until).
            await paginateBackfill(preWsSeqRef.current, oldest_seq - 1);
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
    paginateBackfill,
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

    // 1. Initial backfill — paginate until we've caught up to the DB
    //    head OR hit a terminal. The WS's `hello` will probably
    //    duplicate some of the tail; `seenIds` dedupes.
    //
    //    A single page of 500 is not enough for a full scan, which
    //    emits ~3000 structured events. The old one-shot code left
    //    the UI without stage-starts for everything that rolled off
    //    the DO ring — phases appeared pending even as the scan
    //    finished around them.
    void paginateBackfill(0).then((terminal) => {
      if (terminal) {
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
  }, [disabled, paginateBackfill, openWebSocket]);

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
