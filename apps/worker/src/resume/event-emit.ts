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
 * Failure mode: any write error is swallowed. The emit MUST NOT break
 * the agent loop — it's strictly additive observability.
 */

import type { D1Client } from "../cloud/d1.js";
import type { PipelineEvent } from "@gitshow/shared/events";
import type { AgentEventEmit } from "../agents/base.js";

/**
 * Persistence-side projection of the discriminated PipelineEvent. We
 * map each event kind onto the columns of `scan_events`; rich
 * payloads (reasoning text, tool input/output, source preview) ride
 * inside `data_json`.
 */
export function createPipelineEmit(
  d1: D1Client,
  scanId: string,
): AgentEventEmit {
  return (ev: PipelineEvent) => {
    void persistEvent(d1, scanId, ev);
  };
}

async function persistEvent(
  d1: D1Client,
  scanId: string,
  ev: PipelineEvent,
): Promise<void> {
  try {
    switch (ev.kind) {
      case "reasoning-delta": {
        await d1.insertEvent(scanId, {
          kind: "reasoning-delta",
          worker: ev.agent,
          message: ev.text_delta.slice(0, 4000),
          parent_id: ev.reasoning_id,
          message_id: ev.message_id ?? null,
          data_json: ev.title ? { title: ev.title } : null,
        });
        return;
      }
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
