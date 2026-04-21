"use client";

import { useState } from "react";

/**
 * Dashboard-level "Delete profile" action.
 *
 * Distinct from the account-level delete in the footer: this is an
 * explicit, primary-tier control so users who want to rebuild from
 * scratch can see it without hunting. Under the hood it calls the
 * same /api/profile/delete endpoint — that route already wipes
 * scans, claims, intake sessions, notifications, and the
 * user_profiles row. After success we send the user back to /app
 * where the EmptyState takes over.
 *
 * A two-tap confirm (same pattern as RefreshButton) gives a beat to
 * back out; no modal because the action is locally reversible (they
 * can just run another scan).
 */
export function DeleteProfileButton() {
  const [stage, setStage] = useState<"idle" | "confirming" | "deleting">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (stage === "idle") {
      setStage("confirming");
      setTimeout(() => {
        setStage((s) => (s === "confirming" ? "idle" : s));
      }, 4000);
      return;
    }
    if (stage !== "confirming") return;
    setStage("deleting");
    setError(null);
    try {
      const resp = await fetch("/api/profile/delete", { method: "POST" });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body.slice(0, 160));
      }
      window.location.href = "/app";
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
      setStage("idle");
    }
  };

  const label =
    stage === "confirming"
      ? "Tap again to delete"
      : stage === "deleting"
        ? "Deleting…"
        : "Delete profile";

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={stage === "deleting"}
        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[12px] min-h-9 transition-[color,border-color,background-color] duration-200 ${
          stage === "confirming"
            ? "border-[var(--destructive)] text-[var(--destructive)] bg-[var(--destructive)]/[0.04]"
            : "border-border/40 bg-card/60 text-muted-foreground hover:border-[var(--destructive)]/40 hover:text-[var(--destructive)]"
        } disabled:opacity-60`}
        aria-label="Delete profile and all scans"
      >
        <TrashIcon />
        {label}
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--destructive)]">{error}</span>
      ) : null}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
