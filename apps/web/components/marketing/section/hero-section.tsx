import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { siteConfig } from "@/lib/marketing-config";
import { AuthCta } from "@/components/marketing/auth-cta";
import { Button } from "@/components/marketing/ui/button";
import { CornerPlus } from "@/components/marketing/ui/corner-plus";
import { HeaderBadge } from "@/components/marketing/header-badge";

/**
 * Marketing hero — staged reveal of badge, title, description, CTAs.
 *
 * CSS-only motion via the .gs-enter utility (defined in
 * globals.css). Each element fades + 4px slide-up with the
 * shared --ease-out-cubic curve, staggered by inline animation
 * delays. No JS at all — keeps the hero a pure server component
 * and avoids motion/react hydration races.
 *
 * Total reveal time: 0 → 480ms.
 */
export function HeroSection() {
  const { hero } = siteConfig;

  return (
    <section
      id="hero"
      className="relative flex flex-col items-center justify-center px-4 py-16 md:py-24"
    >
      <CornerPlus position="bottom-left" className="text-muted-foreground/50" />
      <CornerPlus position="bottom-right" className="text-muted-foreground/50" />
      <div className="absolute inset-0 -z-1 h-full w-full bg-radial-[at_45%_85%] from-[#2CD5FF]/40 via-[#2C30FF]/4 mask-[linear-gradient(to_bottom,transparent,black_100%)]" />
      <div className="absolute inset-0 -z-1 h-full w-full bg-radial-[at_45%_68%] from-[#2CD5FF]/68 via-[#2C30FF]/3 mask-[linear-gradient(to_bottom,transparent,black_100%)] blur-[50px]" />
      <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-6 max-w-4xl mx-auto">
        <div className="gs-enter max-[350px]:hidden" style={{ animationDelay: "0ms", animationDuration: "550ms" }}>
          <HeaderBadge icon={hero.badgeIcon} text={hero.badge} />
        </div>
        <h1
          className="gs-enter text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tighter text-balance"
          style={{ animationDelay: "80ms", animationDuration: "550ms" }}
        >
          {hero.title}
        </h1>
        <p
          className="gs-enter text-secondary-foreground/70 text-center text-balance text-lg max-w-2xl mx-auto"
          style={{ animationDelay: "160ms", animationDuration: "550ms" }}
        >
          {hero.description}
        </p>
        <div
          className="gs-enter flex flex-col items-center justify-center gap-3 pt-1 sm:flex-row"
          style={{ animationDelay: "240ms", animationDuration: "550ms" }}
        >
          <AuthCta variant="pill" />
          <Button
            asChild
            size="lg"
            variant="outline"
            className="group rounded-full border-border bg-background/40 px-8 py-6 text-base font-medium text-foreground backdrop-blur-sm hover:bg-background/80 hover:text-foreground"
          >
            <Link href={hero.demo.href}>
              {hero.demo.label}
              <ArrowUpRight className="size-4 transition-transform duration-[200ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] group-hover:-translate-y-px group-hover:translate-x-px" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
