import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Logo } from "@/components/logo";
import { loadPublishedResume } from "@/lib/resume-io";

/* eslint-disable @next/next/no-img-element */

/**
 * /developer-portfolio-examples — programmatic SEO + social proof.
 * Targets "developer portfolio examples" / "software engineer
 * portfolio examples" and links every real published profile, so the
 * gallery compounds as more users publish.
 *
 * Each card is a real generated portfolio (avatar, name, the AI's
 * one-line bio as a quasi-testimonial, tech, project count) — this
 * doubles as the testimonial wall. Content-rich (real UGC + prose),
 * which is what kept Rezi's programmatic SEO durable where Linktree's
 * thin pages collapsed post-Helpful-Content-Update.
 */

const BASE = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io"
).replace(/\/+$/, "");

export const dynamic = "force-dynamic";

/** How many cards to render. Each is one R2 read (React.cache-deduped). */
const MAX_CARDS = 24;

export const metadata: Metadata = {
  title: "Developer Portfolio Examples — real engineers, real work",
  description:
    "Browse real software-engineer portfolio examples generated from GitHub history. See how developers present projects, open-source work, and impact — then build your own free.",
  alternates: { canonical: `${BASE}/developer-portfolio-examples` },
  openGraph: {
    title: "Developer Portfolio Examples",
    description:
      "Real software-engineer portfolios generated from GitHub history.",
    url: `${BASE}/developer-portfolio-examples`,
    siteName: "gitshow",
    type: "website",
  },
};

interface ProfileCard {
  slug: string;
  name: string;
  bio: string;
  avatar: string;
  skills: string[];
  projectCount: number;
}

function absolutizeAvatar(url: string | undefined, slug: string): string {
  if (url && /^https?:\/\//i.test(url)) return url;
  if (url) return `${BASE}${url.startsWith("/") ? "" : "/"}${url}`;
  // Reliable unauthenticated fallback.
  return `https://github.com/${encodeURIComponent(slug)}.png?size=160`;
}

async function loadProfileCards(): Promise<ProfileCard[]> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const rows = await env.DB.prepare(
      `SELECT handle, public_slug
         FROM user_profiles
        WHERE current_profile_r2_key IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT 40`,
    ).all<{ handle: string; public_slug: string }>();

    const cards: ProfileCard[] = [];
    for (const row of rows.results ?? []) {
      if (cards.length >= MAX_CARDS) break;
      const resume = await loadPublishedResume(env.BUCKET, row.handle).catch(
        () => null,
      );
      if (!resume?.person?.name) continue;
      cards.push({
        slug: row.public_slug,
        name: resume.person.name,
        bio: (resume.person.description ?? "").trim(),
        avatar: absolutizeAvatar(resume.person.avatarUrl, row.public_slug),
        skills: (resume.skills ?? [])
          .map((s) => s.name)
          .filter(Boolean)
          .slice(0, 4),
        projectCount: (resume.projects ?? []).length,
      });
    }
    return cards;
  } catch {
    return [];
  }
}

