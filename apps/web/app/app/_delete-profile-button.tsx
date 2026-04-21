"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
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
 * Dashboard-level "Delete profile" action.
 *
 * Calls /api/profile/delete which wipes scans, claims, intake sessions,
 * notifications, and the user_profiles row. On success we bounce to
 * /app — the row is gone server-side, so middleware sends the user to
 * /signin if they were fully signed out, otherwise the EmptyState
 * takes over.
 *
 * Modal-gated because the action is destructive and irreversible for
 * the published page (re-running intake rebuilds a draft, but the
 * previously-live /{handle} goes blank the moment this fires).
 */
export function DeleteProfileButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/profile/delete", { method: "POST" });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body.slice(0, 160) || "Delete failed");
      }
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
        if (busy) return; // don't dismiss mid-delete
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--destructive)]/40 bg-[var(--destructive)]/[0.06] px-3 py-2 text-[13px] text-[var(--destructive)] hover:bg-[var(--destructive)]/[0.12] transition-colors min-h-10"
          aria-label="Delete profile and all scans"
        >
          <Trash2 className="size-3.5" />
          Delete profile
        </button>
      </DialogTrigger>
      <DialogContent showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Delete your profile?</DialogTitle>
          <DialogDescription>
            This wipes every scan, draft, and the live public page.
            You&apos;ll start over from intake. The action is immediate
            and can&apos;t be undone.
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
              Cancel
            </button>
          </DialogClose>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--destructive)] text-white px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-10 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? (
              "Deleting…"
            ) : (
              <>
                <Trash2 className="size-3.5" />
                Delete profile
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
