"use client";

import { useState } from "react";

/**
 * StopButton — issues a soft stop on the running scan.
 *
 * Two-stage confirmation: first click flips to "Tap to confirm",
 * second click fires the POST. Prevents accidental mid-scan stops
 * during a 40-50 min session.
 *
 * The backend marks the scan `cancelled` immediately (optimistic UI)
 * even before the worker acks; if the worker was already past stage-N
 * the ack arrives within ~2s and a `control-ack` event renders in
 * the progress stream.
 */

type Status = "idle" | "confirming" | "sending" | "sent" | "error";

export function StopButton({
  scanId,
  onStopped,
  className = "",
}: {
  scanId: string;
  onStopped?: () => void;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");

  const onClick = async () => {
    if (status === "idle") {
      setStatus("confirming");
      // Auto-reset confirmation after a short window.
      setTimeout(() => {
        setStatus((s) => (s === "confirming" ? "idle" : s));
      }, 4000);
      return;
    }
    if (status !== "confirming") return;
    setStatus("sending");
    try {
      const resp = await fetch(
        `/api/scan/${encodeURIComponent(scanId)}/control`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop" }),
        },
      );
      if (!resp.ok) throw new Error(`http ${resp.status}`);
      setStatus("sent");
      onStopped?.();
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const label =
    status === "idle"
      ? "Stop"
      : status === "confirming"
        ? "Tap to confirm"
        : status === "sending"
          ? "Stopping…"
          : status === "sent"
            ? "Stopped"
            : "Try again";

  const variant =
    status === "confirming"
      ? "border-[var(--destructive)] text-[var(--destructive)]"
      : status === "error"
        ? "border-[var(--destructive)]/60 text-[var(--destructive)]"
        : "border-border/40 text-muted-foreground hover:text-foreground";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "sending" || status === "sent"}
      className={`inline-flex items-center gap-2 rounded-xl border bg-card/60 px-3 py-1.5 text-[12px] transition-[color,border-color,background-color,box-shadow] duration-200 hover:shadow-[var(--shadow-card)] disabled:opacity-60 disabled:cursor-not-allowed min-h-9 ${variant} ${className}`}
      aria-label={label}
    >
      <StopIcon />
      {label}
    </button>
  );
}

function StopIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="currentColor"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
