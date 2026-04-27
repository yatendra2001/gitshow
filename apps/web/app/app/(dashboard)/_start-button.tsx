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
  label = "Get started",
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
        className={
          // Premium primary CTA: inset highlight reads as "raised",
          // 80ms press scale, focus ring keyboard-only. No hover lift
          // because pressed state already implies depth.
          "group relative inline-flex items-center justify-center min-h-11 rounded-xl bg-foreground text-background px-5 py-3 text-[14px] font-medium select-none " +
          "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)] " +
          "transition-[background-color,box-shadow,transform,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] " +
          "hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(0_0_0_/_0.24)] " +
          "active:scale-[0.97] active:duration-[80ms] " +
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
          "disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
        }
      >
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="size-3 rounded-full border-[1.5px] border-background/40 border-t-background animate-spin"
            />
            <span className="tabular">Starting…</span>
          </span>
        ) : (
          label
        )}
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--destructive)]">{error}</span>
      ) : null}
    </div>
  );
}
