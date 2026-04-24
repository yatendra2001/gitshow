"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * Pricing-page CTA. Three behaviors folded into one button so the
 * server component doesn't have to branch on auth state in its markup:
 *
 *   - signed-out:      bounces through /signin with callbackURL back
 *                      to /pricing?plan=<slug>, so a sign-in completes
 *                      and lands the user on checkout in one motion.
 *   - signed-in + no:  calls the Better Auth Dodo plugin's checkout
 *                      endpoint and redirects to the hosted Dodo page.
 *   - signed-in + yes: sends them to /app/billing instead of making a
 *                      second subscription.
 */

type Mode = "signin" | "checkout" | "manage";

export function PlanButton({
  slug,
  mode,
  label,
  variant = "primary",
}: {
  slug: "pro-monthly" | "pro-yearly";
  mode: Mode;
  label: string;
  variant?: "primary" | "ghost";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    if (mode === "signin") {
      const callback = encodeURIComponent(`/pricing?plan=${slug}`);
      router.push(`/signin?callbackURL=${callback}`);
      return;
    }
    if (mode === "manage") {
      router.push("/app/billing");
      return;
    }
    startTransition(async () => {
      try {
        // The plugin proxies to the Dodo API server-side; `data.url` is
        // the hosted checkout link we need to land the user on.
        const result = (await (
          authClient as unknown as {
            dodopayments: {
              checkoutSession: (args: {
                slug: string;
              }) => Promise<{ data?: { url?: string } | null; error?: unknown }>;
            };
          }
        ).dodopayments.checkoutSession({ slug })) as {
          data?: { url?: string } | null;
          error?: { message?: string } | null;
        };
        if (result.error) {
          setError(
            result.error.message ?? "Couldn't start checkout. Try again.",
          );
          return;
        }
        const url = result.data?.url;
        if (!url) {
          setError("Checkout URL missing. Please reload and retry.");
          return;
        }
        window.location.href = url;
      } catch (e) {
        setError((e as Error).message || "Network error. Please retry.");
      }
    });
  };

  const base =
    "mt-auto w-full cursor-pointer rounded-full px-5 py-3 text-sm font-medium transition-all duration-300 ease-in-out min-h-11";
  const style =
    variant === "primary"
      ? "bg-foreground text-background hover:bg-foreground/90 hover:scale-[1.01]"
      : "bg-muted text-foreground hover:bg-muted/80";

  return (
    <div className="mt-auto flex w-full flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={`${base} ${style} disabled:opacity-60`}
      >
        {pending ? "Opening checkout…" : label}
      </button>
      {error && (
        <p className="text-[12px] text-[var(--destructive)]">{error}</p>
      )}
    </div>
  );
}
