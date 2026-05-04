"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
 * Resume editor "Delete resume" action.
 *
 * Calls DELETE /api/resume/doc which wipes the printable ResumeDoc
 * so the user lands back on the empty state and can regenerate from
 * their portfolio. The portfolio + public page are untouched — for
 * those, the dashboard's "Delete profile" is the right tool.
 *
 * On success we router.refresh() so the page server component re-runs,
 * sees the missing doc, and swaps in <ResumeEmpty> with the
 * "Generate resume" CTA.
 *
 * Modal-gated because the action drops every hand-edit the user has
 * made in the editor — bullets, ordering, hidden sections, the lot.
 */
export function DeleteResumeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/resume/doc", { method: "DELETE" });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body.slice(0, 160) || "Delete failed");
      }
      setOpen(false);
      router.refresh();
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
          className={
            "inline-flex items-center gap-2 min-h-10 rounded-xl border border-[var(--destructive)]/40 bg-[var(--destructive)]/[0.06] px-3 py-2 text-[13px] text-[var(--destructive)] select-none " +
            "transition-[background-color,border-color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] " +
            "hover:bg-[var(--destructive)]/[0.12] hover:border-[var(--destructive)]/60 " +
            "active:scale-[0.97] active:duration-[80ms] " +
            "outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          }
          aria-label="Delete resume and regenerate"
        >
          <Trash2 className="size-3.5" />
          Delete resume
        </button>
      </DialogTrigger>
      <DialogContent showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Delete your resume?</DialogTitle>
          <DialogDescription>
            This wipes the current resume and every edit you&apos;ve made
            in the editor. Your portfolio stays intact — you&apos;ll land
            on the &ldquo;Generate resume&rdquo; screen and can build a
            fresh one from it.
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
                Delete resume
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
