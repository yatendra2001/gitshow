"use client";

import { useState } from "react";

/**
 * Inline account-delete flow. Confirm + hit the /api/profile/delete
 * endpoint. On success we bounce to the landing page — the row is gone
 * server-side so /app would just redirect to signin anyway.
 *
 * Rewritten without the claim-era PrivacyDrawer; same semantics, less
 * UI weight.
 */
export function DeleteAccountHandler() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[11px] text-muted-foreground/80 hover:text-[var(--destructive)] transition-colors underline underline-offset-2"
      >
        Delete account
      </button>
    );
  }

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/profile/delete", { method: "POST" });
      if (!resp.ok) {
        setError("Couldn't delete — try again in a moment.");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-[var(--destructive)]">
          This wipes your profile and scans.
        </span>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="text-[var(--destructive)] underline underline-offset-2 disabled:opacity-60"
        >
          {busy ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-muted-foreground underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <span className="text-[11px] text-[var(--destructive)]">{error}</span>
      ) : null}
    </div>
  );
}
