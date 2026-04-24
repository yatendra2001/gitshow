import { Check } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { getProOrNull } from "@/lib/entitlements";
import { getSession } from "@/auth";
import { PlanButton } from "./_plan-button";

/**
 * /pricing — the paywall. Single plan (Pro), two cadences (monthly
 * and yearly at 40% off). Everyone hits this page:
 *
 *   - Landing-page CTAs point here.
 *   - First-time signed-in users who don't have Pro yet get funneled
 *     from /app → /pricing by the non-Pro showcase state.
 *   - The API 402 response surfaces this URL as `upgrade_url`.
 *
 * State matrix:
 *   signed out              → both CTAs bounce through /signin with a
 *                             callbackURL back to /pricing?plan=<slug>
 *   signed in, not Pro      → CTAs start Dodo checkout
 *   signed in, on Pro       → CTAs route to /app/billing ("You're in")
 */

export const dynamic = "force-dynamic";

const FEATURES = [
  "AI-generated portfolio from your GitHub",
  "Unlimited regenerations and edits",
  "Private + org repos",
  "Connect a custom domain",
  "Powerful analytics — see who viewed what",
  "Resume + PDF export",
  "Priority generation queue",
  "Email support",
];

export default async function PricingPage() {
  const session = await getSession();
  const pro = await getProOrNull();

  const mode: "signin" | "checkout" | "manage" = !session?.user?.id
    ? "signin"
    : pro
      ? "manage"
      : "checkout";

  const primaryLabel =
    mode === "manage"
      ? "Manage in billing"
      : mode === "signin"
        ? "Sign in & subscribe"
        : "Start annual — save 40%";

  const secondaryLabel =
    mode === "manage"
      ? "Manage in billing"
      : mode === "signin"
        ? "Sign in & subscribe"
        : "Start monthly";

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border/30 bg-background/80 px-4 backdrop-blur sm:px-6">
        <Logo href="/" size={24} />
        <div className="flex items-center gap-2 text-[12px]">
          {session?.user?.id ? (
            <Link
              href="/app"
              className="rounded-lg border border-border/60 bg-card/30 px-3 py-1.5 hover:bg-card/50"
            >
              Back to app
            </Link>
          ) : (
            <Link
              href="/signin"
              className="rounded-lg border border-border/60 bg-card/30 px-3 py-1.5 hover:bg-card/50"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <section className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-16">
        <div className="mb-10 max-w-xl">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
            Pricing
          </div>
          <h1 className="font-[var(--font-serif)] text-[40px] leading-tight mb-3">
            One plan. Two ways to pay.
          </h1>
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            $20 a month, or $12 a month billed annually — same features
            either way. The annual option just saves you 40%.
            {pro ? (
              <>
                {" "}
                <span className="text-foreground font-medium">
                  You&apos;re currently on Pro.
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Yearly first — it's the recommended option so it owns the
              eye line. The 40% off tag does most of the selling. */}
          <PlanCard
            name="Pro"
            cadence="Annual"
            price="$12"
            period="month"
            note="Billed $144 once a year. Save 40%."
            highlight
          >
            <PlanButton
              slug="pro-yearly"
              mode={mode}
              label={primaryLabel}
              variant="primary"
            />
          </PlanCard>

          <PlanCard
            name="Pro"
            cadence="Monthly"
            price="$20"
            period="month"
            note="Billed monthly. Cancel anytime."
          >
            <PlanButton
              slug="pro-monthly"
              mode={mode}
              label={secondaryLabel}
              variant="ghost"
            />
          </PlanCard>
        </div>

        <div className="mt-10 rounded-2xl border border-border/40 bg-card/30 p-6">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-3">
            Included in Pro
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[13px]">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--primary)]" />
                <span className="text-secondary-foreground">{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-8 text-[12px] text-muted-foreground">
          Cancellations take effect at the end of your current billing
          period. Your public profile at{" "}
          <span className="font-mono">gitshow.io/{"{handle}"}</span> stays
          live forever — even if you cancel, visitors can still see the
          portfolio you published.
        </p>
      </section>
    </main>
  );
}

function PlanCard({
  name,
  cadence,
  price,
  period,
  note,
  highlight,
  children,
}: {
  name: string;
  cadence: string;
  price: string;
  period: string;
  note: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-2xl border border-border/40 p-8 ${highlight ? "bg-accent/60" : "bg-card/30"}`}
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-xl font-medium">{name}</h4>
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {cadence}
          </span>
        </div>
        {highlight && (
          <span className="rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2.5 py-0.5 text-[11px] font-medium text-[var(--primary)]">
            Save 40%
          </span>
        )}
      </div>

      <div className="mt-8 mb-8 flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tracking-tight md:text-5xl">
            {price}
          </span>
          <span className="text-muted-foreground">/{period}</span>
        </div>
        <p className="text-sm text-muted-foreground">{note}</p>
      </div>

      {children}
    </div>
  );
}
