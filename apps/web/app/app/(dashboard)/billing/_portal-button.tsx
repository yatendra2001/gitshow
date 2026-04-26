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
    "inline-flex items-center justify-center rounded-xl px-4 py-2 text-[13px] font-medium transition-all min-h-11";
  const style =
    variant === "primary"
      ? "bg-foreground text-background hover:opacity-90"
      : "border border-border/60 bg-card/30 hover:bg-card/50";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={`${base} ${style} disabled:opacity-60`}
      >
        {pending ? "Opening…" : label}
      </button>
      {error && (
        <p className="text-[12px] text-[var(--destructive)]">{error}</p>
      )}
    </div>
  );
}
