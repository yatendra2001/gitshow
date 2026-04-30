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
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/10">
                <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
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
                            <span className="text-[11px] font-medium text-primary">GitShow</span>
                        </div>
                    </div>

                    <div>
                        <p className="text-[15px] font-semibold leading-snug tracking-tight">
                            GitShow wants to access your account
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Read-only. Revoke any time from GitHub settings.
                        </p>
                    </div>

                    <ul className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-[11px]">
                        <ScopeRow
                            icon={Eye}
                            label="read:user"
                            detail="Your name, avatar, profile"
                            tone="sky"
                        />
                        <ScopeRow
                            icon={Mail}
                            label="user:email"
                            detail="So we can show your contact"
                            tone="emerald"
                        />
                        <ScopeRow
                            icon={ShieldCheck}
                            label="repo"
                            detail="Sample source · read PRs · public + private"
                            tone="amber"
                        />
                        <ScopeRow
                            icon={Globe}
                            label="read:org"
                            detail="Read the org repos you authorized"
                            tone="violet"
                        />
                    </ul>

                    <button
                        type="button"
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99]"
                    >
                        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
                            <path d={GITHUB_PATH} />
                        </svg>
                        <span>Continue with GitHub</span>
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

type ScopeTone = "sky" | "emerald" | "amber" | "violet";

const SCOPE_TONES: Record<ScopeTone, { icon: string; chip: string }> = {
    sky: {
        icon: "text-sky-500",
        chip: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
    },
    emerald: {
        icon: "text-emerald-500",
        chip: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
    },
    amber: {
        icon: "text-amber-500",
        chip: "bg-amber-500/14 text-amber-600 dark:text-amber-300",
    },
    violet: {
        icon: "text-violet-500",
        chip: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
    },
};

function ScopeRow({
    icon: Icon,
    label,
    detail,
    tone = "sky",
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    detail: string;
    tone?: ScopeTone;
}) {
    const t = SCOPE_TONES[tone];
    return (
        <li className="flex items-center gap-2.5">
            <Icon className={cn("size-3 shrink-0", t.icon)} />
            <span
                className={cn(
                    "rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium",
                    t.chip,
                )}
            >
                {label}
            </span>
            <span className="truncate text-[10px] text-muted-foreground">
                {detail}
            </span>
            <CheckCircle2 className="ml-auto size-3 shrink-0 text-emerald-500" />
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
    accent: "sky" | "emerald" | "amber" | "violet";
}> = [
        { label: "Cloned repositories", count: "23", timing: "0.8s", state: "done", accent: "sky" },
        { label: "Sampled source files", count: "164", timing: "3m 42s", state: "done", accent: "amber" },
        { label: "Indexed PRs & reviews", count: "1,204", timing: "42s", state: "done", accent: "violet" },
        { label: "Writing your portfolio…", count: "72%", timing: "live", state: "active", accent: "emerald" },
    ];

const PIPELINE_ACCENTS: Record<"sky" | "emerald" | "amber" | "violet", string> = {
    sky: "bg-sky-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    violet: "bg-violet-500",
};

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
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/10">
                <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Loader2 className="size-3.5 animate-spin text-sky-500" />
                        <span className="font-mono text-[10px] text-muted-foreground">
                            github.com/yatendra
                        </span>
                    </div>
                    <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
                        12 min remaining
                    </span>
                </div>

                <div className="space-y-4 p-5">
                    <ul className="space-y-3">
                        {PIPELINE_TASKS.map((t) => (
                            <li key={t.label} className="flex items-center gap-3 text-sm">
                                <PipelineMarker state={t.state} accent={t.accent} />
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
                                            ? "text-emerald-600 dark:text-emerald-300"
                                            : "text-muted-foreground",
                                    )}
                                >
                                    {t.state === "active" ? `${progress}%` : t.count}
                                </span>
                            </li>
                        ))}
                    </ul>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className="font-mono uppercase tracking-wider">
                                Drafting prose
                            </span>
                            <span className="font-mono text-emerald-600 dark:text-emerald-300">
                                {progress}%
                            </span>
                        </div>
                        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <motion.div
                                animate={{ width: `${progress}%` }}
                                transition={{ duration: 0.5, ease: "easeOut" }}
                                className="absolute inset-y-0 left-0 rounded-full bg-emerald-500"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PipelineMarker({
    state,
    accent,
}: {
    state: "done" | "active" | "pending";
    accent: "sky" | "emerald" | "amber" | "violet";
}) {
    if (state === "done") {
        return (
            <CheckCircle2
                className={cn(
                    "size-4 shrink-0",
                    accent === "sky" && "text-sky-500",
                    accent === "emerald" && "text-emerald-500",
                    accent === "amber" && "text-amber-500",
                    accent === "violet" && "text-violet-500",
                )}
            />
        );
    }
    if (state === "active") {
        return (
            <span className="relative flex size-4 shrink-0 items-center justify-center">
                <span
                    className={cn(
                        "absolute inline-flex size-3.5 animate-ping rounded-full opacity-60",
                        PIPELINE_ACCENTS[accent].replace("bg-", "bg-").concat("/40"),
                    )}
                />
                <span className={cn("relative inline-flex size-2 rounded-full", PIPELINE_ACCENTS[accent])} />
            </span>
        );
    }
    return <span className="size-3 shrink-0 rounded-full border border-border" />;
}

export function PublishFlowMockup() {
    return (
        <div className="relative w-full max-w-md">
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/10">
                <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
                    <span className="size-2 rounded-full bg-red-500/80" />
                    <span className="size-2 rounded-full bg-yellow-500/80" />
                    <span className="size-2 rounded-full bg-green-500/80" />
                    <div className="ml-3 flex flex-1 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                        <Globe className="size-3 text-sky-500" />
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
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sky-500 text-base font-semibold text-white shadow-sm ring-2 ring-sky-500/20">
                            Y
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                                Engineer · sourced from GitHub
                            </p>
                            <h4 className="mt-1 text-lg font-semibold leading-tight tracking-tight">
                                Yatendra Kumar
                            </h4>
                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                Backend engineer. Distributed systems, payments, edge.
                            </p>
                        </div>
                    </div>

                    <ul className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-[11px]">
                        <li className="flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-amber-500" />
                            <span className="text-muted-foreground">Every claim links to a real commit</span>
                        </li>
                        <li className="flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-violet-500" />
                            <span className="text-muted-foreground">Six templates, swap any time</span>
                        </li>
                        <li className="flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            <span className="text-muted-foreground">SEO-indexed and edge-served</span>
                        </li>
                    </ul>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                        >
                            Copy link
                            <ArrowUpRight className="size-3" />
                        </button>
                        <p className="text-[11px] text-muted-foreground">
                            yourname.com or gitshow.io/{"{handle}"}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

