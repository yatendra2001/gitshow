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

interface ProfileInputs {
  linkedin: string;
  twitter: string;
  website: string;
  youtube: string;
  blogUrls: string[];
}

const EMPTY_INPUTS: ProfileInputs = {
  linkedin: "",
  twitter: "",
  website: "",
  youtube: "",
  blogUrls: [""],
};

export default function IntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [intake, setIntake] = useState<IntakeView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [inputs, setInputs] = useState<ProfileInputs>(EMPTY_INPUTS);
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

    const trimmed = (v: string) => v.trim();
    // Server demands real http(s) URLs for linkedin/website/youtube/blogs.
    // Accept bare hosts like `linkedin.com/in/foo` by prepending https://.
    const normalizeUrl = (v: string) => {
      const t = v.trim();
      if (!t) return "";
      return /^https?:\/\//i.test(t) ? t : `https://${t}`;
    };
    const cleanBlogs = inputs.blogUrls
      .map(normalizeUrl)
      .filter((u) => u.length > 0)
      .slice(0, 5);
    const socials: {
      linkedin?: string;
      twitter?: string;
      website?: string;
      youtube?: string;
    } = {};
    if (trimmed(inputs.linkedin)) socials.linkedin = normalizeUrl(inputs.linkedin);
    if (trimmed(inputs.twitter)) socials.twitter = trimmed(inputs.twitter);
    if (trimmed(inputs.website)) socials.website = normalizeUrl(inputs.website);
    if (trimmed(inputs.youtube)) socials.youtube = normalizeUrl(inputs.youtube);

    try {
      const resp = await fetch(
        `/api/intake/${encodeURIComponent(id)}/answers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: finalAnswers,
            socials: Object.keys(socials).length > 0 ? socials : undefined,
            blog_urls: cleanBlogs.length > 0 ? cleanBlogs : undefined,
          }),
        },
      );
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as {
          error?: string;
          issues?: Array<{ path?: Array<string | number>; message?: string }>;
        };
        // "invalid body" is useless to users. If the server returned
        // zod issues, show the first field + message instead.
        const issue = err.issues?.[0];
        if (err.error === "invalid body" && issue) {
          const field = issue.path?.join(".") ?? "input";
          setSubmitError(`${field}: ${issue.message ?? "invalid value"}`);
        } else {
          setSubmitError(err.error ?? "Something went wrong.");
        }
        return;
      }
      // Land directly on the live progress view for the new scan.
      const data = (await resp.json().catch(() => ({}))) as { scanId?: string };
      if (data.scanId) {
        router.push(`/app/scan/${data.scanId}`);
      } else {
        router.push("/app");
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }, [intake, answers, inputs, submitting, id, router]);

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
        ) : (
          <div className="flex flex-col gap-6">
            {/* Always render the structured inputs card, even while the
                AI agent is still thinking. This gives the user something
                to do during the ~60s intake generation. */}
            <ProfileInputsCard inputs={inputs} onChange={setInputs} />

            {isLoading ? (
              <LoadingState status={intake?.status} />
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

            {/* When AI questions haven't arrived yet, expose a "skip the
                smart questions" submit so the user isn't held hostage by
                a slow intake agent. */}
            {isLoading && !intake?.questions?.length ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {submitError ? (
                  <span className="text-[12px] text-[var(--destructive)] sm:mr-auto">
                    {submitError}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-xl border border-border/50 bg-card/30 px-5 py-3 text-[14px] font-medium transition-[opacity,background-color] duration-200 hover:bg-card/60 disabled:opacity-60 disabled:cursor-not-allowed min-h-11"
                >
                  {submitting ? "Starting scan…" : "Skip and start scan"}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────

const LOADING_LINES = [
  "Reading your bio and top repos…",
  "Looking at your recent pull requests…",
  "Checking which orgs you're active in…",
  "Deciding what to ask you about…",
  "Almost there — polishing the questions…",
];

function LoadingState({ status }: { status?: IntakeView["status"] }) {
  const [elapsed, setElapsed] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      setElapsed(secs);
      setLineIndex(Math.min(LOADING_LINES.length - 1, Math.floor(secs / 12)));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const line = LOADING_LINES[lineIndex] ?? LOADING_LINES[0];
  const stuck = elapsed > 180;

  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-6 shadow-[var(--shadow-card)] gs-enter">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-2 w-2 rounded-full bg-[var(--primary)] gs-pulse shrink-0" />
          <span
            key={lineIndex}
            className="gs-shimmer text-[14px] truncate gs-fade"
          >
            {line}
          </span>
        </div>
        <span className="text-[11px] font-mono text-muted-foreground/70 shrink-0">
          {elapsed}s
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {status === "pending"
          ? "Starting the intake worker — usually 10-30s to boot."
          : "We're looking at your bio, top repos, and recent activity. This takes about a minute."}
      </p>
      {stuck ? (
        <div className="mt-4 rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/[0.04] p-3 text-[12px] leading-relaxed">
          <div className="font-medium mb-1">Taking longer than expected.</div>
          <p className="text-muted-foreground">
            The intake worker usually finishes in under a minute. If it stays
            stuck past 3 min, refresh and restart from your home page.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ProfileInputsCard({
  inputs,
  onChange,
}: {
  inputs: ProfileInputs;
  onChange: (next: ProfileInputs) => void;
}) {
  const set = <K extends keyof ProfileInputs>(key: K, value: ProfileInputs[K]) =>
    onChange({ ...inputs, [key]: value });

  const setBlog = (i: number, value: string) => {
    const next = [...inputs.blogUrls];
    next[i] = value;
    onChange({ ...inputs, blogUrls: next });
  };

  const addBlog = () => {
    if (inputs.blogUrls.length >= 5) return;
    onChange({ ...inputs, blogUrls: [...inputs.blogUrls, ""] });
  };

  const removeBlog = (i: number) => {
    const next = inputs.blogUrls.filter((_, j) => j !== i);
    onChange({
      ...inputs,
      blogUrls: next.length > 0 ? next : [""],
    });
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-5 sm:p-6 shadow-[var(--shadow-card)]">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        Links &amp; socials · optional
      </div>
      <h2 className="text-[15px] sm:text-[16px] font-medium leading-snug">
        Tell us where to look
      </h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        LinkedIn lets us build your work &amp; education sections. Blog URLs
        get imported verbatim into the portfolio.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <InputField
          label="LinkedIn URL"
          placeholder="https://www.linkedin.com/in/your-handle"
          value={inputs.linkedin}
          onChange={(v) => set("linkedin", v)}
        />
        <InputField
          label="Twitter / X handle or URL"
          placeholder="@yourhandle"
          value={inputs.twitter}
          onChange={(v) => set("twitter", v)}
        />
        <InputField
          label="Personal site"
          placeholder="https://you.dev"
          value={inputs.website}
          onChange={(v) => set("website", v)}
        />
        <InputField
          label="YouTube"
          placeholder="https://youtube.com/@yourhandle"
          value={inputs.youtube}
          onChange={(v) => set("youtube", v)}
        />
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <label className="text-[12px] text-foreground font-medium">
            Blog / article URLs <span className="text-muted-foreground">· up to 5</span>
          </label>
          {inputs.blogUrls.length < 5 ? (
            <button
              type="button"
              onClick={addBlog}
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              + Add another
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Paste Medium / dev.to / Substack / Hashnode / personal-site post
          URLs. We&apos;ll fetch and host them with a canonical link back.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {inputs.blogUrls.map((url, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setBlog(i, e.target.value)}
                placeholder={
                  i === 0
                    ? "https://medium.com/@you/my-best-post"
                    : "https://..."
                }
                className="flex-1 rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-11"
              />
              {inputs.blogUrls.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeBlog(i)}
                  aria-label={`Remove blog URL ${i + 1}`}
                  className="rounded-xl border border-border/40 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:border-border transition-colors min-h-11"
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InputField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-foreground font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-11"
      />
    </label>
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
