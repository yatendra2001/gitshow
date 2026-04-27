"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Client-side poller for the post-checkout window. Dodo redirects to
 * /app?checkout=success the instant the checkout session resolves, but
 * `subscription.active` fires via webhook — usually within seconds,
 * occasionally longer (3DS confirmations, bank holds, test-mode INR
 * rail hiccups).
 *
 * We call router.refresh() every 5s to re-execute the server component
 * and re-read the subscription table. Once the webhook lands the page
 * will swap to the real Pro dashboard. After 40s of no-activation we
 * surface a "taking longer than usual" hint with retry + support links.
 */
export function CheckoutProcessingAutoRefresh() {
  const router = useRouter();
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTicks((t) => t + 1);
      router.refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [router]);

  const slow = ticks >= 8;

  return (
    <div className="mt-3 flex flex-col gap-3 text-[12px] text-muted-foreground">
      <div className="inline-flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[var(--primary)] gs-pulse" />
        <span>
          Checking with the payment processor… {ticks > 0 ? `(${ticks * 5}s)` : ""}
        </span>
      </div>
      {slow ? (
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 leading-relaxed">
          This is taking longer than usual. If your bank required extra
          confirmation it may still be processing. Keep this tab open, or{" "}
          <Link href="/pricing" className="text-foreground underline-offset-2 hover:underline">
            retry checkout
          </Link>
          {" "}— if the charge already succeeded we&apos;ll skip the
          second payment.{" "}
          <a
            href="mailto:yatendra@gitshow.io"
            className="text-foreground underline-offset-2 hover:underline"
          >
            Email support
          </a>{" "}
          if you&apos;re stuck.
        </div>
      ) : null}
    </div>
  );
}
