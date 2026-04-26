"use client";

/**
 * Portfolio-view mockups for the hero demo carousel.
 *
 * The demo is the product's "aha moment" — people here want to see
 * what a GitShow portfolio actually looks like. Each mockup is a
 * scaled-down render of a real `/{handle}` section pulled from
 * `components/portfolio-page.tsx`, so the marketing carousel and
 * the live portfolio share the same visual language (hero with
 * avatar + greeting, accent-bar `SectionHeader`, accordion work,
 * skills pill chips, project cards with image + tags, timeline
 * build log).
 *
 * Pure DOM — no portraits or external images so they render fast and
 * never 404. The sister flow mockups (sign-in, generation pipeline,
 * live URL) live in `flow-mockups.tsx`.
 */

import {
    ArrowUpRight,
    ChevronDown,
    Code2,
    Cpu,
    Database,
    Flame,
    GitBranch,
    Globe2,
    Hammer,
    Layers,
    Wind,
    Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Browser frame                                                              */
/* -------------------------------------------------------------------------- */

function BrowserChrome({
    url,
    children,
    accent = "violet",
}: {
    url: string;
    children: React.ReactNode;
    accent?: "violet" | "emerald" | "amber" | "sky";
}) {
    const accentRing: Record<string, string> = {
        violet: "from-violet-500/15 via-transparent to-transparent",
        emerald: "from-emerald-500/15 via-transparent to-transparent",
        amber: "from-amber-500/15 via-transparent to-transparent",
        sky: "from-sky-500/15 via-transparent to-transparent",
    };
    return (
        <div className="relative w-full max-w-2xl">
            <div
                className={cn(
                    "absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-b blur-3xl",
                    accentRing[accent],
                )}
            />
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-black/5">
                <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
                    <span className="size-2 rounded-full bg-red-500/80" />
                    <span className="size-2 rounded-full bg-yellow-500/80" />
                    <span className="size-2 rounded-full bg-green-500/80" />
                    <div className="ml-3 flex flex-1 items-center gap-1 rounded-md bg-background px-3 py-1 font-mono text-[11px] text-muted-foreground">
                        <span className="text-primary">https://</span>
                        <span>{url}</span>
                        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                            <span className="size-1.5 rounded-full bg-current" />
                            Live
                        </span>
                    </div>
                </div>
                <div className="p-6 md:p-7">{children}</div>
            </div>
        </div>
    );
}

/**
 * The `SectionHeader` from the real portfolio (`portfolio-page.tsx`):
 * a small vertical accent bar gradient followed by the heading. We
 * mirror it exactly here so the demo mockups feel like the same
 * design language.
 */
function PortfolioSectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="flex items-center gap-2.5 text-base font-bold">
            <span
                aria-hidden
                className="inline-block h-3.5 w-1 rounded-full bg-gradient-to-b from-primary to-primary/40"
            />
            {children}
        </h3>
    );
}

/* -------------------------------------------------------------------------- */
/* 1. Profile — hero + about                                                  */
/* -------------------------------------------------------------------------- */

export function PortfolioProfileMockup() {
    return (
        <BrowserChrome url="gitshow.io/yatendra" accent="violet">
            <div className="flex flex-col gap-7">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-2 min-w-0">
                        <h2 className="text-2xl font-semibold leading-tight tracking-tighter sm:text-3xl">
                            Hi, I&apos;m Yatendra
                        </h2>
                        <p className="text-[13px] leading-relaxed text-muted-foreground">
                            Staff Backend Engineer building distributed systems —
                            checkout, payments, and real-time messaging at scale.
                        </p>
                    </div>
                    <div className="relative shrink-0">
                        <div className="absolute -inset-1.5 rounded-full bg-gradient-to-br from-sky-400/40 to-violet-500/40 blur-md" />
                        <div className="relative flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-2xl font-semibold text-white shadow-lg ring-4 ring-muted">
                            Y
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-3">
                    <PortfolioSectionHeader>About</PortfolioSectionHeader>
                    <div className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
                        <p>
                            I&apos;ve spent eight years on the unsexy backend that
                            keeps internet checkout from melting under load.
                            Lately, that means edge compute, latency budgeting,
                            and the boring details of payment idempotency.
                        </p>
                        <p>
                            Currently shipping{" "}
                            <span className="rounded-sm bg-primary/15 px-1 font-medium text-foreground">
                                a Rust-on-Workers checkout
                            </span>{" "}
                            that cut p99 by 62%. I write at{" "}
                            <a className="text-primary hover:underline" href="#">
                                yatendra.dev
                            </a>
                            .
                        </p>
                    </div>
                </div>
            </div>
        </BrowserChrome>
    );
}

