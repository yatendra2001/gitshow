"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
    ArrowUpRight,
    Check,
    GitBranch,
    GitCommit,
    GitPullRequest,
    Globe,
    Loader2,
    MessageSquare,
    Plus,
    Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TypingAnimation } from "@/components/marketing/ui/typing-animation";

/**
 * One persistent "GitShow Console" card that morphs through the
 * three Connect → Review → Share steps. Mirrors the codeforge
 * PlanSearchCard pattern (a single surface that evolves) but
 * uses gitshow vocabulary — repo/PR/review indexing and a live
 * portfolio URL — and lives in the marketing palette (sky
 * primary, mono labels, soft border, no fabricated browser
 * chrome).
 *
 * The parent section drives everything via the `step` prop. Each
 * step toggles one piece of the surface:
 *
 *   step = 0   Sign-in repo line  + idle/connecting status pill
 *   step = 1   Sources popover open + reading PRs/reviews
 *   step = 2   Typing share-URL animation + green Live pulse
 */

export type ConnectStep = 0 | 1 | 2;

type ConnectConsoleProps = {
    step: ConnectStep;
    /** Whether the console is in view at all. Drives the
     * idle → connecting → connected transition on step 0. */
    inView: boolean;
    className?: string;
};

const SHARE_URLS = [
    "gitshow.io/yatendra",
    "yatendra.dev",
    "yourname.com",
];

