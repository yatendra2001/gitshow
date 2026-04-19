"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  AgentQuestionEvent,
  AgentAnswerEvent,
  ScanEventEnvelope,
} from "@gitshow/shared/events";

/**
 * AgentQuestionCard — renders an inline question the running agent asked.
 *
 * Question lifecycle:
 *   1. Worker emits `agent-question` → this card appears.
 *   2. User picks an option or types an answer → POST /api/scan/:id/answer.
 *   3. Worker polls agent_answers, sees the reply, resumes.
 *   4. Worker emits `agent-answer` → card collapses into "answered".
 *
 * If the user ignores the card and the worker times out, the worker
 * emits `agent-answer` with source=timeout-default; the card collapses
 * into "answered automatically".
 *
 * Card is mobile-first — full-width, chip picker + optional text area.
 */

interface AgentQuestionCardProps {
  scanId: string;
  envelopes: ScanEventEnvelope[];
  /** Optional: called after a successful answer POST. */
  onAnswered?: (questionId: string, answer: string) => void;
  className?: string;
}

export function AgentQuestionCards({
  scanId,
  envelopes,
  onAnswered,
  className,
}: AgentQuestionCardProps) {
  const questions = useMemo(() => collectQuestions(envelopes), [envelopes]);

  if (questions.length === 0) return null;
  return (
    <div
      className={`flex flex-col gap-3 ${className ?? ""}`}
      aria-live="polite"
    >
      {questions.map((q) => (
        <AgentQuestionCard
          key={q.question_id}
          scanId={scanId}
          question={q}
          onAnswered={onAnswered}
        />
      ))}
    </div>
  );
}

function AgentQuestionCard({
  scanId,
  question,
  onAnswered,
}: {
  scanId: string;
  question: {
    question_id: string;
    question: string;
    options?: Array<{ value: string; label: string }>;
    stage: string;
    answered: { answer: string | null; source: "user" | "timeout-default" } | null;
  };
  onAnswered?: (questionId: string, answer: string) => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const already = question.answered;

  const submit = useCallback(
    async (answer: string) => {
      if (!answer.trim()) return;
      setSubmitting(true);
      setError(null);
      try {
        const resp = await fetch(
          `/api/scan/${encodeURIComponent(scanId)}/answer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question_id: question.question_id,
              answer,
            }),
          },
        );
        if (!resp.ok) {
          const e = (await resp.json().catch(() => ({}))) as { error?: string };
          setError(e.error ?? "couldn't send");
          return;
        }
        onAnswered?.(question.question_id, answer);
      } catch (err) {
        setError(err instanceof Error ? err.message : "network error");
      } finally {
        setSubmitting(false);
      }
    },
    [scanId, question.question_id, onAnswered],
  );

  if (already) {
    return (
      <div className="rounded-2xl border border-border/30 bg-card/60 px-4 py-3 text-[12px] text-muted-foreground">
        <div className="text-[10px] uppercase tracking-wide mb-1">
          {already.source === "user" ? "You answered" : "Answered automatically"}
        </div>
        <div className="text-[13px] text-foreground leading-snug">
          {already.answer || "(no answer — defaulted)"}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-[var(--chart-4)]/35 bg-[var(--chart-4)]/[0.05] p-4 sm:p-5 gs-enter"
      role="group"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--chart-4)] gs-pulse" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          The agent needs you · {question.stage}
        </span>
      </div>
      <p className="text-[14px] sm:text-[15px] font-medium leading-snug mb-3">
        {question.question}
      </p>

      {question.options && question.options.length > 0 ? (
        <div className="flex flex-wrap gap-2 mb-3">
          {question.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={submitting}
              onClick={() => void submit(opt.value)}
              className="rounded-xl border border-border/50 bg-card/60 px-3 py-2 text-[13px] hover:bg-card transition-colors disabled:opacity-50 min-h-11"
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            question.options?.length
              ? "Or type something else…"
              : "Your answer…"
          }
          className="flex-1 rounded-xl border border-border/50 bg-card/60 px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-[56px]"
          rows={2}
        />
        <button
          type="button"
          disabled={submitting || !value.trim()}
          onClick={() => void submit(value)}
          className="rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium disabled:opacity-50 hover:opacity-90 transition-opacity min-h-11 whitespace-nowrap"
        >
          {submitting ? "Sending…" : "Send"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-[var(--destructive)]">{error}</p>
      ) : null}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

interface PairedQuestion {
  question_id: string;
  question: string;
  options?: Array<{ value: string; label: string }>;
  stage: string;
  answered: { answer: string | null; source: "user" | "timeout-default" } | null;
}

function collectQuestions(envelopes: ScanEventEnvelope[]): PairedQuestion[] {
  const byId = new Map<string, PairedQuestion>();
  for (const env of envelopes) {
    const ev = env.event;
    if (ev.kind === "agent-question") {
      const q = ev as AgentQuestionEvent;
      if (!byId.has(q.question_id)) {
        byId.set(q.question_id, {
          question_id: q.question_id,
          question: q.question,
          options: q.options,
          stage: q.stage,
          answered: null,
        });
      }
    } else if (ev.kind === "agent-answer") {
      const a = ev as AgentAnswerEvent;
      const existing = byId.get(a.question_id);
      if (existing) {
        existing.answered = { answer: a.answer, source: a.source };
      }
    }
  }
  return Array.from(byId.values());
}
