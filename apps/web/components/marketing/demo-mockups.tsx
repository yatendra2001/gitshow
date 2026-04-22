/**
 * Portfolio-view mockups for the hero demo carousel.
 *
 * The demo in the hero is the product's "aha moment" — people here
 * want to see what a GitShow portfolio *actually looks like*, not a
 * diagram of the workflow that gets them there. Each mockup below is
 * a compact, credible slice of a real portfolio page.
 *
 * These are pure DOM — no portraits, no external images, no heavy
 * deps — so they render fast and never 404 in production. The sister
 * flow mockups (sign-in, generation pipeline, live URL) live in
 * `flow-mockups.tsx`.
 */

import {
    ArrowUpRight,
    BarChart3,
    CheckCircle2,
    GitCommit,
    GitPullRequest,
    Globe,
    Star,
} from "lucide-react";

function BrowserChrome({
    url,
    children,
}: {
    url: string;
    children: React.ReactNode;
}) {
    return (
        <div className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
                <span className="size-2 rounded-full bg-red-500/80" />
                <span className="size-2 rounded-full bg-yellow-500/80" />
                <span className="size-2 rounded-full bg-green-500/80" />
                <div className="ml-3 flex flex-1 items-center gap-1 rounded-md bg-background px-3 py-1 font-mono text-[11px] text-muted-foreground">
                    <span className="text-primary">https://</span>
                    <span>{url}</span>
                </div>
            </div>
            <div className="p-5 md:p-6">{children}</div>
        </div>
    );
}

export function PortfolioProfileMockup() {
    return (
        <BrowserChrome url="gitshow.io/yatendra">
            <div className="flex flex-col gap-5">
                <div className="flex items-start gap-4">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-sky-400 to-indigo-500 text-xl font-semibold text-white">
                        Y
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <h4 className="text-lg font-semibold tracking-tight">
                                Yatendra Kumar
                            </h4>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                <span className="size-1 rounded-full bg-current" />
                                open to work
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Staff Backend Engineer · Bengaluru · 8 yrs
                        </p>
                    </div>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                    Distributed-systems engineer. Worked on checkout, payments,
                    and real-time messaging at scale. Currently focused on edge
                    compute and latency.
                </p>
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
                    <div className="bg-card p-3">
                        <p className="text-xl font-semibold tracking-tight">
                            4,812
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            commits
                        </p>
                    </div>
                    <div className="bg-card p-3">
                        <p className="text-xl font-semibold tracking-tight">
                            237
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            PRs merged
                        </p>
                    </div>
                    <div className="bg-card p-3">
                        <p className="text-xl font-semibold tracking-tight">
                            23
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            repos shipped
                        </p>
                    </div>
                </div>
            </div>
        </BrowserChrome>
    );
}

export function PortfolioProjectMockup() {
    return (
        <BrowserChrome url="gitshow.io/yatendra/shopify-checkout">
            <div className="flex flex-col gap-4">
                <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        Project · 2023
                    </p>
                    <h4 className="mt-1 text-lg font-semibold tracking-tight">
                        Shopify checkout — edge migration
                    </h4>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                    Led the migration of checkout from monolith to edge-served,{" "}
                    <span className="rounded-sm bg-primary/15 px-1 font-medium text-foreground">
                        cutting p99 latency by 62%
                    </span>{" "}
                    across 180M requests/day. Coordinated 6 teams across infra,
                    payments, and frontend.
                </p>
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                        <GitPullRequest className="size-3.5 text-primary" />
                        <a
                            href="#"
                            className="font-mono text-xs text-foreground hover:underline"
                        >
                            shopify/commerce#8421
                        </a>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                            merged · +14.2k / −8.7k
                        </span>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                        <GitCommit className="size-3.5 text-primary" />
                        <a
                            href="#"
                            className="font-mono text-xs text-foreground hover:underline"
                        >
                            4f2e9b1
                        </a>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                            &quot;ship: edge handler for checkout&quot;
                        </span>
                    </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                    {[
                        "Rust",
                        "Cloudflare Workers",
                        "Durable Objects",
                        "PostgreSQL",
                    ].map((tag) => (
                        <span
                            key={tag}
                            className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            </div>
        </BrowserChrome>
    );
}

export function PortfolioSkillsMockup() {
    const skills = [
        { name: "Rust", pct: 92, evidence: "18 repos · 1,240 commits" },
        {
            name: "Distributed systems",
            pct: 88,
            evidence: "7 projects · shopify, plaid, cloudflare",
        },
        { name: "PostgreSQL", pct: 74, evidence: "reviewed 94 migrations" },
        { name: "Edge compute", pct: 68, evidence: "3 talks · 1 OSS library" },
    ];
    return (
        <BrowserChrome url="gitshow.io/yatendra/skills">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h4 className="text-base font-semibold tracking-tight">
                        Skills, evidenced
                    </h4>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        last 3 years
                    </span>
                </div>
                <div className="flex flex-col gap-3">
                    {skills.map((s) => (
                        <div key={s.name} className="flex flex-col gap-1.5">
                            <div className="flex items-baseline justify-between gap-3">
                                <span className="text-sm font-medium">
                                    {s.name}
                                </span>
                                <span className="text-[11px] font-mono text-muted-foreground">
                                    {s.evidence}
                                </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-foreground/80"
                                    style={{ width: `${s.pct}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-primary" />
                    Every number above links to the commits it came from.
                </div>
            </div>
        </BrowserChrome>
    );
}

export function PortfolioAnalyticsMockup() {
    const days = [28, 34, 42, 39, 61, 58, 72];
    const max = Math.max(...days);
    return (
        <BrowserChrome url="gitshow.io/yatendra/analytics">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-base font-semibold tracking-tight">
                            Who viewed your portfolio
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                            Last 7 days · 412 total visits
                        </p>
                    </div>
                    <BarChart3 className="size-4 text-muted-foreground" />
                </div>
                <div className="flex h-24 items-end gap-2">
                    {days.map((d, i) => (
                        <div
                            key={i}
                            className="flex flex-1 flex-col items-center gap-1"
                        >
                            <div
                                className="w-full rounded-sm bg-foreground/80"
                                style={{ height: `${(d / max) * 100}%` }}
                            />
                            <span className="text-[9px] text-muted-foreground">
                                {["M", "T", "W", "T", "F", "S", "S"][i]}
                            </span>
                        </div>
                    ))}
                </div>
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
                        <Globe className="size-3.5 text-muted-foreground" />
                        <span className="font-mono text-[11px]">
                            recruiter.stripe.com
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                            7 visits · Checkout project
                        </span>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
                        <Star className="size-3.5 text-amber-500" />
                        <span className="font-mono text-[11px]">
                            talent.shopify.com
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                            clicked PR #8421
                        </span>
                    </div>
                </div>
                <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background self-start"
                >
                    Open analytics
                    <ArrowUpRight className="size-3" />
                </button>
            </div>
        </BrowserChrome>
    );
}
