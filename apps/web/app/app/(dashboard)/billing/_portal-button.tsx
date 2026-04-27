"use client";

import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Opens the Dodo-hosted customer portal. All subscription management
 * (cancel, change plan, update card, download invoices) lives there —
 * we don't re-implement that surface, we just redirect into it.
 */
export function PortalButton({
  label = "Manage subscription",
  variant = "primary",
}: {
  label?: string;
  variant?: "primary" | "ghost";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = (await (
          authClient as unknown as {
            dodopayments: {
              customer: {
                portal: () => Promise<{
                  data?: { url?: string; redirect?: boolean } | null;
                  error?: { message?: string } | null;
                }>;
              };
            };
          }
        ).dodopayments.customer.portal()) as {
          data?: { url?: string; redirect?: boolean } | null;
          error?: { message?: string } | null;
        };
        if (result.error) {
          setError(
            result.error.message ?? "Couldn't open portal. Try again.",
          );
          return;
        }
        const url = result.data?.url;
        if (!url) {
          setError("Portal URL missing. Please reload and retry.");
          return;
        }
        window.location.href = url;
      } catch (e) {
        setError((e as Error).message || "Network error. Please retry.");
      }
    });
  };

  const base =
    "inline-flex items-center justify-center min-h-11 rounded-xl px-4 py-2 text-[13px] font-medium select-none " +
    "transition-[background-color,border-color,box-shadow,transform,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] " +
    "active:scale-[0.97] active:duration-[80ms] " +
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
    "disabled:opacity-60 disabled:active:scale-100";
  const style =
    variant === "primary"
      ? "bg-foreground text-background shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)] hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(0_0_0_/_0.24)]"
      : "border border-border/60 bg-card/30 hover:bg-card/50 hover:border-foreground/25";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={`${base} ${style}`}
      >
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className={`size-3 rounded-full border-[1.5px] ${variant === "primary" ? "border-background/40 border-t-background" : "border-foreground/30 border-t-foreground"} animate-spin`} />
            <span className="tabular">Opening…</span>
          </span>
        ) : (
          label
        )}
      </button>
      {error && (
        <p className="text-[12px] text-[var(--destructive)]">{error}</p>
      )}
    </div>
  );
}