/* -------------------------------------------------------------------------- */
/* 2. Projects — image card grid                                              */
/* -------------------------------------------------------------------------- */

const PROJECTS: Array<{
    title: string;
    dates: string;
    description: string;
    tags: string[];
    accent: "rust" | "ts" | "go" | "edge";
}> = [
        {
            title: "Shopify checkout edge",
            dates: "2023 — 2024",
            description:
                "Migrated checkout from monolith to edge-served. Cut p99 latency by 62% across 180M req/day.",
            tags: ["Rust", "Workers", "Postgres"],
            accent: "rust",
        },
        {
            title: "Webhook ledger",
            dates: "2024 — present",
            description:
                "Idempotent, event-sourced webhook ledger. Handles 12M events/day with at-most-once delivery.",
            tags: ["Go", "Kafka", "Postgres"],
            accent: "go",
        },
    ];

const PROJECT_GRADIENTS: Record<string, string> = {
    rust: "from-orange-500 via-rose-500 to-violet-600",
    ts: "from-sky-500 via-blue-500 to-indigo-600",
    go: "from-cyan-500 via-teal-500 to-emerald-600",
    edge: "from-emerald-500 via-teal-500 to-sky-600",
};

export function PortfolioProjectMockup() {
    return (
        <BrowserChrome url="gitshow.io/yatendra/#projects" accent="sky">
            <div className="flex flex-col gap-5">
                <div className="flex flex-col items-center gap-3">
                    <div className="flex w-full items-center">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
                        <span className="rounded-xl border border-border bg-foreground px-3 py-0.5 text-[11px] font-medium text-background">
                            My Projects
                        </span>
                        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-border to-transparent" />
                    </div>
                    <div className="flex flex-col items-center gap-1">
                        <h3 className="text-xl font-bold leading-tight tracking-tighter">
                            Check out my latest work
                        </h3>
                        <p className="text-[11px] text-muted-foreground">
                            Sourced from my real commits and PRs.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {PROJECTS.map((project) => (
                        <ProjectCard key={project.title} {...project} />
                    ))}
                </div>
            </div>
        </BrowserChrome>
    );
}

