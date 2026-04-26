"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView, AnimatePresence } from "motion/react";
import { Check, Globe, Lock, Loader2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Connect a custom domain" — animated provisioning sequence.
 *
 * Replaces the older static config card with a four-stage timeline
 * (DNS verify → SSL provision → edge cache → live), capped by a live
 * browser preview of the user's portfolio at their custom domain.
 * Tells the same promise — "we handle SSL, DNS, and caching" — but
 * shows it happening rather than describing it.
 */

type Stage = "idle" | "dns" | "ssl" | "edge" | "live";

const STAGE_SEQUENCE: Array<{ stage: Stage; delay: number }> = [
    { stage: "dns", delay: 600 },
    { stage: "ssl", delay: 1100 },
    { stage: "edge", delay: 900 },
    { stage: "live", delay: 700 },
];

const STEPS: Array<{
    key: Stage;
    label: string;
    detail: string;
    timing: string;
}> = [
        { key: "dns", label: "DNS verified", detail: "yatendra.dev → cname.gitshow.io", timing: "0.4s" },
        { key: "ssl", label: "SSL provisioned", detail: "Let's Encrypt · auto-renew", timing: "12s" },
        { key: "edge", label: "Edge cached", detail: "280 regions · pre-warmed", timing: "1.1s" },
    ];

const STAGE_INDEX: Record<Stage, number> = {
    idle: -1,
    dns: 0,
    ssl: 1,
    edge: 2,
    live: 3,
};

export function IntegrationBlock({
    popoverPosition: _popoverPosition = "top",
}: {
    popoverPosition?: "top" | "bottom";
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const inView = useInView(containerRef, { amount: 0.5, margin: "-80px" });
    const [stage, setStage] = useState<Stage>("idle");
    const timersRef = useRef<NodeJS.Timeout[]>([]);

    useEffect(() => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];

        if (!inView) {
            setStage("idle");
            return;
        }

        let cumulative = 0;
        STAGE_SEQUENCE.forEach(({ stage: next, delay }) => {
            cumulative += delay;
            const t = setTimeout(() => setStage(next), cumulative);
            timersRef.current.push(t);
        });

        return () => {
            timersRef.current.forEach(clearTimeout);
            timersRef.current = [];
        };
    }, [inView]);

    const stageIdx = STAGE_INDEX[stage];

    return (
        <div
            ref={containerRef}
            className="relative min-h-[400px] md:min-h-[500px] overflow-hidden p-6 md:p-10"
        >
            <div className="relative mx-auto flex w-full max-w-md flex-col gap-4">
                <BrowserPreview stage={stage} />
                <ProvisioningTimeline stageIdx={stageIdx} />
            </div>
        </div>
    );
}

