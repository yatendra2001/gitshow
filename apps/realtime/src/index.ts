/**
 * gitshow-realtime — per-scan fan-out worker.
 *
 * ScanLiveDO is one Durable Object per scan_id. Two endpoints:
 *
 *   1. POST /scans/:scan_id/events
 *      Called by the Fly worker after every structured pipeline event.
 *      Authenticated via `X-Gitshow-Pipeline-Secret`. Body = one
 *      PipelineEvent (see @gitshow/shared/events). The DO:
 *        - appends an envelope to a short ring buffer in storage
 *          (so reconnecting clients can catch up without hitting D1)
 *        - broadcasts the envelope to every connected WebSocket
 *
 *   2. GET  /scans/:scan_id/ws   (WebSocket upgrade)
 *      The Next worker forwards upgrades here via `stub.fetch(req)`.
 *      We accept a hibernatable WebSocket + send a tiny hello packet
 *      with the current ring buffer tail so the client can resume.
 *
 * Ring buffer retention: last 200 events / 30 min, whichever is bigger.
 * Browsers that fall out of coverage for longer fall back to the D1
 * polling endpoint on the web worker.
 */

import type { PipelineEvent, ScanEventEnvelope } from "@gitshow/shared/events";

interface Env {
  PIPELINE_SHARED_SECRET: string;
}

const RING_MAX_EVENTS = 200;
const RING_KEY = "ring";
const SEQ_KEY = "seq";

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
    try {
      event = (await req.json()) as PipelineEvent;
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

    // Broadcast to every live socket. Swallow per-socket failures so a
    // dead client can't block a publish — WebSocket hibernation prunes
    // them on the next wake.
    const payload = JSON.stringify(envelope);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
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
    try {
      server.send(
        JSON.stringify({
          kind: "hello",
          scan_id: this.scanId,
          seq,
          backlog: ring.events,
        }),
      );
    } catch {
      /* socket already closed */
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation callbacks. We don't accept client → server messages for
  // now; the DO is publish-only. If a client sends anything, log + ignore.
  async webSocketMessage(ws: WebSocket, _msg: string | ArrayBuffer) {
    try {
      ws.send(JSON.stringify({ kind: "ack" }));
    } catch {
      /* ignore */
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code, "bye");
    } catch {
      /* ignore */
    }
  }

  async webSocketError(_ws: WebSocket, _err: unknown) {
    // Swallow — the DO keeps running, the socket is already gone.
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

    // Shape: /scans/<scan_id>/events  or  /scans/<scan_id>/ws
    if (parts[0] === "scans" && parts[1] && (parts[2] === "events" || parts[2] === "ws")) {
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
