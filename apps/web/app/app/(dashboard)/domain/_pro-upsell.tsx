import Link from "next/link";
import { Globe02Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/dashboard/icon";
import { cn } from "@/lib/utils";

/**
 * Free-tier paywall for /app/domain. Quiet, single CTA, matches the
 * rest of the dashboard's empty-state aesthetic. Doesn't try too hard
 * to sell — that's what /pricing is for.
 */
export function ProUpsell() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="flex flex-col items-center text-center">
        <div className="grid place-items-center size-12 rounded-2xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06] mb-6">
          <Icon icon={Globe02Icon} className="size-6 text-foreground/80" />
        </div>
        <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-balance">
          Connect your own domain.
        </h1>
        <p className="mt-3 max-w-md text-[13.5px] text-muted-foreground text-pretty leading-relaxed">
          Serve your portfolio from{" "}
          <span className="font-mono text-foreground">yatendra.com</span> or any
          subdomain you own. We provision SSL, route at the edge, and keep
          renewals automatic — included with Pro.
        </p>
        <Link
          href="/pricing"
          className={cn(
            "mt-7 inline-flex items-center gap-1.5 rounded-md px-4 h-9 text-[13px] font-medium",
            "bg-primary text-primary-foreground select-none",
            "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)]",
            "transition-[background-color,box-shadow,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            "hover:bg-primary/90 active:scale-[0.97] active:duration-[80ms]",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          Upgrade to Pro
          <Icon icon={ArrowRight01Icon} className="size-3.5" />
        </Link>
        <p className="mt-3 text-[11.5px] text-muted-foreground/80">
          One domain per account · cancel any time
        </p>
      </div>
    </div>
  );
}