export default async function DeveloperPortfolioExamplesPage() {
  const cards = await loadProfileCards();

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border/30 bg-background/80 px-4 backdrop-blur sm:px-6">
        <Logo href="/" size={24} />
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/30 px-3 py-1.5 text-[12px] hover:bg-card/50 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span className="hidden sm:inline">Home</span>
        </Link>
      </header>

      <section className="mx-auto w-full max-w-5xl px-4 sm:px-6 pt-16 pb-10">
        <div className="max-w-2xl">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
            Examples
          </div>
          <h1 className="text-[40px] sm:text-[48px] leading-[1.05] tracking-tight font-medium mb-4">
            Developer portfolio examples
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Real engineers, real portfolios — each one generated from a
            GitHub history (repos, commits, PRs, the source itself) and
            published at{" "}
            <span className="font-mono">gitshow.io/&#123;username&#125;</span>.
            The one-liner under each name is what gitshow wrote for them.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 sm:px-6 pb-16">
        {cards.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">
            New portfolios are publishing continuously — check back
            shortly, or{" "}
            <Link
              href="/signin?src=examples"
              className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              generate yours
            </Link>{" "}
            to be one of the first listed.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/${c.slug}?src=examples`}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex h-full flex-col gap-3 rounded-2xl border border-border/40 bg-card/30 p-5 transition-[background-color,border-color,transform] duration-[160ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-card/60"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={c.avatar}
                      alt=""
                      width={44}
                      height={44}
                      loading="lazy"
                      className="size-11 shrink-0 rounded-full border border-border/50 object-cover"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium">
                        {c.name}
                      </div>
                      <div className="truncate font-mono text-[12px] text-muted-foreground">
                        gitshow.io/{c.slug}
                      </div>
                    </div>
                    <ArrowUpRight className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-[160ms] group-hover:-translate-y-px group-hover:translate-x-px" />
                  </div>

                  {c.bio ? (
                    <p className="line-clamp-3 text-[13px] leading-relaxed text-secondary-foreground">
                      &ldquo;{c.bio}&rdquo;
                    </p>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                    {c.skills.map((s) => (
                      <span
                        key={s}
                        className="rounded-full border border-border/50 bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {s}
                      </span>
                    ))}
                    {c.projectCount > 0 ? (
                      <span className="ml-auto text-[11px] text-muted-foreground/80">
                        {c.projectCount} project
                        {c.projectCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <article className="mx-auto w-full max-w-3xl px-4 sm:px-6 pb-12 prose prose-neutral dark:prose-invert prose-headings:tracking-tight prose-headings:font-medium prose-h2:text-[22px] prose-h2:mt-12 prose-h2:mb-3 prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-muted-foreground prose-li:text-[15px] prose-li:text-muted-foreground prose-strong:text-foreground prose-strong:font-medium prose-a:text-foreground prose-a:underline prose-a:decoration-border prose-a:underline-offset-4 hover:prose-a:decoration-foreground">
        <h2>What makes a strong software-engineer portfolio</h2>
        <p>
          The portfolios that land interviews don&apos;t list every repo
          — they show <strong>judgment</strong>. A great developer
          portfolio leads with a few projects explained in plain
          language: what problem it solved, what you actually built, and
          the evidence (a merged PR to a well-known project says more
          than fifty solo forks). It makes contribution volume legible —
          private and org work included — and it reads in under a minute.
        </p>
        <p>
          The hard part is writing it. gitshow does that pass for you: it
          reads your GitHub the way a senior reviewer would, picks the
          work that signals the most, and drafts the prose. You edit, you
          publish. The cards above are the output.
        </p>
      </article>

      <section className="mx-auto w-full max-w-3xl px-4 sm:px-6 pb-24">
        <div className="rounded-2xl border border-border/40 bg-card/30 p-6 text-center">
          <h2 className="text-[20px] font-medium mb-2">
            Your portfolio, free
          </h2>
          <p className="mx-auto mb-5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            Sign in with GitHub. gitshow reads your history and publishes
            a portfolio at your own gitshow.io URL in about twenty
            minutes — no credit card.
          </p>
          <Link
            href="/signin?src=examples"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-foreground px-5 py-2.5 text-[13px] font-medium text-background select-none transition-[box-shadow,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[0_2px_8px_-3px_oklch(0_0_0_/_0.24)] active:scale-[0.97]"
          >
            Generate my portfolio →
          </Link>
        </div>
      </section>

      <footer className="border-t border-border/30">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
            <Logo size={20} markOnly />
            <span>© {new Date().getFullYear()} gitshow. Built with commits.</span>
          </div>
          <div className="flex items-center gap-5 text-[12px]">
            <Link
              href="/github-portfolio-generator"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              How it works
            </Link>
            <Link
              href="/compare/developer-portfolio-builders"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Compare
            </Link>
            <Link
              href="/pricing"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
