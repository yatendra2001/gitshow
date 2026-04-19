"use client";

import * as React from "react";
import { Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * TestResults — the hiring-manager evaluator's six-axis verdict
 * rendered as a test suite. Perfect fit: each axis is a test
 * (score 0–10, pass/fail/warn), `verdict` is suite status.
 */

export type TestStatus = "pass" | "fail" | "warn";

export interface TestResult {
  name: string;
  status: TestStatus;
  score?: number;
  maxScore?: number;
  message?: string;
}

export function TestResults({
  title,
  verdict,
  overallScore,
  tests,
  className,
  ...props
}: {
  title: string;
  verdict: "PASS" | "REVISE" | "BLOCK" | null;
  overallScore?: number;
  tests: TestResult[];
} & React.HTMLAttributes<HTMLDivElement>) {
  const passed = tests.filter((t) => t.status === "pass").length;
  const total = tests.length;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3",
        verdict === "PASS" &&
          "border-emerald-500/40 bg-emerald-500/5",
        verdict === "REVISE" &&
          "border-amber-500/40 bg-amber-500/5",
        verdict === "BLOCK" &&
          "border-red-500/40 bg-red-500/5",
        className,
      )}
      {...props}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">{title}</div>
          {verdict && <VerdictBadge verdict={verdict} />}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {passed}/{total} passed
          {overallScore !== undefined && ` · ${overallScore}/100`}
        </div>
      </div>
      <ul className="space-y-1">
        {tests.map((t, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 font-mono text-[11px]"
          >
            <StatusIcon status={t.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">{t.name}</span>
                {t.score !== undefined && t.maxScore !== undefined && (
                  <span className="shrink-0 text-muted-foreground">
                    {t.score}/{t.maxScore}
                  </span>
                )}
              </div>
              {t.message && (
                <div className="mt-0.5 text-muted-foreground">{t.message}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: TestStatus }) {
  if (status === "pass")
    return (
      <div className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check className="size-2" strokeWidth={3} />
      </div>
    );
  if (status === "warn")
    return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />;
  return (
    <div className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
      <X className="size-2" strokeWidth={3} />
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: "PASS" | "REVISE" | "BLOCK" }) {
  const colors: Record<"PASS" | "REVISE" | "BLOCK", string> = {
    PASS: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
    REVISE: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    BLOCK: "bg-red-500/10 text-red-700 border-red-500/30",
  };
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider",
        colors[verdict],
      )}
    >
      {verdict}
    </span>
  );
}
