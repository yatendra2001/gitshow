/**
 * gitshow-realtime — per-scan fan-out worker.
 *
 * ScanLiveDO is one Durable Object per scan_id. Endpoints:
 *
 *   POST /scans/:scan_id/events
 *     Called by the Fly worker after every structured pipeline event.
 *     Authenticated via `X-Gitshow-Pipeline-Secret`. Body = one
 *     PipelineEvent (see @gitshow/shared/events). The DO:
 *       - appends an envelope to a ring buffer in storage (so
 *         reconnecting clients can catch up without hitting D1)
 *       - broadcasts the envelope to every connected WebSocket
 *
 *   POST /scans/:scan_id/done
 *     Called by the Fly worker exactly once when the scan reaches a
 *     terminal state. The DO broadcasts a `done` frame and lets
 *     clients tear down cleanly.
 *
 *   GET  /scans/:scan_id/ws   (WebSocket upgrade)
 *     The Next worker forwards upgrades here via `stub.fetch(req)`.
 *     We accept a hibernatable WebSocket + send a `hello` packet
 *     with the current ring buffer tail so the client can resume.
 *
 *     Client frames understood:
 *       - subscribe { since: number }  — replay events with id > since.
 *                                        Emits `gap` if since is older
 *                                        than the ring buffer floor.
 *       - pong      { ts: number }     — keepalive response.
 *
 *     Server frames emitted:
 *       - hello    { seq, backlog }    — full ring on connect
 *       - gap      { oldest_seq }      — asks client to one-shot D1
 *       - ping     { ts }              — every 20s via DO alarm
 *       - done     { final_seq, status } — scan finished
 *       - …envelope for each event
 *
 * Ring buffer retention: last 200 events per scan. Browsers offline
 * for longer fall back to a one-shot D1 fetch (not periodic polling).
 */

import type {
  PipelineEvent,
  ScanEventEnvelope,
  ClientFrame,
  ServerGapFrame,
  ServerHelloFrame,
  ServerPingFrame,
  ServerDoneFrame,
} from "@gitshow/shared/events";

interface Env {
  PIPELINE_SHARED_SECRET: string;
}

const RING_MAX_EVENTS = 200;
const RING_KEY = "ring";
const SEQ_KEY = "seq";
const PING_INTERVAL_MS = 20_000;

interface RingBuffer {
  events: ScanEventEnvelope[];
}

export class ScanLiveDO implements DurableObject {
  private ctx: DurableObjectState;
  private env: Env;
  private scanId: string | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.ctx = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Derive scan_id from path segment exactly once per request.
    const scanId = url.pathname.split("/").filter(Boolean)[1] ?? null;
    if (scanId) this.scanId = scanId;

    if (req.method === "POST" && url.pathname.endsWith("/events")) {
      return this.handleEventPublish(req);
    }

    if (req.method === "POST" && url.pathname.endsWith("/done")) {
      return this.handleDonePublish(req);
    }

    if (
      req.method === "GET" &&
      req.headers.get("Upgrade") === "websocket"
    ) {
      return this.handleWebSocketUpgrade();
    }

