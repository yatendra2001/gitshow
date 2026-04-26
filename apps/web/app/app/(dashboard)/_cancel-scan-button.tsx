"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

/**
 * Cancel an in-flight scan from the dashboard "Working on it" state.
 *
 * Calls /api/scan/{scanId}/cancel which destroys the underlying Fly
 * Machine + marks the scan row 'cancelled' in D1. Modal-confirmed
 * because it kills any in-progress LLM work and the user can't
 * resume — they'd start a fresh scan.
 */
export function CancelScanButton({ scanId }: { scanId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`/api/scan/${scanId}/cancel`, {
        method: "POST",
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body.slice(0, 200) || `Cancel failed (${resp.status})`);
      }
      // Refresh so the dashboard re-evaluates which State to render.
      window.location.href = "/app";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl border border-border/40 bg-card/30 px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors min-h-11"
          aria-label="Cancel this scan"
        >
          <X className="size-3.5" />
          Cancel scan
        </button>
      </DialogTrigger>
      <DialogContent showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Cancel this scan?</DialogTitle>
          <DialogDescription>
            We&apos;ll stop the worker and discard everything in flight.
            You can start a fresh scan right after — but anything this
            run was about to find won&apos;t be saved.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-[12px] text-[var(--destructive)] bg-[var(--destructive)]/[0.06] rounded-lg p-2.5">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center rounded-xl border border-border/40 bg-card/30 px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors min-h-10 disabled:opacity-60"
            >
              Keep running
            </button>
          </DialogClose>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--destructive)] text-white px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-10 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? (
              "Cancelling…"
            ) : (
              <>
                <X className="size-3.5" />
                Cancel scan
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
