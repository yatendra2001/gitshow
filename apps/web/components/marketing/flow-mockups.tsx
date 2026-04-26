"use client";

/**
 * Flow-step mockups for the "Sign in · Generate · Share" Connect
 * section. Each mockup is a credible, animated snapshot of that step's
 * real UI — meant to sit on the sticky left column and rotate as the
 * user scrolls through the three text steps on the right.
 *
 * OAuth scopes shown here must match what `apps/web/auth.ts` actually
 * requests so the copy isn't lying.
 */

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";
import {
    ArrowUpRight,
    CheckCircle2,
    Eye,
    Globe,
    Loader2,
    Mail,
    ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const GITHUB_PATH =
    "M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-1.97c-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.33.95.1-.74.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18.92-.26 1.9-.38 2.88-.39.98.01 1.96.13 2.88.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.22 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z";

export function SignInFlowMockup() {
    return (
        <div className="relative w-full max-w-sm">
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-b from-primary/[0.12] via-transparent to-transparent blur-2xl" />
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg shadow-black/5">
                <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                    <span className="size-2 rounded-full bg-red-500/80" />
                    <span className="size-2 rounded-full bg-yellow-500/80" />
                    <span className="size-2 rounded-full bg-green-500/80" />
                    <span className="ml-2 truncate font-mono text-[10px] text-muted-foreground">
                        github.com / authorize / gitshow
                    </span>
                </div>

                <div className="space-y-5 p-5">
                    <div className="flex items-center gap-3">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-foreground text-background">
                            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
                                <path d={GITHUB_PATH} />
                            </svg>
                        </div>
                        <div className="flex flex-1 items-center gap-2 text-muted-foreground">
                            <span className="text-[11px] tracking-wide">authorize</span>
                            <Connector />
                            <span className="text-[11px] font-medium text-foreground">GitShow</span>
                        </div>
                    </div>

                    <div>
                        <p className="text-[15px] font-semibold leading-snug tracking-tight">
                            GitShow wants to access your account
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            We only read commit metadata. Source code stays on GitHub.
                        </p>
                    </div>

                    <ul className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-[11px]">
                        <ScopeRow icon={Eye} label="read:user" detail="Your name, avatar, profile" />
                        <ScopeRow icon={Mail} label="user:email" detail="So we can show your contact" />
                        <ScopeRow icon={ShieldCheck} label="repo" detail="Read public · private · org repos" />
                    </ul>

                    <button
                        type="button"
                        className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-sm"
                    >
                        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
                            <path d={GITHUB_PATH} />
                        </svg>
                        <span>Continue with GitHub</span>
                        <motion.span
                            aria-hidden
                            initial={{ x: "-150%" }}
                            animate={{ x: "350%" }}
                            transition={{
                                duration: 2.2,
                                repeat: Infinity,
                                repeatDelay: 1.4,
                                ease: "easeInOut",
                            }}
                            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                        />
                    </button>

                    <p className="text-center text-[10px] text-muted-foreground">
                        Revoke anytime in{" "}
                        <span className="text-foreground">github.com / settings / apps</span>
                    </p>
                </div>
            </div>
        </div>
    );
}

function ScopeRow({
    icon: Icon,
    label,
    detail,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    detail: string;
}) {
    return (
        <li className="flex items-center gap-2.5">
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <span className="font-mono text-[10px] font-medium text-foreground">
                {label}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="truncate text-[10px] text-muted-foreground">{detail}</span>
            <CheckCircle2 className="ml-auto size-3 shrink-0 text-primary" />
        </li>
    );
}

function Connector() {
    return (
        <span className="relative inline-flex h-px flex-1 items-center justify-center bg-border">
            <motion.span
                aria-hidden
                animate={{ x: ["-50%", "150%"] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="absolute size-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(0,166,244,0.7)]"
            />
        </span>
    );
}

const PIPELINE_TASKS: Array<{
    label: string;
    count: string;
    timing: string;
    state: "done" | "active" | "pending";
}> = [
        { label: "Indexed repositories", count: "23", timing: "0.8s", state: "done" },
        { label: "Read commits", count: "4,812", timing: "1m 14s", state: "done" },
        { label: "Extracted PRs & reviews", count: "1,204", timing: "42s", state: "done" },
        { label: "Writing portfolio…", count: "72%", timing: "live", state: "active" },
    ];

export function PipelineFlowMockup() {
    const ref = useRef<HTMLDivElement>(null);
    const inView = useInView(ref, { amount: 0.4 });
    const [progress, setProgress] = useState(72);

    useEffect(() => {
        if (!inView) {
            setProgress(72);
            return;
        }
        const id = setInterval(() => {
            setProgress((p) => (p >= 86 ? 72 : p + 1));
        }, 280);
        return () => clearInterval(id);
    }, [inView]);

    return (
        <div ref={ref} className="relative w-full max-w-md">
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-b from-primary/[0.10] via-transparent to-transparent blur-2xl" />
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg shadow-black/5">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Loader2 className="size-3.5 animate-spin text-primary" />
                        <span className="font-mono text-[10px] text-muted-foreground">
                            github.com/yatendra
                        </span>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        12 min remaining
                    </span>
                </div>

                <div className="space-y-4 p-5">
                    <ul className="space-y-3">
                        {PIPELINE_TASKS.map((t) => (
                            <li key={t.label} className="flex items-center gap-3 text-sm">
                                <PipelineMarker state={t.state} />
                                <div className="min-w-0 flex-1">
                                    <p
                                        className={cn(
                                            "truncate text-[12px]",
                                            t.state === "pending"
                                                ? "text-muted-foreground"
                                                : "text-foreground",
                                        )}
                                    >
                                        {t.label}
                                    </p>
                                </div>
                                <span className="hidden font-mono text-[10px] text-muted-foreground sm:block">
                                    {t.timing}
                                </span>
                                <span
                                    className={cn(
                                        "min-w-12 text-right font-mono text-[11px]",
                                        t.state === "active"
                                            ? "text-primary"
                                            : "text-muted-foreground",
                                    )}
                                >
                                    {t.label.startsWith("Writing") ? `${progress}%` : t.count}
                                </span>
                            </li>
                        ))}
                    </ul>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className="font-mono uppercase tracking-wider">
                                Synthesis
                            </span>
                            <span className="font-mono">{progress}%</span>
                        </div>
                        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <motion.div
                                animate={{ width: `${progress}%` }}
                                transition={{ duration: 0.5, ease: "easeOut" }}
                                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-foreground/70 via-foreground to-foreground/70"
                            />
                            <motion.span
                                aria-hidden
                                animate={{ x: ["-30%", "200%"] }}
                                transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                                className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PipelineMarker({ state }: { state: "done" | "active" | "pending" }) {
    if (state === "done") {
        return <CheckCircle2 className="size-4 shrink-0 text-primary" />;
    }
    if (state === "active") {
        return (
            <span className="relative flex size-4 shrink-0 items-center justify-center">
                <span className="absolute inline-flex size-3.5 animate-ping rounded-full bg-primary/40" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
        );
    }
    return <span className="size-3 shrink-0 rounded-full border border-border" />;
}

export function PublishFlowMockup() {
    return (
        <div className="relative w-full max-w-md">
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-b from-emerald-500/[0.10] via-transparent to-transparent blur-2xl" />
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg shadow-black/5">
                <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
                    <span className="size-2 rounded-full bg-red-500/80" />
                    <span className="size-2 rounded-full bg-yellow-500/80" />
                    <span className="size-2 rounded-full bg-green-500/80" />
                    <div className="ml-3 flex flex-1 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                        <Globe className="size-3 text-primary" />
                        <span className="text-foreground">gitshow.io/yatendra</span>
                        <motion.span
                            animate={{ opacity: [0.7, 1, 0.7] }}
                            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                            className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"
                        >
                            <span className="size-1.5 rounded-full bg-current" />
                            Live
                        </motion.span>
                    </div>
                </div>

                <div className="space-y-4 p-5">
                    <div className="flex items-start gap-3">
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-base font-semibold text-white shadow-md">
                            Y
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                                Engineer · 8 yrs · 4,812 commits
                            </p>
                            <h4 className="mt-1 text-lg font-semibold leading-tight tracking-tight">
                                Yatendra Kumar
                            </h4>
                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                Backend engineer. Ships distributed systems at scale.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
                        <MiniStat value="412" label="visits / wk" />
                        <MiniStat value="180ms" label="TTFB" highlight />
                        <MiniStat value="#1" label="on Google" />
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                        >
                            Share
                            <ArrowUpRight className="size-3" />
                        </button>
                        <p className="text-[11px] text-muted-foreground">
                            Indexed by Google · 14 recruiters this week
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function MiniStat({
    value,
    label,
    highlight,
}: {
    value: string;
    label: string;
    highlight?: boolean;
}) {
    return (
        <div className="bg-card px-3 py-2">
            <p
                className={cn(
                    "font-mono text-sm font-semibold tabular-nums tracking-tight",
                    highlight && "text-emerald-600 dark:text-emerald-400",
                )}
            >
                {value}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                {label}
            </p>
        </div>
    );
}
