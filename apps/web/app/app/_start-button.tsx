"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Kicks off /api/intake with the user's GitHub handle (captured
 * server-side from the session, passed down). Redirects to the intake
 * page once the Fly machine is spawned.
 */
export function StartFirstScanButton({
  handle,
  label = "Start the 60-second intake",
}: {
  handle: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      if (!resp.ok) {
        const e = (await resp.json().catch(() => ({}))) as { error?: string };
        setError(e.error ?? "couldn't start");
        return;
      }
      const data = (await resp.json()) as { intakeId: string };
      router.push(`/app/intake/${data.intakeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !handle}
        className="inline-flex items-center justify-center rounded-xl bg-foreground text-background px-5 py-3 text-[14px] font-medium shadow-[var(--shadow-card)] transition-opacity duration-200 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed min-h-11"
      >
        {busy ? "Starting…" : label}
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--destructive)]">{error}</span>
      ) : null}
    </div>
  );
}
