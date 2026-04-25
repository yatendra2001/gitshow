/**
 * createPipelineEmit — turn a D1Client into an `AgentEventEmit` that
 * writes structured events (reasoning-delta/end, tool-start/end,
 * source-added) to `scan_events`. The web UI's progress page reads
 * those rows and renders them as Reasoning + Tool + Sources cards.
 *
 * We persist to D1 directly (no DO yet) because the progress page
 * already polls /api/scan/status; once that's ported to the realtime
 * DO we can swap this out for a dual sink.
 *
 * ── Coalescing ──
 * The agent SDK emits one `reasoning-delta` per ~10–20ms chunk while
 * the model thinks. For a 30-repo Repo Judge run plus a slow blog-
 * import call we observed 50,000+ deltas in 16 minutes — the worker
 * OOMed under the queue of fire-and-forget D1 writes.
 *
 * We coalesce by `(agent, reasoning_id)` over 250ms windows: the
 * first delta in a window starts a buffer, subsequent deltas
 * concatenate, and a setTimeout flushes a single combined row at
 * 250ms or sooner if the buffer hits 4 KB. `reasoning-end` flushes
 * the partial buffer first so no text is lost.
 *
 * Net write volume drops ~20× during reasoning storms while the user-
 * visible UX (text streaming in) stays smooth — the UI polls every 2s
 * anyway, so 250ms granularity is well below perceptual threshold.
 *
 * Failure mode: any write error is swallowed. The emit MUST NOT break
 * the agent loop — it's strictly additive observability.
 */

import type { D1Client } from "../cloud/d1.js";
import type { PipelineEvent } from "@gitshow/shared/events";
import type { AgentEventEmit } from "../agents/base.js";

/** Max wait between coalesced reasoning-delta flushes. */
const FLUSH_INTERVAL_MS = 250;
/** Force a flush when one buffer exceeds this many chars (UI cap is 4KB). */
const FLUSH_MAX_CHARS = 4000;

interface DeltaBuffer {
  agent: string;
  reasoningId: string;
  text: string;
  /** First delta time — also the row's `at` (close enough). */
  firstAt: number;
  messageId?: string;
  title?: string;
}

export function createPipelineEmit(
  d1: D1Client,
  scanId: string,
): AgentEventEmit {
  // One buffer per (agent, reasoning_id). Map keys are scoped to this
  // emitter so concurrent agent runs (parallel Judge) stay isolated.
  const buffers = new Map<string, DeltaBuffer>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushOne = (key: string, buf: DeltaBuffer) => {
    if (buf.text.length === 0) return;
    void writeReasoningDelta(d1, scanId, buf);
    buffers.delete(key);
  };

  const flushAll = () => {
    for (const [key, buf] of buffers) flushOne(key, buf);
    flushTimer = null;
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(flushAll, FLUSH_INTERVAL_MS);
  };

  return (ev: PipelineEvent) => {
    if (ev.kind === "reasoning-delta") {
      const key = `${ev.agent}::${ev.reasoning_id}`;
      const existing = buffers.get(key);
      if (existing) {
        existing.text += ev.text_delta;
        if (existing.text.length >= FLUSH_MAX_CHARS) {
          flushOne(key, existing);
        }
      } else {
        buffers.set(key, {
          agent: ev.agent,
          reasoningId: ev.reasoning_id,
          text: ev.text_delta,
          firstAt: Date.now(),
          messageId: ev.message_id,
          title: ev.title,
        });
        scheduleFlush();
      }
      return;
    }

    if (ev.kind === "reasoning-end") {
      // Flush the partial buffer for this id before writing the end
      // marker — otherwise tail tokens emitted in the last 250ms
      // window get dropped on the floor.
      const key = `${ev.agent}::${ev.reasoning_id}`;
      const buf = buffers.get(key);
      if (buf && buf.text.length > 0) flushOne(key, buf);
      void persistEvent(d1, scanId, ev);
      return;
    }

    void persistEvent(d1, scanId, ev);
  };
}

async function writeReasoningDelta(
  d1: D1Client,
  scanId: string,
  buf: DeltaBuffer,
): Promise<void> {
  try {
    await d1.insertEvent(scanId, {
      kind: "reasoning-delta",
      worker: buf.agent,
      message: buf.text.slice(0, FLUSH_MAX_CHARS),
      parent_id: buf.reasoningId,
      message_id: buf.messageId ?? null,
      data_json: buf.title ? { title: buf.title } : null,
    });
  } catch {
    /* never let a progress write break the pipeline */
  }
}

async function persistEvent(
  d1: D1Client,
  scanId: string,
  ev: PipelineEvent,
): Promise<void> {
  try {
    switch (ev.kind) {
      case "reasoning-end": {
        await d1.insertEvent(scanId, {
          kind: "reasoning-end",
          worker: ev.agent,
          duration_ms: ev.duration_ms,
          message: ev.summary?.slice(0, 500) ?? null,
          parent_id: ev.reasoning_id,
          message_id: ev.message_id ?? null,
        });
        return;
      }
      case "tool-start": {
        await d1.insertEvent(scanId, {
          kind: "tool-start",
          worker: ev.agent,
          message: ev.display_label,
          parent_id: ev.parent_id ?? null,
          message_id: ev.message_id ?? null,
          data_json: {
            tool_id: ev.tool_id,
            tool_name: ev.tool_name,
            input_preview: ev.input_preview ?? null,
          },
        });
        return;
      }
      case "tool-end": {
        await d1.insertEvent(scanId, {
          kind: "tool-end",
          status: ev.status,
          duration_ms: ev.duration_ms,
          message: ev.error_message ?? null,
          parent_id: ev.parent_id ?? null,
          message_id: ev.message_id ?? null,
          data_json: {
            tool_id: ev.tool_id,
            output_preview: ev.output_preview ?? null,
          },
        });
        return;
      }
      case "source-added": {
        await d1.insertEvent(scanId, {
          kind: "source-added",
          worker: ev.agent,
          message: ev.preview.slice(0, 240),
          parent_id: ev.parent_id ?? null,
          message_id: ev.message_id ?? null,
          data_json: {
            source_id: ev.source_id,
            source_kind: ev.source_kind,
          },
        });
        return;
      }
      default:
        return;
    }
  } catch {
    /* never let a progress write break the pipeline */
  }
}