function ProjectCard({
    title,
    dates,
    description,
    tags,
    accent,
}: {
    title: string;
    dates: string;
    description: string;
    tags: string[];
    accent: keyof typeof PROJECT_GRADIENTS;
}) {
    return (
        <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-background transition-all hover:ring-2 hover:ring-muted">
            <div
                className={cn(
                    "relative h-24 w-full bg-gradient-to-br",
                    PROJECT_GRADIENTS[accent],
                )}
            >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.4),transparent_45%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_85%,rgba(0,0,0,0.25),transparent_50%)]" />
                <div className="absolute right-2 top-2 flex h-5 items-center gap-1 rounded-md bg-black/30 px-1.5 text-[9px] font-mono text-white backdrop-blur-sm">
                    <ArrowUpRight className="size-2.5" />
                    Source
                </div>
                <div className="absolute bottom-2 left-2 flex h-5 items-center gap-1 rounded-md bg-black/30 px-1.5 text-[9px] font-mono text-white backdrop-blur-sm">
                    <GitBranch className="size-2.5" />
                    +14.2k / −8.7k
                </div>
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-3">
                <div className="flex items-center gap-1.5">
                    <p className="truncate text-[12px] font-semibold leading-snug">
                        {title}
                    </p>
                    <ArrowUpRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <p className="font-mono text-[9px] text-muted-foreground">{dates}</p>
                <p className="line-clamp-2 text-[10.5px] leading-relaxed text-muted-foreground">
                    {description}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                    {tags.map((tag) => (
                        <span
                            key={tag}
                            className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-medium text-foreground"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* 3. Skills — pill chips + work accordion preview                            */
/* -------------------------------------------------------------------------- */

const SKILL_PILLS: Array<{ name: string; icon: React.ComponentType<{ className?: string }> }> = [
    { name: "Rust", icon: Cpu },
    { name: "TypeScript", icon: Code2 },
    { name: "Go", icon: Wind },
    { name: "Cloudflare Workers", icon: Globe2 },
    { name: "PostgreSQL", icon: Database },
    { name: "Distributed systems", icon: Layers },
    { name: "Edge compute", icon: Zap },
    { name: "Kafka", icon: Flame },
    { name: "OpenTelemetry", icon: Layers },
    { name: "GraphQL", icon: Code2 },
    { name: "Redis", icon: Database },
    { name: "Terraform", icon: Hammer },
];

const WORK: Array<{ company: string; title: string; dates: string; logo: string; expanded?: boolean; description?: string }> = [
    {
        company: "Shopify",
        title: "Staff Engineer · Checkout Platform",
        dates: "2023 — Now",
        logo: "S",
        expanded: true,
        description:
            "Led the migration of checkout from monolith to edge-served, cutting p99 by 62% across 180M req/day.",
    },
    {
        company: "Stripe",
        title: "Senior Engineer · Connect",
        dates: "2020 — 2023",
        logo: "S",
    },
    {
        company: "Cloudflare",
        title: "Engineer · Workers",
        dates: "2018 — 2020",
        logo: "C",
    },
];

const COMPANY_GRADIENTS: Record<string, string> = {
    Shopify: "from-emerald-500 to-teal-600",
    Stripe: "from-violet-500 to-purple-600",
    Cloudflare: "from-orange-500 to-amber-600",
};

export function PortfolioSkillsMockup() {
    return (
        <BrowserChrome url="gitshow.io/yatendra/#skills" accent="emerald">
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-3">
                    <PortfolioSectionHeader>Skills</PortfolioSectionHeader>
                    <div className="flex flex-wrap gap-1.5">
                        {SKILL_PILLS.map(({ name, icon: Icon }) => (
                            <span
                                key={name}
                                className="inline-flex h-6 items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 text-[11px] font-medium text-foreground ring-2 ring-border/20"
                            >
                                <Icon className="size-3 text-muted-foreground" />
                                {name}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col gap-3">
                    <PortfolioSectionHeader>Work Experience</PortfolioSectionHeader>
                    <div className="flex flex-col gap-3">
                        {WORK.map((w) => (
                            <WorkRow key={w.company} {...w} />
                        ))}
                    </div>
                </div>
            </div>
        </BrowserChrome>
    );
}

function WorkRow({
    company,
    title,
    dates,
    logo,
    expanded,
    description,
}: {
    company: string;
    title: string;
    dates: string;
    logo: string;
    expanded?: boolean;
    description?: string;
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
                <div
                    className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-semibold text-white shadow-sm ring-2 ring-border",
                        COMPANY_GRADIENTS[company] || "from-foreground to-foreground",
                    )}
                >
                    {logo}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[12px] font-semibold leading-tight">
                        {company}
                        <ChevronDown
                            className={cn(
                                "size-3 text-muted-foreground transition-transform",
                                !expanded && "-rotate-90",
                            )}
                        />
                    </p>
                    <p className="truncate text-[10.5px] text-muted-foreground">
                        {title}
                    </p>
                </div>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {dates}
                </span>
            </div>
            {expanded && description ? (
                <p className="ml-12 text-[11px] leading-relaxed text-muted-foreground">
                    {description}
                </p>
            ) : null}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* 4. Build log — timeline                                                    */
/* -------------------------------------------------------------------------- */

const BUILD_LOG: Array<{
    title: string;
    location: string;
    date: string;
    description: string;
    chip: string;
    accent: "rust" | "ts" | "go" | "edge";
}> = [
        {
            title: "p99-budget",
            location: "weekend OSS",
            date: "Mar 2025",
            description:
                "A latency budgeter that tells you which middleware is eating your SLO. Shipped on HN front page.",
            chip: "OSS",
            accent: "rust",
        },
        {
            title: "Kafka-Edge demo",
            location: "Cloudflare Connect '24",
            date: "Oct 2024",
            description:
                "Live demo of running Kafka consumer groups on Cloudflare Workers. Recorded talk available.",
            chip: "Talk",
            accent: "edge",
        },
        {
            title: "ledger-sql",
            location: "personal",
            date: "Jul 2024",
            description:
                "Tiny event-sourced ledger that fits in a single Postgres function. 200 LOC, fully ACID.",
            chip: "Side project",
            accent: "go",
        },
    ];

const BUILD_LOG_GRADIENTS: Record<string, string> = {
    rust: "from-orange-500 to-rose-500",
    ts: "from-sky-500 to-blue-600",
    go: "from-cyan-500 to-teal-500",
    edge: "from-emerald-500 to-teal-500",
};

export function PortfolioAnalyticsMockup() {
    return (
        <BrowserChrome url="gitshow.io/yatendra/#buildLog" accent="amber">
            <div className="flex flex-col gap-5">
                <div className="flex flex-col items-center gap-2.5">
                    <div className="flex w-full items-center">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
                        <span className="rounded-xl border border-border bg-foreground px-3 py-0.5 text-[11px] font-medium text-background">
                            Build Log
                        </span>
                        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-border to-transparent" />
                    </div>
                    <div className="flex flex-col items-center gap-1">
                        <h3 className="text-xl font-bold leading-tight tracking-tighter">
                            Things I&apos;ve been building
                        </h3>
                        <p className="text-[11px] text-muted-foreground">
                            A timeline of weekend projects, talks, and side experiments.
                        </p>
                    </div>
                </div>

                <ol className="relative flex flex-col gap-5 pl-6">
                    <span
                        aria-hidden
                        className="absolute left-[1.05rem] top-2 bottom-2 w-px bg-border"
                    />
                    {BUILD_LOG.map((entry) => (
                        <BuildLogRow key={entry.title} {...entry} />
                    ))}
                </ol>
            </div>
        </BrowserChrome>
    );
}

function BuildLogRow({
    title,
    location,
    date,
    description,
    chip,
    accent,
}: {
    title: string;
    location: string;
    date: string;
    description: string;
    chip: string;
    accent: keyof typeof BUILD_LOG_GRADIENTS;
}) {
    return (
        <li className="relative -ml-6 grid grid-cols-[auto_1fr] items-start gap-3">
            <div
                className={cn(
                    "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm ring-2 ring-border",
                    BUILD_LOG_GRADIENTS[accent],
                )}
            >
                <Hammer className="size-4 text-white" />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
                <time className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {date}
                </time>
                <div className="flex items-center gap-1.5">
                    <h4 className="text-[12px] font-semibold leading-tight">
                        {title}
                    </h4>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-medium text-foreground">
                        {chip}
                    </span>
                </div>
                <p className="text-[11px] text-muted-foreground">{location}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {description}
                </p>
            </div>
        </li>
    );
}