function BrowserPreview({ stage }: { stage: Stage }) {
    const isLive = stage === "live";
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                <span className="size-2 rounded-full bg-red-500/80" />
                <span className="size-2 rounded-full bg-yellow-500/80" />
                <span className="size-2 rounded-full bg-green-500/80" />

                <div className="ml-2 flex flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px]">
                    <AnimatePresence mode="wait" initial={false}>
                        {isLive ? (
                            <motion.span
                                key="lock"
                                initial={{ opacity: 0, scale: 0.6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.25 }}
                                className="inline-flex items-center text-emerald-600 dark:text-emerald-400"
                            >
                                <Lock className="size-3" />
                            </motion.span>
                        ) : (
                            <motion.span
                                key="pending"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="inline-flex items-center text-muted-foreground"
                            >
                                <Loader2 className="size-3 animate-spin" />
                            </motion.span>
                        )}
                    </AnimatePresence>
                    <span className={isLive ? "text-foreground" : "text-muted-foreground"}>
                        yatendra.dev
                    </span>
                    <AnimatePresence>
                        {isLive && (
                            <motion.span
                                initial={{ opacity: 0, x: -4 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0 }}
                                className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"
                            >
                                <span className="size-1.5 rounded-full bg-current" />
                                Live
                            </motion.span>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <div className="relative overflow-hidden bg-gradient-to-b from-card to-muted/30 px-5 py-5">
                <AnimatePresence mode="wait" initial={false}>
                    {isLive ? (
                        <motion.div
                            key="portfolio"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                            className="flex flex-col gap-3"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-sm font-semibold text-white">
                                    Y
                                </div>
                                <div>
                                    <p className="text-sm font-semibold leading-tight">
                                        Yatendra Kumar
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                        Staff Engineer · yatendra.dev
                                    </p>
                                </div>
                                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:text-emerald-300">
                                    <span className="size-1 rounded-full bg-current" />
                                    open to work
                                </span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                Backend engineer. 8 years on checkout, payments, real-time messaging.
                            </p>
                            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
                                <MiniStat value="4,812" label="commits" />
                                <MiniStat value="237" label="PRs" />
                                <MiniStat value="180ms" label="TTFB" highlight />
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="placeholder"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex flex-col gap-3"
                        >
                            <div className="flex items-center gap-3">
                                <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-2.5 w-2/3 animate-pulse rounded bg-muted" />
                                    <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <div className="h-2 animate-pulse rounded bg-muted" />
                                <div className="h-2 w-5/6 animate-pulse rounded bg-muted" />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <div className="h-8 animate-pulse rounded bg-muted" />
                                <div className="h-8 animate-pulse rounded bg-muted" />
                                <div className="h-8 animate-pulse rounded bg-muted" />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {!isLive && (
                        <motion.span
                            initial={{ x: "-100%" }}
                            animate={{ x: "200%" }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-foreground/[0.04] to-transparent"
                        />
                    )}
                </AnimatePresence>
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
        <div className="bg-card px-2 py-1.5">
            <p
                className={cn(
                    "font-mono text-[12px] font-semibold tabular-nums tracking-tight",
                    highlight && "text-emerald-600 dark:text-emerald-400",
                )}
            >
                {value}
            </p>
            <p className="text-[8px] uppercase tracking-wider text-muted-foreground">
                {label}
            </p>
        </div>
    );
}

function ProvisioningTimeline({ stageIdx }: { stageIdx: number }) {
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <Globe className="size-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-medium">Custom domain</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                    yatendra.dev
                </span>
            </div>

            <ol className="relative space-y-3 p-4">
                <span
                    aria-hidden
                    className="absolute left-[1.05rem] top-7 bottom-7 w-px bg-border"
                />
                {STEPS.map((s, idx) => {
                    const reached = stageIdx >= idx;
                    const active = stageIdx === idx;
                    const done = stageIdx > idx;
                    return (
                        <TimelineRow
                            key={s.key}
                            label={s.label}
                            detail={s.detail}
                            timing={s.timing}
                            reached={reached}
                            active={active}
                            done={done}
                        />
                    );
                })}

                <LiveRow live={stageIdx >= 3} />
            </ol>
        </div>
    );
}

function TimelineRow({
    label,
    detail,
    timing,
    reached,
    active,
    done,
}: {
    label: string;
    detail: string;
    timing: string;
    reached: boolean;
    active: boolean;
    done: boolean;
}) {
    return (
        <li className="relative flex items-start gap-3">
            <span
                className={cn(
                    "relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border bg-card",
                    reached ? "border-foreground/40" : "border-border",
                )}
            >
                {done ? (
                    <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 320, damping: 18 }}
                        className="flex size-5 items-center justify-center rounded-full bg-foreground"
                    >
                        <Check className="size-3 text-background" strokeWidth={3} />
                    </motion.span>
                ) : active ? (
                    <Loader2 className="size-3 animate-spin text-foreground" />
                ) : (
                    <span className="size-1.5 rounded-full bg-border" />
                )}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                    <p
                        className={cn(
                            "text-[12px] font-medium transition-colors",
                            reached ? "text-foreground" : "text-muted-foreground",
                        )}
                    >
                        {label}
                    </p>
                    <span className="font-mono text-[10px] text-muted-foreground">
                        {reached ? timing : "—"}
                    </span>
                </div>
                <p
                    className={cn(
                        "truncate font-mono text-[10px] transition-colors",
                        reached ? "text-muted-foreground" : "text-muted-foreground/50",
                    )}
                >
                    {detail}
                </p>
            </div>
        </li>
    );
}

function LiveRow({ live }: { live: boolean }) {
    return (
        <motion.li
            animate={{
                opacity: live ? 1 : 0.4,
            }}
            transition={{ duration: 0.3 }}
            className="relative flex items-start gap-3"
        >
            <span
                className={cn(
                    "relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border bg-card",
                    live
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-border",
                )}
            >
                {live ? (
                    <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 320, damping: 18 }}
                    >
                        <Zap className="size-3 fill-emerald-500 text-emerald-500" />
                    </motion.span>
                ) : (
                    <span className="size-1.5 rounded-full bg-border" />
                )}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                    <p
                        className={cn(
                            "text-[12px] font-semibold",
                            live
                                ? "text-emerald-700 dark:text-emerald-300"
                                : "text-muted-foreground",
                        )}
                    >
                        Live · TTFB 180ms
                    </p>
                    <span className="font-mono text-[10px] text-muted-foreground">
                        14.2s total
                    </span>
                </div>
                <p
                    className={cn(
                        "font-mono text-[10px]",
                        live ? "text-muted-foreground" : "text-muted-foreground/50",
                    )}
                >
                    Served from the closest edge to every visitor.
                </p>
            </div>
        </motion.li>
    );
}
