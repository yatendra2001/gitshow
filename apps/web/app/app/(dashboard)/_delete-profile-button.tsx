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
          className={
            "inline-flex items-center gap-2 min-h-10 rounded-xl border border-[var(--destructive)]/40 bg-[var(--destructive)]/[0.06] px-3 py-2 text-[13px] text-[var(--destructive)] select-none " +
            "transition-[background-color,border-color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] " +
            "hover:bg-[var(--destructive)]/[0.12] hover:border-[var(--destructive)]/60 " +
            "active:scale-[0.97] active:duration-[80ms] " +
            "outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          }
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
              className={
                "inline-flex items-center min-h-10 rounded-xl border border-border/40 bg-card/30 px-4 py-2 text-[13px] text-muted-foreground select-none " +
                "transition-[background-color,border-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] " +
                "hover:text-foreground hover:bg-card/50 hover:border-foreground/20 " +
                "active:scale-[0.97] active:duration-[80ms] " +
                "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
                "disabled:opacity-60 disabled:active:scale-100"
              }
            >
              Cancel
            </button>
          </DialogClose>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              "inline-flex items-center gap-2 min-h-10 rounded-xl bg-[var(--destructive)] text-white px-4 py-2 text-[13px] font-medium select-none " +
              "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)] " +
              "transition-[background-color,box-shadow,transform,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] " +
              "hover:bg-[var(--destructive)]/90 hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(from_var(--destructive)_l_c_h_/_0.40)] " +
              "active:scale-[0.97] active:duration-[80ms] " +
              "outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
              "disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
            }
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="size-3 rounded-full border-[1.5px] border-white/40 border-t-white animate-spin" />
                <span className="tabular">Deleting…</span>
              </span>
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