    return new Response("not found", { status: 404 });
  }

  // ─── Publish path (from Fly worker) ──────────────────────────────

  private async handleEventPublish(req: Request): Promise<Response> {
    const secret = req.headers.get("X-Gitshow-Pipeline-Secret");
    if (!secret || secret !== this.env.PIPELINE_SHARED_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    let event: PipelineEvent;
    let traceId: string | undefined;
    try {
      const body = (await req.json()) as
        | PipelineEvent
        | { event: PipelineEvent; trace_id?: string };
      // Accept either bare event (legacy) or wrapped { event, trace_id }.
      if (body && typeof body === "object" && "event" in body && body.event) {
        event = body.event as PipelineEvent;
        traceId = (body as { trace_id?: string }).trace_id;
      } else {
        event = body as PipelineEvent;
      }
      if (!event || typeof event !== "object" || !("kind" in event)) {
        throw new Error("malformed event payload");
      }
    } catch (err) {
      return new Response(`bad payload: ${(err as Error).message}`, {
        status: 400,
      });
    }

    const seq = ((await this.ctx.storage.get<number>(SEQ_KEY)) ?? 0) + 1;
    await this.ctx.storage.put(SEQ_KEY, seq);

    const envelope: ScanEventEnvelope = {
      id: seq,
      scan_id: this.scanId ?? "unknown",
      at: Date.now(),
      event,
      ...(traceId ? { trace_id: traceId } : {}),
    };

    // Append to ring buffer, trim to max.
    const ring = (await this.ctx.storage.get<RingBuffer>(RING_KEY)) ?? {
      events: [],
    };
    ring.events.push(envelope);
    if (ring.events.length > RING_MAX_EVENTS) {
      ring.events = ring.events.slice(-RING_MAX_EVENTS);
    }
    await this.ctx.storage.put(RING_KEY, ring);

    this.broadcast(JSON.stringify(envelope));

    return new Response(null, { status: 204 });
  }

  private async handleDonePublish(req: Request): Promise<Response> {
    const secret = req.headers.get("X-Gitshow-Pipeline-Secret");
    if (!secret || secret !== this.env.PIPELINE_SHARED_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    let payload: { status?: "succeeded" | "failed" | "cancelled" };
    try {
      payload = (await req.json()) as { status?: "succeeded" | "failed" | "cancelled" };
    } catch {
      payload = {};
    }
    const status = payload.status ?? "succeeded";
    const seq = (await this.ctx.storage.get<number>(SEQ_KEY)) ?? 0;

    const frame: ServerDoneFrame = { kind: "done", final_seq: seq, status };
    this.broadcast(JSON.stringify(frame));

    // Give clients a beat to process, then close sockets. A fresh scan
    // reuses the same DO id; new connections will get a fresh hello.
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, "scan-done");
      } catch {
        /* ignore */
      }
    }

    return new Response(null, { status: 204 });
  }

  // ─── Subscribe path (from browser via Next proxy) ────────────────

  private async handleWebSocketUpgrade(): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Accept as hibernatable — avoids billing for idle sockets and
    // survives DO sleeps. `webSocketMessage` / `webSocketClose` fire as
    // method calls on this class when the DO wakes.
    this.ctx.acceptWebSocket(server);

    // Immediately send a hello with the last known seq + full ring so
    // the client paints instantly and can subscribe to anything newer.
    const ring = (await this.ctx.storage.get<RingBuffer>(RING_KEY)) ?? {
      events: [],
    };
    const seq = (await this.ctx.storage.get<number>(SEQ_KEY)) ?? 0;
    const hello: ServerHelloFrame = {
      kind: "hello",
      scan_id: this.scanId,
      seq,
      backlog: ring.events,
    };
    try {
      server.send(JSON.stringify(hello));
    } catch {
      /* socket already closed */
    }

    // Ensure the keepalive alarm is scheduled.
    await this.ensurePingAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Client frame handling ──────────────────────────────────────

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    let frame: ClientFrame;
    try {
      const text = typeof msg === "string" ? msg : new TextDecoder().decode(msg);
      frame = JSON.parse(text) as ClientFrame;
    } catch {
      return; // ignore garbage
    }

    if (frame.kind === "pong") {
      // Keepalive — presence is enough. Could record last-seen-at for
      // dead client eviction later; not needed yet.
      return;
    }

    if (frame.kind === "subscribe") {
      await this.handleSubscribe(ws, frame.since);
      return;
    }
  }

  private async handleSubscribe(ws: WebSocket, since: number): Promise<void> {
    const ring = (await this.ctx.storage.get<RingBuffer>(RING_KEY)) ?? {
      events: [],
    };
    const events = ring.events;

    // Nothing newer — done.
    if (events.length === 0) return;

    const oldestSeq = events[0].id;
    const newestSeq = events[events.length - 1].id;

    // Already current.
    if (since >= newestSeq) return;

    // Client is older than the ring — emit gap frame, let it one-shot
    // D1 for the missing range.
    if (since < oldestSeq - 1) {
      const gap: ServerGapFrame = { kind: "gap", oldest_seq: oldestSeq };
      try {
        ws.send(JSON.stringify(gap));
      } catch {
        /* socket closed */
      }
      // After gap, replay what we DO have so the client is caught up
      // once it's finished plugging the gap.
    }

    for (const env of events) {
      if (env.id <= since) continue;
      try {
        ws.send(JSON.stringify(env));
      } catch {
        return; // socket closed mid-replay; bail
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code, "bye");
    } catch {
      /* ignore */
    }
    // If we're down to zero sockets, drop the ping alarm. A new
    // connection will reinstate it.
    if (this.ctx.getWebSockets().length === 0) {
      try {
        await this.ctx.storage.deleteAlarm();
      } catch {
        /* ignore */
      }
    }
  }

  async webSocketError(_ws: WebSocket, _err: unknown) {
    // Swallow — the DO keeps running, the socket is already gone.
  }

  // ─── Keepalive via DO alarm ─────────────────────────────────────

  private async ensurePingAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > Date.now()) return;
    await this.ctx.storage.setAlarm(Date.now() + PING_INTERVAL_MS);
  }

  async alarm() {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;

    const ping: ServerPingFrame = { kind: "ping", ts: Date.now() };
    const payload = JSON.stringify(ping);
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        /* dead socket — hibernation will prune */
      }
    }

    // Reschedule while we still have clients.
    await this.ctx.storage.setAlarm(Date.now() + PING_INTERVAL_MS);
  }

  // ─── Internal ───────────────────────────────────────────────────

  private broadcast(payload: string): void {
    // Broadcast to every live socket. Swallow per-socket failures so a
    // dead client can't block a publish — WebSocket hibernation prunes
    // them on the next wake.
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Top-level fetch handler. The DO is the product of this worker; the
 * top-level handler is only hit for health checks and when the wrong
 * URL shape is used. Real routing is `env.SCAN_LIVE_DO.get(id).fetch()`
 * performed by the upstream Next worker.
 */
export default {
  async fetch(req: Request, env: Env & { SCAN_LIVE_DO: DurableObjectNamespace }) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // Shape: /scans/<scan_id>/events | /scans/<scan_id>/done | /scans/<scan_id>/ws
    if (
      parts[0] === "scans" &&
      parts[1] &&
      (parts[2] === "events" || parts[2] === "done" || parts[2] === "ws")
    ) {
      const scanId = parts[1];
      const id = env.SCAN_LIVE_DO.idFromName(scanId);
      const stub = env.SCAN_LIVE_DO.get(id);
      return stub.fetch(req);
    }

    if (url.pathname === "/") {
      return new Response("gitshow-realtime ok\n", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new Response("not found", { status: 404 });
  },
};
