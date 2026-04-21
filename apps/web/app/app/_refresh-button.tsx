"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-scan button on the authed home. Enforces the 24h cooldown on
 * the server; this client-side UI just surfaces the friendly message
 * when the server rejects the request.
 */
export function RefreshButton() {
  const router = useRouter();
  const [status, setStatus] = useState<
    "idle" | "confirming" | "sending" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);

  const onClick = async () => {
    if (status === "idle") {
      setStatus("confirming");
      setTimeout(() => {
        setStatus((s) => (s === "confirming" ? "idle" : s));
      }, 4000);
      return;
    }
    if (status !== "confirming") return;
    setStatus("sending");
    setMessage(null);
    try {
      const resp = await fetch("/api/profile/refresh", { method: "POST" });
      if (resp.status === 429) {
        const data = (await resp.json().catch(() => ({}))) as {
          wait_minutes?: number;
        };
        setMessage(
          data.wait_minutes
            ? `Try again in ~${Math.max(1, data.wait_minutes)} min.`
            : "Please wait a bit before refreshing.",
        );
        setStatus("idle");
        return;
      }
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        setMessage(err.error ?? "couldn't refresh");
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
        return;
      }
      // /s/{scanId} was the claim-era live progress view; it was
      // removed with the rest of the claim UI. Bounce back to /app
      // which renders the "Reading your code" state while the new
      // scan is running.
      router.push("/app");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "network error");
      setStatus("error");
    }
  };

  const label =
    status === "confirming"
      ? "Tap to confirm refresh"
      : status === "sending"
        ? "Starting…"
        : status === "error"
          ? "Try again"
          : "Refresh";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={status === "sending"}
        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[12px] min-h-9 transition-[color,border-color,background-color] duration-200 ${
          status === "confirming"
            ? "border-[var(--primary)] text-foreground bg-card"
            : "border-border/40 bg-card/60 text-muted-foreground hover:text-foreground"
        }`}
      >
        <RefreshIcon />
        {label}
      </button>
      {message ? (
        <span className="text-[11px] text-muted-foreground">{message}</span>
      ) : null}
    </div>
  );
}

function RefreshIcon() {
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
      <path d="M21 12a9 9 0 0 1-15.49 6.3" />
      <path d="M21 3v6h-6" />
      <path d="M3 12a9 9 0 0 1 15.49-6.3" />
      <path d="M3 21v-6h6" />
    </svg>
  );
}
