import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getSession } from "@/auth";

/**
 * Marketing landing page. Intentionally minimal — the product is the
 * Claude-style builder at /s/[scanId]. First-time visitors hit /s/demo
 * to see a real profile rendered from session-4's R2 data with no login.
 *
 * Signed-in visitors see "Open dashboard" instead of "Sign in with
 * GitHub" / "Generate your profile" — bouncing back through the sign-in
 * flow when you already have a session is confusing.
 */

// Reading cookies via getSession forces this per-request anyway, but
// set it explicitly so the build output doesn't ever prerender a
// stale signed-out version.
export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  const isSignedIn = !!session?.user?.id;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-16">
      <nav className="mb-24 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground font-mono text-xs font-bold text-background">
            g
          </div>
          <span className="text-sm font-bold tracking-tight">
            gitshow<span className="text-muted-foreground">.io</span>
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/s/demo"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View the demo
          </Link>
          {isSignedIn ? (
            <Link
              href="/app"
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
            >
              Open dashboard
            </Link>
          ) : (
            <Link
              href="/signin"
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
            >
              Sign in with GitHub
            </Link>
          )}
        </div>
      </nav>

      <section className="space-y-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Portfolios backed by every commit
        </p>
        <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.015em]">
          Stop rewriting your resume. Your git history already told the story —
          GitShow reads it and writes the profile.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          Hand over your GitHub handle. GitShow runs a 20-minute AI pipeline
          over the last few years of your commits, PRs, and reviews — then
          hands you a hiring-manager-grade portfolio where every claim links
          to the commit that earned it.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-4">
          <Link
            href={isSignedIn ? "/app" : "/signin"}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90"
          >
            {isSignedIn ? "Open your dashboard" : "Generate your profile"}
            <ArrowUpRight className="size-4" />
          </Link>
          <Link
            href="/s/demo"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            See a real profile (demo)
          </Link>
        </div>
      </section>

      <footer className="mt-auto pt-24 text-xs text-muted-foreground">
        <span>We never store your source code. Just commit metadata.</span>
      </footer>
    </main>
  );
}
