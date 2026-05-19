import Link from "next/link";
import { ArrowRight, Github, Sparkles } from "lucide-react";
import { FlickeringGrid } from "@/components/magicui/flickering-grid";
import { CornerPlus } from "@/components/marketing/ui/corner-plus";
import { HeaderBadge } from "@/components/marketing/header-badge";
import { Logo, LogoMark } from "@/components/logo";

/* eslint-disable @next/next/no-img-element */

/**
 * Rendered at `/{handle}` when no portfolio exists there yet — the
 * growth surface, not a dead 404. Every `gitshow.io/{anyGitHubUser}`
 * is a live, shareable, GitHub-templated pitch: "change github.com/you
 * to gitshow.io/you".
 *
 * Premium treatment matches the public hero / 404 hero: a masked
 * FlickeringGrid + the brand cyan→blue radial glow, CornerPlus
 * framing, a HeaderBadge, serif display type, and gs-enter staggered
 * reveals. The centrepiece is the URL "upgrade" rendered on its own
 * flickering-grid panel.
 *
 * Generation always runs against the *signed-in* user's own GitHub,
 * so the CTA just routes to `/signin`; the visited handle is
 * persuasion, not an input. `noindex` is set in the layout's
 * generateMetadata so Google never gets fed infinite thin pages.
 *
 * Server component on purpose (FlickeringGrid is the only client
 * island) — keeps it fast and lets gs-enter run as pure CSS.
 */
export function ProfileClaim({ handle }: { handle: string }) {
  const avatar = `https://github.com/${encodeURIComponent(handle)}.png?size=240`;

  return (
    <main className="relative min-h-svh overflow-hidden bg-background text-foreground">
      {/* Flickering grid, faded toward the centre so it never fights
          the copy — same recipe as the 404 hero. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_75%_60%_at_center,black_35%,transparent_88%)]"
      >
        <FlickeringGrid
          className="size-full"
          squareSize={4}
          gridGap={6}
          flickerChance={0.2}
          maxOpacity={0.18}
        />
      </div>
      {/* Brand glow — the cyan→blue radial from the landing hero, but
          dialled down and seated low so the bloom sits BELOW the copy.
          The earlier version centred the hot zone behind the body text,
          washing out secondary copy against the teal. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 bg-radial-[at_50%_92%] from-[#2CD5FF]/20 via-[#2C30FF]/3 to-transparent mask-[linear-gradient(to_bottom,transparent,black_70%,transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 bg-radial-[at_50%_98%] from-[#2CD5FF]/22 via-[#2C30FF]/2 to-transparent blur-[70px]"
      />

      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-3xl flex-col px-5 py-7 sm:px-6">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            aria-label="gitshow home"
            className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-1 py-1 pr-2.5 text-[12px] text-foreground/70 backdrop-blur transition-colors hover:text-foreground"
          >
            <LogoMark size={18} />
            <span>gitshow.io</span>
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/55">
            Unclaimed handle
          </span>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-12 text-center">
          <div
            className="gs-enter"
            style={{ animationDelay: "0ms", animationDuration: "550ms" }}
          >
            <HeaderBadge
              icon={<Sparkles className="size-4 text-[var(--primary)]" />}
              text="Free · live in 20 minutes"
            />
          </div>

          {/* The URL upgrade — the hero moment, on its own flickering
              grid panel with the avatar breaking the top edge. */}
          <div
            className="gs-enter relative mt-10 w-full max-w-md"
            style={{ animationDelay: "90ms", animationDuration: "600ms" }}
          >
            <span
              className="absolute -top-9 left-1/2 z-20 size-[72px] -translate-x-1/2 overflow-hidden rounded-full border border-border/60 bg-card shadow-[0_8px_30px_-8px_oklch(0_0_0_/_0.35)]"
              aria-hidden
            >
              <img
                src={avatar}
                alt=""
                width={72}
                height={72}
                className="size-full object-cover"
              />
            </span>

            <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-background/50 px-6 pb-7 pt-12 backdrop-blur-sm">
              <CornerPlus position="all" className="text-foreground/30" />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_80%_at_50%_50%,black_10%,transparent_75%)]"
              >
                <FlickeringGrid
                  className="size-full"
                  squareSize={3}
                  gridGap={5}
                  flickerChance={0.28}
                  maxOpacity={0.16}
                  color="var(--gradient-primary)"
                />
              </div>

              <div className="relative flex flex-col items-center gap-2.5">
                <span className="font-mono text-[13px] text-foreground/55 line-through decoration-foreground/30">
                  github.com/{handle}
                </span>
                <ArrowRight className="size-4 rotate-90 text-[var(--primary)]" />
                <span className="font-mono text-[15px] font-semibold tracking-tight text-foreground sm:text-[17px]">
                  gitshow.io/<span className="text-[var(--primary)]">{handle}</span>
                </span>
              </div>
            </div>
          </div>

          <h1
            className="gs-enter mt-9 max-w-2xl text-balance font-[var(--font-serif)] text-[clamp(30px,6vw,52px)] leading-[1.05] tracking-tight"
            style={{ animationDelay: "170ms", animationDuration: "600ms" }}
          >
            {handle}, this is your portfolio.
          </h1>
          <p
            className="gs-enter mt-4 max-w-lg text-balance text-[15px] leading-relaxed text-foreground/80"
            style={{ animationDelay: "240ms", animationDuration: "600ms" }}
          >
            gitshow reads your GitHub — repos, commits, pull requests,
            the actual source — and writes you a portfolio site. Free to
            publish. It just isn&apos;t live yet.
          </p>

          <div
            className="gs-enter mt-8 flex flex-col items-center gap-3 sm:flex-row"
            style={{ animationDelay: "320ms", animationDuration: "600ms" }}
          >
            <Link
              href="/signin"
              className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-foreground px-7 py-3 text-[14px] font-medium text-background select-none shadow-[inset_0_1px_0_rgb(255_255_255_/_0.12),0_2px_12px_-4px_oklch(0_0_0_/_0.3)] transition-[box-shadow,transform] duration-[160ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.16),0_6px_20px_-6px_oklch(0_0_0_/_0.38)] active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Github className="size-4" />
              Generate mine with GitHub
            </Link>
            <Link
              href="/yatendra2001"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-border/60 bg-background/40 px-7 py-3 text-[14px] font-medium backdrop-blur-sm select-none transition-[background-color,border-color,transform] duration-[160ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] hover:border-foreground/25 hover:bg-background/70 active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              See a live example
            </Link>
          </div>

          <p
            className="gs-enter mt-6 max-w-md text-[12px] leading-relaxed text-foreground/65"
            style={{ animationDelay: "400ms", animationDuration: "600ms" }}
          >
            Sign in scans <span className="font-medium">your own</span>{" "}
            GitHub. Free publishes a live page with a small gitshow
            badge —{" "}
            <Link
              href="/pricing"
              className="underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
            >
              Pro
            </Link>{" "}
            adds a custom domain, analytics, and the PDF resume.
          </p>
        </section>

        <footer className="flex items-center justify-between text-[11px] text-foreground/45">
          <span className="font-mono">status 200 · unclaimed</span>
          <Logo size={18} markOnly />
        </footer>
      </div>
    </main>
  );
}
