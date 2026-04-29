"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Client-side poller for the post-checkout window. Dodo redirects to
 * /app?checkout=success the instant the checkout session resolves, but
 * `subscription.active` fires via webhook — usually within seconds,
 * occasionally longer (3DS confirmations, bank holds).
 *
 * Cadence:
 *   - Every 5s we router.refresh() the server component, which re-reads
 *     the subscription table. Once the webhook lands the page swaps to
 *     the real Pro dashboard.
 *   - At 40s we add a soft "taking longer than usual" hint while still
 *     polling — covers the slow-but-eventual case.
 *   - At 90s we stop polling and replace the whole panel with a
 *     "Checkout didn't complete" CTA. This protects against any
 *     processor-side stall (rail issues, abandoned 3DS, dropped
 *     webhook) leaving the customer on an indefinite spinner.
 *
 * The headline + body live here (not in the parent server component)
 * because they need to swap based on `stalled`, and lifting state to a
 * "use client" wrapper would force the rest of the dashboard-states
 * file to opt into client rendering.
 */

const TICK_MS = 5000;
const SOFT_HINT_AFTER_TICKS = 8; // 40s
const HARD_STOP_AFTER_TICKS = 18; // 90s

export function CheckoutProcessingAutoRefresh() {
  const router = useRouter();
  const [ticks, setTicks] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTicks((t) => t + 1);
      router.refresh();
    }, TICK_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [router]);

  useEffect(() => {
    if (ticks >= HARD_STOP_AFTER_TICKS && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [ticks]);

  const stalled = ticks >= HARD_STOP_AFTER_TICKS;
  const slow = !stalled && ticks >= SOFT_HINT_AFTER_TICKS;

  if (stalled) {
    return (
      <div className="gs-enter">
        <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
          Checkout didn&apos;t complete
        </h1>
        <p className="text-[14px] leading-relaxed text-muted-foreground mb-5">
          We didn&apos;t hear back from the payment processor in time. If your
          card was charged we&apos;ll detect it on retry and skip a second
          payment — otherwise you can safely try again.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/pricing"
            className="rounded-full bg-foreground text-background px-4 py-2 text-[13px] font-medium transition-all duration-300 hover:bg-foreground/90 hover:scale-[1.01]"
          >
            Try again
          </Link>
          <a
            href="mailto:yatendra@gitshow.io"
            className="rounded-full border border-border/40 px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted/40"
          >
            Email support
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        Finishing your subscription…
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-2">
        Thanks for signing up. We&apos;re waiting on the final confirmation
        from the payment processor. Your dashboard will unlock automatically —
        no need to refresh.
      </p>
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
    </>
  );
}
