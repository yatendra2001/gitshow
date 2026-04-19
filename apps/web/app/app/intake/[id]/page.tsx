"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";

/**
 * /app/intake/[id]
 *
 * The 60-second pre-scan experience.
 *   1. Shows a shimmering "Reading your GitHub…" line until the intake
 *      agent produces questions.
 *   2. Renders 3-5 questions as cards — chips when the agent suggested
 *      options, text input otherwise.
 *   3. On submit, spawns the full scan and redirects to /app.
 *
 * Mobile-first — single column, generous tap targets (≥44px).
 */

interface IntakeView {
  id: string;
  handle: string;
  status:
    | "pending"
    | "running"
    | "awaiting_answers"
    | "ready"
    | "consumed"
    | "abandoned"
    | "failed";
  questions: Array<{
    id: string;
    question: string;
    why?: string;
    options?: Array<{ value: string; label: string }>;
    default?: string;
  }>;
  read_summary?: string;
  scan_id: string | null;
  error: string | null;
}

const POLL_INTERVAL_MS = 1500;

export default function IntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [intake, setIntake] = useState<IntakeView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll until ready / failed.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const resp = await fetch(`/api/intake/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as IntakeView;
        if (cancelled) return;
        setIntake(data);
        if (data.status === "ready" || data.status === "failed") return;
      } catch {
        /* retry on next tick */
      }
      pollRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [id]);

  const onAnswer = useCallback((qid: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }, []);

  const onSubmit = useCallback(async () => {
    if (!intake || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    // Fold in defaults for skipped questions.
    const finalAnswers: Record<string, string> = {};
    for (const q of intake.questions) {
      const a = answers[q.id];
      if (a && a.trim().length > 0) {
        finalAnswers[q.id] = a;
      } else if (q.default) {
        finalAnswers[q.id] = q.default;
      }
    }

    try {
      const resp = await fetch(
        `/api/intake/${encodeURIComponent(id)}/answers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: finalAnswers }),
        },
      );
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        setSubmitError(err.error ?? "Something went wrong.");
        return;
      }
      const data = (await resp.json()) as { scanId: string };
      router.push(`/s/${data.scanId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }, [intake, answers, submitting, id, router]);

  // ─── Render states ────────────────────────────────────────────────

  const isLoading =
    !intake ||
    intake.status === "pending" ||
    intake.status === "running" ||
    intake.status === "awaiting_answers";

  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="mx-auto w-full max-w-xl px-4 py-10 sm:py-16">
        <header className="mb-8">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
            First, a quick read
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold leading-tight">
            Before we build your profile
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            Answer a few questions so the 40-minute scan aims at the right things.
          </p>
        </header>

        {intake?.status === "failed" ? (
          <FailedState error={intake.error} />
        ) : isLoading ? (
          <LoadingState />
        ) : intake ? (
          <QuestionList
            intake={intake}
            answers={answers}
            onAnswer={onAnswer}
            onSubmit={onSubmit}
            submitting={submitting}
            submitError={submitError}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-6 shadow-[var(--shadow-card)] gs-enter">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 rounded-full bg-[var(--primary)] gs-pulse" />
        <span className="gs-shimmer text-[14px]">Reading your GitHub…</span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        We're looking at your bio, top repos, and recent activity. This takes
        about a minute.
      </p>
    </div>
  );
}

function FailedState({ error }: { error: string | null }) {
  return (
    <div className="rounded-2xl border border-[var(--destructive)]/40 bg-card/60 p-6 shadow-[var(--shadow-card)]">
      <div className="text-[14px] font-medium">We hit a snag</div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        {error ?? "The intake agent couldn't finish. Try again in a moment."}
      </p>
    </div>
  );
}

function QuestionList(props: {
  intake: IntakeView;
  answers: Record<string, string>;
  onAnswer: (qid: string, value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: string | null;
}) {
  const { intake, answers, onAnswer, onSubmit, submitting, submitError } =
    props;
  return (
    <div className="flex flex-col gap-5 gs-enter">
      {intake.questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          index={i + 1}
          total={intake.questions.length}
          question={q}
          value={answers[q.id] ?? ""}
          onChange={(v) => onAnswer(q.id, v)}
        />
      ))}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end pt-2">
        {submitError ? (
          <span className="text-[12px] text-[var(--destructive)] sm:mr-auto">
            {submitError}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="inline-flex items-center justify-center rounded-xl bg-foreground text-background px-5 py-3 text-[14px] font-medium shadow-[var(--shadow-card)] transition-opacity duration-200 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed min-h-11"
        >
          {submitting ? "Starting scan…" : "Start scan"}
        </button>
      </div>
      <p className="text-[12px] text-muted-foreground/80">
        The full scan takes 40–50 minutes. We'll email you when it's ready.
      </p>
    </div>
  );
}

function QuestionCard(props: {
  index: number;
  total: number;
  question: IntakeView["questions"][number];
  value: string;
  onChange: (v: string) => void;
}) {
  const { index, total, question, value, onChange } = props;
  const hasOptions = (question.options?.length ?? 0) > 0;

  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-5 sm:p-6 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        <span>
          {index} / {total}
        </span>
      </div>
      <label
        htmlFor={`q-${question.id}`}
        className="block text-[15px] sm:text-[16px] font-medium leading-snug"
      >
        {question.question}
      </label>
      {question.why ? (
        <p className="mt-1 text-[12px] text-muted-foreground">{question.why}</p>
      ) : null}

      {hasOptions ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {question.options?.map((opt) => {
            const selected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                aria-pressed={selected}
                className={`rounded-xl border px-3 py-2 text-[13px] transition-[color,background-color,border-color,box-shadow] duration-200 min-h-11 ${
                  selected
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/50 bg-card/30 text-foreground hover:bg-card/60"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() =>
              onChange(
                value && !question.options?.some((o) => o.value === value)
                  ? value
                  : "__other__",
              )
            }
            aria-pressed={
              value === "__other__" ||
              (!!value && !question.options?.some((o) => o.value === value))
            }
            className={`rounded-xl border px-3 py-2 text-[13px] transition-[color,background-color,border-color,box-shadow] duration-200 min-h-11 ${
              value === "__other__" ||
              (!!value && !question.options?.some((o) => o.value === value))
                ? "border-foreground"
                : "border-border/50 bg-card/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            Something else
          </button>
          {(value === "__other__" ||
            (!!value && !question.options?.some((o) => o.value === value))) ? (
            <textarea
              id={`q-${question.id}`}
              value={value === "__other__" ? "" : value}
              onChange={(e) => onChange(e.target.value || "__other__")}
              placeholder="Your answer…"
              className="mt-2 w-full rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-[88px]"
            />
          ) : null}
        </div>
      ) : (
        <textarea
          id={`q-${question.id}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Your answer…"
          className="mt-4 w-full rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-[88px]"
        />
      )}
    </div>
  );
}