export function ConnectConsole({ step, inView, className }: ConnectConsoleProps) {
    const status = useConnectionStatus(inView);

    const showSourcesPopover = step === 1;
    const showLive = step === 2;
    const showTyping = step === 2;

    return (
        <div
            className={cn(
                "relative w-full max-w-md",
                className,
            )}
        >
            <ConsoleStatusPill status={status} live={showLive} />

            <div className="relative w-full rounded-2xl border border-border bg-card px-5 py-5 shadow-xl shadow-black/4">
                <div className="flex flex-col gap-5">
                    <ConsolePrompt
                        step={step}
                        showTyping={showTyping}
                    />

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <ConsoleIconButton aria-label="Attach">
                                <Plus className="size-4" />
                            </ConsoleIconButton>
                            <ConsoleIconButton aria-label="Public">
                                <Globe className="size-4" />
                            </ConsoleIconButton>

                            <div className="relative">
                                <SourcesPopover open={showSourcesPopover} />
                                <button
                                    type="button"
                                    className={cn(
                                        "flex items-center gap-1.5 h-8 px-2.5 rounded-full border border-transparent text-xs font-medium text-muted-foreground transition-colors",
                                        showSourcesPopover && "bg-muted border-border text-foreground",
                                    )}
                                >
                                    <GitBranch className="size-3.5" />
                                    <span>Sources</span>
                                </button>
                            </div>
                        </div>

                        <SubmitButton step={step} />
                    </div>
                </div>
            </div>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* Prompt line — morphs across steps                                          */
/* -------------------------------------------------------------------------- */

function ConsolePrompt({
    step,
    showTyping,
}: {
    step: ConnectStep;
    showTyping: boolean;
}) {
    const label =
        step === 0
            ? "Connect a GitHub repository"
            : step === 1
                ? "Reading commits, PRs, and reviews…"
                : "Share your portfolio";

    return (
        <div className="flex min-h-[52px] flex-col justify-center">
            <AnimatePresence mode="wait">
                {showTyping ? (
                    <motion.div
                        key="typing"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        className="flex items-center gap-2 font-mono text-sm leading-tight text-foreground"
                    >
                        <span className="text-muted-foreground">https://</span>
                        <TypingAnimation
                            words={SHARE_URLS}
                            loop
                            startOnView={false}
                            duration={70}
                            pauseDelay={1400}
                            className="text-sm leading-tight tracking-normal text-foreground"
                        />
                    </motion.div>
                ) : (
                    <motion.p
                        key={`label-${step}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        className={cn(
                            "text-sm font-medium leading-tight",
                            step === 1 ? "text-foreground" : "text-muted-foreground",
                        )}
                    >
                        {label}
                    </motion.p>
                )}
            </AnimatePresence>

            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {step === 0 && "github.com / authorize"}
                {step === 1 && "indexing your work"}
                {step === 2 && "live · edge-served · seo-indexed"}
            </p>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* Floating status pill — Connecting / Connected / Live                       */
/* -------------------------------------------------------------------------- */

type ConnectionStatus = "idle" | "connecting" | "connected";

function ConsoleStatusPill({
    status,
    live,
}: {
    status: ConnectionStatus;
    live: boolean;
}) {
    // "Live" trumps the connect lifecycle on step 3.
    const visible = live || status === "connecting" || status === "connected";
    const label = live ? "Live" : status === "connecting" ? "Connecting" : "Connected";
    const stateKey = live ? "live" : status;

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    key={stateKey}
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                    className="absolute left-1/2 -top-3.5 -translate-x-1/2 z-20"
                >
                    <div
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-3 py-1 text-xs font-semibold text-white",
                            "bg-linear-to-b from-sky-500 to-sky-600",
                            "ring-2 ring-sky-600/80",
                            "shadow-[0px_1px_2px_rgba(0,0,0,0.10),0px_2px_4px_rgba(0,0,0,0.04),inset_0px_0px_1.5px_#0084D1,inset_0px_2px_0px_rgba(255,255,255,0.14)]",
                        )}
                    >
                        <span className="flex size-4 items-center justify-center">
                            {live ? (
                                <span className="relative inline-flex size-2.5 items-center justify-center">
                                    <span className="absolute inset-0 animate-ping rounded-full bg-white/70" />
                                    <span className="relative inline-flex size-2 rounded-full bg-white" />
                                </span>
                            ) : status === "connecting" ? (
                                <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                                <span className="flex size-3.5 items-center justify-center rounded-full bg-white">
                                    <Check className="size-2.5 stroke-3 text-sky-600" />
                                </span>
                            )}
                        </span>
                        <span className="leading-none">{label}</span>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

/* -------------------------------------------------------------------------- */
/* Sources popover — shows what GitShow indexes from your account             */
/* -------------------------------------------------------------------------- */

const SOURCE_ITEMS: Array<{
    name: string;
    detail: string;
    icon: React.ComponentType<{ className?: string }>;
}> = [
        { name: "Repositories", detail: "23 indexed", icon: GitBranch },
        { name: "Pull requests", detail: "1.2k reviewed", icon: GitPullRequest },
        { name: "Code reviews", detail: "3.4k threads", icon: MessageSquare },
        { name: "Commits", detail: "12.8k authored", icon: GitCommit },
    ];

function SourcesPopover({ open }: { open: boolean }) {
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="absolute top-full left-0 mt-3 w-[280px] md:w-[320px] overflow-hidden rounded-2xl border border-border bg-popover/95 backdrop-blur-xl shadow-badge z-30"
                    role="dialog"
                    aria-label="Sources GitShow indexes"
                >
                    <div className="flex flex-col divide-y divide-border">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <div className="w-full pl-9 pr-3 py-3 text-xs text-muted-foreground">
                                Sources GitShow reads
                            </div>
                        </div>
                        {SOURCE_ITEMS.map((item) => {
                            const Icon = item.icon;
                            return (
                                <div
                                    key={item.name}
                                    className="flex items-center gap-3 px-3 py-2.5"
                                >
                                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60">
                                        <Icon className="size-3.5 text-foreground" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium text-foreground">
                                            {item.name}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {item.detail}
                                        </p>
                                    </div>
                                    <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-300">
                                        Read-only
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

/* -------------------------------------------------------------------------- */
/* Toolbar primitives                                                         */
/* -------------------------------------------------------------------------- */

function ConsoleIconButton({
    children,
    "aria-label": ariaLabel,
}: {
    children: React.ReactNode;
    "aria-label": string;
}) {
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
            {children}
        </button>
    );
}

function SubmitButton({ step }: { step: ConnectStep }) {
    const isShare = step === 2;
    return (
        <button
            type="button"
            className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                "bg-foreground text-background",
                "hover:bg-foreground/90",
            )}
        >
            <span>{isShare ? "Copy link" : step === 1 ? "Generate" : "Continue"}</span>
            <ArrowUpRight className="size-3.5" />
        </button>
    );
}

/* -------------------------------------------------------------------------- */
/* Hook — drives the idle → connecting → connected lifecycle                  */
/* -------------------------------------------------------------------------- */

function useConnectionStatus(inView: boolean): ConnectionStatus {
    const [status, setStatus] = useState<ConnectionStatus>("idle");

    useEffect(() => {
        if (!inView) {
            setStatus("idle");
            return;
        }
        // Tiny delay so the pill animates in *after* the card.
        const startTimer = setTimeout(() => setStatus("connecting"), 200);
        const finishTimer = setTimeout(() => setStatus("connected"), 1800);
        return () => {
            clearTimeout(startTimer);
            clearTimeout(finishTimer);
        };
    }, [inView]);

    return status;
}
