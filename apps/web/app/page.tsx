import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getSession } from "@/auth";
import { Logo } from "@/components/logo";

/**
 * Marketing landing page. Minimal — the product lives at /{handle}
 * and /app. Signed-in visitors see "Open dashboard" instead of the
 * sign-in CTA.
 */

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  const isSignedIn = !!session?.user?.id;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-16">
      <nav className="mb-24 flex items-center justify-between">
        <Logo href="/" size={28} />
        <div className="flex items-center gap-4">
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
        </div>
      </section>

      <footer className="mt-auto pt-24 text-xs text-muted-foreground">
        <span>We never store your source code. Just commit metadata.</span>
      </footer>
    </main>
  );
}
