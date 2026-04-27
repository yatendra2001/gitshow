import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { getSubscription, isActive } from "@/lib/entitlements";
import { PortalButton } from "./_portal-button";

/**
 * /app/billing — always-accessible billing page.
 *
 * Per plan: this route is EXEMPT from the Pro gate so cancelled users
 * can always walk in and re-subscribe (or confirm their cancellation
 * went through). The middleware allow-list enforces that exemption.
 *
 * Surface is intentionally tiny:
 *   - Plan name + cadence + renewal date
 *   - Status chip (Active / Cancels on … / On hold)
 *   - "Manage subscription" → Dodo portal (handles the real ops)
 *   - If no sub at all: "You're not on a plan" → link to /pricing
 */

export const dynamic = "force-dynamic";

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatAmount(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const dollars = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return `${currency === "USD" ? "$" : currency ?? ""}${dollars}`;
}

export default async function BillingPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/signin?callbackURL=/app/billing");
  const userId = session.user.id;

  const { env } = await getCloudflareContext({ async: true });
  const sub = await getSubscription(env.DB, userId);
  const active = isActive(sub);

  const planLabel =
    sub?.interval === "Year"
      ? "Pro Annual"
      : sub?.interval === "Month"
        ? "Pro Monthly"
        : sub
          ? "Pro"
          : null;

  const statusLabel = !sub
    ? "No plan"
    : sub.status === "cancelled" && sub.current_period_end > Date.now()
      ? `Cancels on ${formatDate(sub.current_period_end)}`
      : sub.status === "on_hold"
        ? "Payment on hold"
        : sub.status === "expired"
          ? "Expired"
          : sub.status === "active"
            ? "Active"
            : sub.status;

  const statusColor =
    !sub || sub.status === "expired"
      ? "bg-muted-foreground/40"
      : sub.status === "cancelled"
        ? "bg-amber-500"
        : sub.status === "on_hold"
          ? "bg-[var(--destructive)]"
          : "bg-emerald-500";

  return (
    <div className="mx-auto w-full max-w-3xl">
      <section className="px-4 sm:px-6 lg:px-8 py-10">
        <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
          Plan
        </div>
        <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-6">
          {sub ? "Your subscription" : "You're not on a plan"}
        </h1>

        {sub ? (
          <div className="rounded-2xl border border-border/40 bg-card/30 p-6">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <div className="text-[18px] font-medium">{planLabel}</div>
                <div className="mt-1 inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
                  <span>{statusLabel}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[18px] font-medium tabular-nums">
                  {formatAmount(sub.amount_cents, sub.currency)}
                  <span className="text-muted-foreground text-[12px] font-normal">
                    {" "}
                    /{" "}
                    {sub.interval === "Year"
                      ? "year"
                      : sub.interval === "Month"
                        ? "month"
                        : "cycle"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-border/30 pt-4 flex flex-col gap-1 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {sub.status === "cancelled" ? "Access ends" : "Next renewal"}
                </span>
                <span className="font-medium">
                  {formatDate(sub.current_period_end)}
                </span>
              </div>
              {sub.status === "on_hold" ? (
                <p className="mt-2 text-[12px] text-[var(--destructive)]">
                  The last renewal charge failed. Dodo will retry for a few
                  days. Open the portal to update your card.
                </p>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <PortalButton label="Manage subscription" variant="primary" />
              {!active ? (
                <Link
                  href="/pricing"
                  className="inline-flex items-center justify-center min-h-11 rounded-xl border border-border/60 bg-card/30 px-4 py-2 text-[13px] font-medium select-none transition-[background-color,border-color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-card/50 hover:border-foreground/25 active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Re-subscribe
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/40 bg-card/30 p-6">
            <p className="text-[14px] leading-relaxed text-muted-foreground mb-5">
              GitShow runs on a single Pro plan — $20/month, or $12/month
              billed annually. Pick a cadence and you&apos;ll be able to run
              your first scan within minutes.
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center min-h-11 rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium select-none shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)] transition-[background-color,box-shadow,transform,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(0_0_0_/_0.24)] active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              See pricing →
            </Link>
          </div>
        )}

        {sub ? (
          <p className="mt-8 text-[12px] text-muted-foreground">
            Cancellations take effect at the end of your current billing
            period. Your public profile stays live forever — we just stop
            letting you regenerate or edit it.
          </p>
        ) : null}
      </section>
    </div>
  );
}
