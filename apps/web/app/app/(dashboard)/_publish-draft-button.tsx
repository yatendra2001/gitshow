"use client";

import { useState } from "react";

/**
 * Promotes `resumes/{handle}/draft.json` → `published.json` by hitting
 * `/api/profile/publish-resume`. On success we just reload so the
 * server-side /app page re-renders into the "Published" state.
 */
export function PublishDraftButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/profile/publish-resume", {
        method: "POST",
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        setError(err.error ?? "Couldn't publish — try again.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center justify-center rounded-xl border border-foreground/20 bg-card/60 px-4 py-2 text-[13px] font-medium transition-colors hover:bg-card disabled:opacity-60 disabled:cursor-not-allowed min-h-11"
      >
        {busy ? "Publishing…" : "Publish"}
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--destructive)]">{error}</span>
      ) : null}
    </div>
  );
}
