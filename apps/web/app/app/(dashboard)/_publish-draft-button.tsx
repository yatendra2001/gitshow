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
        className={
          "inline-flex items-center justify-center min-h-11 rounded-xl border border-foreground/20 bg-card/60 px-4 py-2 text-[13px] font-medium select-none " +
          "shadow-[0_1px_2px_-1px_oklch(0_0_0_/_0.06)] " +
          "transition-[background-color,border-color,box-shadow,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] " +
          "hover:bg-card hover:border-foreground/30 hover:shadow-[0_2px_8px_-3px_oklch(0_0_0_/_0.10)] " +
          "active:scale-[0.97] active:duration-[80ms] " +
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
          "disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
        }
      >
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="size-3 rounded-full border-[1.5px] border-foreground/30 border-t-foreground animate-spin" />
            <span className="tabular">Publishing…</span>
          </span>
        ) : (
          "Publish"
        )}
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--destructive)]">{error}</span>
      ) : null}
    </div>
  );
}
