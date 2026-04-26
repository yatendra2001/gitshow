"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView } from "motion/react";
import { Building2, Globe, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Public, private, and org repos" feature block.
 *
 * Replaces the old OrbitingIconsBurst (a generic ring of git icons
 * around the GitHub logo) with a credible, narrative visual: a real-
 * looking GitHub repo list on the left, a scanning beam, and a
 * portfolio synthesis card on the right whose stats tick up as each
 * repo is "ingested."
 */

type Visibility = "private" | "public" | "org";

type Repo = {
    name: string;
    visibility: Visibility;
    org?: string;
    language: string;
    languageColor: string;
    commits: number;
    prs: number;
    activity: number[];
};

const REPOS: Repo[] = [
    {
        name: "checkout-edge",
        visibility: "org",
        org: "stripe",
        language: "Rust",
        languageColor: "bg-orange-500",
        commits: 1248,
        prs: 142,
        activity: [4, 6, 9, 7, 11, 8, 12, 10, 14, 12],
    },
    {
        name: "side-project-2024",
        visibility: "private",
        language: "Go",
        languageColor: "bg-cyan-500",
        commits: 312,
        prs: 28,
        activity: [2, 3, 5, 4, 6, 8, 7, 9, 10, 11],
    },
    {
        name: "yatendra/dotfiles",
        visibility: "public",
        language: "Shell",
        languageColor: "bg-emerald-500",
        commits: 894,
        prs: 14,
        activity: [3, 5, 4, 6, 5, 7, 6, 8, 7, 9],
    },
    {
        name: "commerce-platform",
        visibility: "org",
        org: "shopify",
        language: "TypeScript",
        languageColor: "bg-blue-500",
        commits: 2358,
        prs: 53,
        activity: [5, 7, 8, 6, 9, 11, 10, 13, 11, 14],
    },
];

const REPO_FINAL_COMMITS = REPOS.reduce((sum, r) => sum + r.commits, 0);
const REPO_FINAL_PRS = REPOS.reduce((sum, r) => sum + r.prs, 0);
const REPO_FINAL_LANGS = new Set(REPOS.map((r) => r.language)).size;

const SCAN_STEP_MS = 700;

export function RepoIngestionBlock() {
    const containerRef = useRef<HTMLDivElement>(null);
    const inView = useInView(containerRef, { amount: 0.5, margin: "-80px" });
    const [scannedCount, setScannedCount] = useState(0);
    const timersRef = useRef<NodeJS.Timeout[]>([]);

    useEffect(() => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];

        if (!inView) {
            setScannedCount(0);
            return;
        }

        REPOS.forEach((_, idx) => {
            const t = setTimeout(() => setScannedCount(idx + 1), (idx + 1) * SCAN_STEP_MS);
            timersRef.current.push(t);
        });

        return () => {
            timersRef.current.forEach(clearTimeout);
            timersRef.current = [];
        };
    }, [inView]);

    const fraction = scannedCount / REPOS.length;

    return (
        <div
            ref={containerRef}
            className="relative min-h-[400px] md:min-h-[500px] overflow-hidden p-6 md:p-10"
        >
            <div className="relative mx-auto grid w-full max-w-3xl grid-cols-1 gap-5 md:grid-cols-[1.05fr_auto_0.95fr] md:items-stretch md:gap-3">
                <ReposPanel scannedCount={scannedCount} />
                <FlowConnector active={scannedCount > 0 && scannedCount < REPOS.length} />
                <PortfolioPanel
                    fraction={fraction}
                    scannedCount={scannedCount}
                />
            </div>
        </div>
    );
}

function ReposPanel({ scannedCount }: { scannedCount: number }) {
    return (
        <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-red-500/80" />
                    <span className="size-2 rounded-full bg-yellow-500/80" />
                    <span className="size-2 rounded-full bg-green-500/80" />
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                        github.com / your repos
                    </span>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">
                    {REPOS.length}
                </span>
            </div>

            <div className="divide-y divide-border">
                {REPOS.map((repo, idx) => (
                    <RepoRow
                        key={repo.name}
                        repo={repo}
                        active={scannedCount === idx}
                        scanned={scannedCount > idx}
                    />
                ))}
            </div>
        </div>
    );
}

function RepoRow({ repo, active, scanned }: { repo: Repo; active: boolean; scanned: boolean }) {
    return (
        <motion.div
            animate={{
                backgroundColor: active
                    ? "color-mix(in oklch, var(--primary) 6%, transparent)"
                    : "transparent",
            }}
            transition={{ duration: 0.25 }}
            className="relative flex items-center gap-3 px-4 py-3"
        >
            <VisibilityBadge visibility={repo.visibility} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                    {repo.org ? (
                        <>
                            <span className="text-muted-foreground">{repo.org}/</span>
                            <span className="text-foreground">{repo.name}</span>
                        </>
                    ) : (
                        <span className="text-foreground">{repo.name}</span>
                    )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                        <span className={cn("size-2 rounded-full", repo.languageColor)} />
                        {repo.language}
                    </span>
                    <span className="size-0.5 rounded-full bg-border" />
                    <span className="font-mono">{repo.commits.toLocaleString()} commits</span>
                </div>
            </div>

            <ActivitySpark values={repo.activity} className="hidden md:block" />

            <ScanIndicator active={active} scanned={scanned} />

            {active ? (
                <motion.span
                    aria-hidden
                    initial={{ scaleX: 0, opacity: 0 }}
                    animate={{ scaleX: 1, opacity: 1 }}
                    transition={{ duration: SCAN_STEP_MS / 1000, ease: "linear" }}
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left bg-gradient-to-r from-transparent via-primary to-transparent"
                />
            ) : null}
        </motion.div>
    );
}

function VisibilityBadge({ visibility }: { visibility: Visibility }) {
    const config = {
        private: {
            label: "Private",
            icon: Lock,
            className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
        },
        public: {
            label: "Public",
            icon: Globe,
            className: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
        },
        org: {
            label: "Org",
            icon: Building2,
            className:
                "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20",
        },
    } as const;

    const { label, icon: Icon, className } = config[visibility];

    return (
        <span
            className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                className,
            )}
        >
            <Icon className="size-2.5" />
            {label}
        </span>
    );
}

