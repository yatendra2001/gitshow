import { LogoMark } from "@/components/logo";

/**
 * The viral loop. Every free portfolio is a billboard: a small,
 * unobtrusive "Built with gitshow" pill fixed bottom-left, linking
 * back to the marketing site. This is the single cheapest growth
 * lever GitShow has — the public-page badge that took Linktree from
 * zero to millions of users with no paid spend.
 *
 * Only rendered for free (non-Pro) owners — removing it is a Pro
 * perk (see app/[handle]/layout.tsx). It's bottom-LEFT so it never
 * collides with the ShareButton (fixed top-right) and stays clear of
 * most templates' content column.
 *
 * Absolute URL on purpose: on a customer's custom domain the loop
 * must still point at gitshow.io, not the customer's own root.
 */

const BASE = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io"
).replace(/\/+$/, "");

export function BuiltWithGitShow() {
  const href = `${BASE}/?utm_source=portfolio_badge&utm_medium=referral&utm_campaign=built_with`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      aria-label="Built with gitshow — create your own developer portfolio"
      className="group fixed bottom-4 left-4 z-40 inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background/70 py-1.5 pl-1.5 pr-3 text-[11.5px] font-medium text-muted-foreground shadow-[0_1px_2px_-1px_oklch(0_0_0_/_0.15)] backdrop-blur-md transition-[color,background-color,border-color,transform] duration-[160ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-px hover:border-foreground/25 hover:bg-background/90 hover:text-foreground active:translate-y-0 active:duration-[80ms]"
    >
      <LogoMark size={16} />
      <span>
        Built with{" "}
        <span className="font-semibold text-foreground/80 group-hover:text-foreground">
          gitshow
        </span>
      </span>
    </a>
  );
}
