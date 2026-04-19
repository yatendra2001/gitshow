"use client";

import { useMemo } from "react";
import type {
  ScanEventEnvelope,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  ToolStartEvent,
  ToolEndEvent,
  SourceAddedEvent,
  ReviseAppliedEvent,
} from "@gitshow/shared/events";
import { cn } from "@/lib/utils";

/**
 * InlineReviseProgress — groups streaming events under a single revise
 * turn (scoped by message_id). Renders like a mini chain-of-thought
 * right below the user's bubble.
 *
 * Rules from the brainstorm:
 *   - Auto-open while reasoning is streaming (shimmer on last line).
 *   - Collapses to "Applied · durability 8.4 → 7.2" row once the
 *     matching `revise-applied` event lands.
 *   - Shows any agent-question cards inline if the revise pauses
 *     asking the user for clarification.
 */

interface Props {
  envelopes: ScanEventEnvelope[];
  messageId: string;
  className?: string;
}

export function InlineReviseProgress({ envelopes, messageId, className }: Props) {
  const scoped = useMemo(
    () =>
      envelopes.filter((e) => {
        const ev = e.event as { message_id?: string };
        return ev.message_id === messageId;
      }),
    [envelopes, messageId],
  );

  const applied = useMemo(
    () =>
      scoped
        .map((e) => e.event)
        .find((ev): ev is ReviseAppliedEvent => ev.kind === "revise-applied"),
    [scoped],
  );

  const reasoningBlocks = useMemo(
    () => buildReasoningBlocks(scoped),
    [scoped],
  );

  const tools = useMemo(() => buildTools(scoped), [scoped]);
  const sources = useMemo(() => buildSources(scoped), [scoped]);

  if (scoped.length === 0) return null;

  if (applied) {
    return (
      <div
        className={cn(
          "rounded-xl border border-border/30 bg-card/40 px-3 py-2 text-[12px] text-muted-foreground gs-enter",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--chart-3)]" />
          <span className="font-medium text-foreground">Applied</span>
          <span>· {applied.diff.length} change{applied.diff.length === 1 ? "" : "s"}</span>
        </div>
        {applied.diff.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {applied.diff.slice(0, 4).map((d, i) => (
              <li key={i} className="text-[11px] leading-snug truncate">
                <span className="font-mono text-muted-foreground">{d.beat}</span>
                <span className="mx-1 text-muted-foreground/60">·</span>
                <span className="text-foreground/70 line-through">
                  {truncate(d.before, 34)}
                </span>
                <span className="mx-1 text-muted-foreground/60">→</span>
                <span className="text-foreground">
                  {truncate(d.after, 34)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border/30 bg-card/40 p-3 text-[12px] leading-relaxed gs-enter",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)] gs-pulse" />
        <span>gitshow is revising</span>
      </div>
      {reasoningBlocks.map((b) => (
        <div key={b.id} className="mb-2">
          {b.title ? (
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80 mb-1">
              {b.title}
            </div>
          ) : null}
          <p className="text-[12px] leading-relaxed">
            {b.text}
            {!b.done ? <span className="gs-shimmer"> …</span> : null}
          </p>
        </div>
      ))}
      {tools.length > 0 ? (
        <div className="mt-2 space-y-1">
          {tools.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 text-[11px] text-muted-foreground"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  t.done
                    ? t.status === "ok"
                      ? "bg-[var(--chart-3)]"
                      : "bg-[var(--destructive)]"
                    : "bg-[var(--chart-4)] gs-pulse",
                )}
              />
              <span className="font-mono truncate">{t.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {sources.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sources.slice(0, 6).map((s) => (
            <span
              key={s.id}
              className="rounded-full border border-border/40 bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground"
              title={s.preview}
            >
              {s.kind} · {truncate(s.preview, 24)}
            </span>
          ))}
          {sources.length > 6 ? (
            <span className="text-[10px] text-muted-foreground/70">
              +{sources.length - 6} more
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Projections ───────────────────────────────────────────────────

interface ReasoningBlock {
  id: string;
  title?: string;
  text: string;
  done: boolean;
}

function buildReasoningBlocks(scoped: ScanEventEnvelope[]): ReasoningBlock[] {
  const byId = new Map<string, ReasoningBlock>();
  for (const env of scoped) {
    const ev = env.event;
    if (ev.kind === "reasoning-delta") {
      const d = ev as ReasoningDeltaEvent;
      const existing = byId.get(d.reasoning_id);
      if (existing) {
        existing.text += d.text_delta;
      } else {
        byId.set(d.reasoning_id, {
          id: d.reasoning_id,
          title: d.title,
          text: d.text_delta,
          done: false,
        });
      }
    } else if (ev.kind === "reasoning-end") {
      const e = ev as ReasoningEndEvent;
      const existing = byId.get(e.reasoning_id);
      if (existing) {
        existing.done = true;
        if (e.summary) existing.title = existing.title ?? e.summary;
      }
    }
  }
  return Array.from(byId.values());
}

interface ToolRow {
  id: string;
  label: string;
  done: boolean;
  status?: "ok" | "err" | "denied";
}

function buildTools(scoped: ScanEventEnvelope[]): ToolRow[] {
  const byId = new Map<string, ToolRow>();
  for (const env of scoped) {
    const ev = env.event;
    if (ev.kind === "tool-start") {
      const t = ev as ToolStartEvent;
      if (!byId.has(t.tool_id)) {
        byId.set(t.tool_id, { id: t.tool_id, label: t.display_label, done: false });
      }
    } else if (ev.kind === "tool-end") {
      const t = ev as ToolEndEvent;
      const row = byId.get(t.tool_id);
      if (row) {
        row.done = true;
        row.status = t.status;
      }
    }
  }
  return Array.from(byId.values());
}

interface SourceRow {
  id: string;
  kind: string;
  preview: string;
}

function buildSources(scoped: ScanEventEnvelope[]): SourceRow[] {
  const rows: SourceRow[] = [];
  const seen = new Set<string>();
  for (const env of scoped) {
    const ev = env.event;
    if (ev.kind === "source-added") {
      const s = ev as SourceAddedEvent;
      if (seen.has(s.source_id)) continue;
      seen.add(s.source_id);
      rows.push({ id: s.source_id, kind: s.source_kind, preview: s.preview });
    }
  }
  return rows;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
