"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Admin action buttons for the user detail + scan log pages.
 *
 * All buttons share the same affordance: optimistic spinner, single
 * native confirm() prompt for the destructive ones (rerun + force-fail
 * + reap), error toast inline as text below the button. After a
 * successful POST we `router.refresh()` so the server-rendered list
 * picks up the new state without a full reload.
 */

type ActionState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; message: string }
  | { kind: "err"; message: string };

interface AdminActionButtonProps {
  endpoint: string;
  label: string;
  busyLabel: string;
  /** Shown in the native confirm() dialog; skip to disable confirmation. */
  confirmText?: string;
  variant?: "primary" | "ghost" | "danger";
  /**
   * Friendly result message extracted from the API JSON response.
   * Defaults to "Done." Pass a custom resolver if the endpoint returns
   * a useful detail (e.g. new scan id).
   */
  successMessage?: (json: unknown) => string;
}

export function AdminActionButton({
  endpoint,
  label,
  busyLabel,
  confirmText,
  variant = "ghost",
  successMessage,
}: AdminActionButtonProps) {
  const [state, setState] = React.useState<ActionState>({ kind: "idle" });
  const router = useRouter();

  const onClick = async () => {
    if (state.kind === "busy") return;
    if (confirmText && !window.confirm(confirmText)) return;
    setState({ kind: "busy" });
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const ct = resp.headers.get("content-type") ?? "";
      const json = ct.includes("application/json")
        ? ((await resp.json()) as unknown)
        : null;
      if (!resp.ok) {
        const msg =
          (json as { error?: string; detail?: string } | null)?.detail ??
          (json as { error?: string } | null)?.error ??
          `${resp.status} ${resp.statusText}`;
        setState({ kind: "err", message: msg });
        return;
      }
      setState({
        kind: "ok",
        message: successMessage ? successMessage(json) : "Done.",
      });
      // Bring the server data back into sync with the new state.
      router.refresh();
    } catch (err) {
      setState({
        kind: "err",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const busy = state.kind === "busy";

  return (
    <span className="inline-flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={cn(
          "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3",
          "text-[12.5px] font-medium",
          "transition-[background-color,border-color,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          "active:scale-[0.97] active:duration-[80ms]",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          "disabled:opacity-60 disabled:cursor-progress",
          variant === "primary" &&
            "bg-foreground text-background hover:opacity-90",
          variant === "ghost" &&
            "border border-border/50 bg-card/60 text-foreground hover:bg-card hover:border-border/70",
          variant === "danger" &&
            "border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/15",
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {busy ? busyLabel : label}
      </button>
      {state.kind === "ok" ? (
        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 px-1">
          {state.message}
        </span>
      ) : null}
      {state.kind === "err" ? (
        <span className="text-[11px] text-rose-600 dark:text-rose-400 px-1 max-w-[280px] break-words">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