function ActivitySpark({ values, className }: { values: number[]; className?: string }) {
    const max = Math.max(...values);
    return (
        <div className={cn("flex h-5 items-end gap-px", className)}>
            {values.map((v, i) => (
                <span
                    key={i}
                    style={{ height: `${(v / max) * 100}%` }}
                    className="w-0.5 rounded-sm bg-foreground/30"
                />
            ))}
        </div>
    );
}

function ScanIndicator({ active, scanned }: { active: boolean; scanned: boolean }) {
    return (
        <span className="relative flex size-4 shrink-0 items-center justify-center">
            {active ? (
                <>
                    <span className="absolute inline-flex size-3.5 animate-ping rounded-full bg-primary/40" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </>
            ) : scanned ? (
                <motion.svg
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 320, damping: 18 }}
                    viewBox="0 0 16 16"
                    className="size-4 text-primary"
                    fill="none"
                >
                    <circle cx="8" cy="8" r="7" fill="currentColor" opacity={0.15} />
                    <path
                        d="m4 8 3 3 5-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </motion.svg>
            ) : (
                <span className="size-2 rounded-full border border-border" />
            )}
        </span>
    );
}

function FlowConnector({ active }: { active: boolean }) {
    return (
        <div className="relative hidden md:flex items-center justify-center">
            <div className="relative h-full w-12">
                <span className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 -translate-y-1/2 bg-border" />
                {[0, 1, 2].map((i) => (
                    <motion.span
                        key={i}
                        aria-hidden
                        initial={{ x: -10, opacity: 0 }}
                        animate={
                            active
                                ? { x: [0, 36, 36], opacity: [0, 1, 0] }
                                : { x: 0, opacity: 0 }
                        }
                        transition={{
                            duration: 1.4,
                            ease: "easeInOut",
                            repeat: active ? Infinity : 0,
                            delay: i * 0.45,
                        }}
                        className="absolute left-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_8px_rgba(0,166,244,0.7)]"
                    />
                ))}
            </div>
        </div>
    );
}

function PortfolioPanel({
    fraction,
    scannedCount,
}: {
    fraction: number;
    scannedCount: number;
}) {
    const commits = useMemo(() => Math.round(REPO_FINAL_COMMITS * fraction), [fraction]);
    const prs = useMemo(() => Math.round(REPO_FINAL_PRS * fraction), [fraction]);
    const langs = useMemo(
        () => Math.min(REPO_FINAL_LANGS, Math.max(0, Math.ceil(scannedCount * 1))),
        [scannedCount],
    );
    const ready = scannedCount === REPOS.length;

    return (
        <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                <span className="size-2 rounded-full bg-red-500/80" />
                <span className="size-2 rounded-full bg-yellow-500/80" />
                <span className="size-2 rounded-full bg-green-500/80" />
                <span className="ml-2 truncate font-mono text-[10px] text-muted-foreground">
                    gitshow.io/yatendra
                </span>
            </div>

            <div className="space-y-4 p-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-base font-semibold text-white">
                        Y
                    </div>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold tracking-tight">
                            Yatendra Kumar
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                            Staff Engineer · Distributed systems
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-border">
                    <Stat label="commits" value={commits.toLocaleString()} />
                    <Stat
                        label="PRs"
                        value={prs.toLocaleString()}
                        className="border-x border-border"
                    />
                    <Stat label="languages" value={langs.toString()} />
                </div>

                <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5">
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                        Synthesis
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                            <motion.div
                                animate={{ width: `${Math.round(fraction * 100)}%` }}
                                transition={{ duration: 0.4, ease: "easeOut" }}
                                className="h-full rounded-full bg-foreground"
                            />
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">
                            {Math.round(fraction * 100)}%
                        </span>
                    </div>
                </div>

                <motion.div
                    animate={{
                        opacity: ready ? 1 : 0,
                        y: ready ? 0 : 6,
                    }}
                    transition={{ duration: 0.35 }}
                    className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                >
                    <Sparkles className="size-3" />
                    Portfolio ready · every claim sourced to a commit
                </motion.div>
            </div>
        </div>
    );
}

function Stat({
    label,
    value,
    className,
}: {
    label: string;
    value: string;
    className?: string;
}) {
    return (
        <div className={cn("bg-card px-2.5 py-2.5", className)}>
            <p className="font-mono text-base font-semibold tabular-nums tracking-tight">
                {value}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                {label}
            </p>
        </div>
    );
}
