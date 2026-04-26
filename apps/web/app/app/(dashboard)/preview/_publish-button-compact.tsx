"use client";

import { useState } from "react";

/**
 * Banner-height publish button for /app/preview's top bar.
 *
 * Same POST /api/profile/publish-resume target as the dashboard's
 * PublishDraftButton, but sized to fit inside the 40px sticky preview
 * banner (no min-h-11 / vertical chrome). When already-published, the
 * label flips to "Republish" so the user can refresh the live page
 * with the latest draft.
 */
export function PreviewPublishButton({ isPublished }: { isPublished: boolean }) {
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
        setError(err.error ?? "Couldn't publish");
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span className="text-[11px] text-[var(--destructive)]">{error}</span>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex h-7 items-center rounded-md bg-foreground px-3 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? (isPublished ? "Republishing…" : "Publishing…") : isPublished ? "Republish" : "Publish"}
      </button>
    </div>
  );
}
