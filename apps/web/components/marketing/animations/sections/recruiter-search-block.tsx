"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView, AnimatePresence } from "motion/react";
import { Search, Sparkles } from "lucide-react";

/**
 * "Found by recruiters" feature block.
 *
 * Replaces the old DottedMap (a generic world-map of pings) with a
 * mock Google search result: a recruiter types a query, results fade
 * in, and gitshow.io is the highlighted #1 hit. Directly shows the
 * promise — "your name plus your stack gets you found."
 */

const QUERY = "rust distributed systems engineer";
const TYPE_SPEED_MS = 55;
const RESULTS_DELAY_MS = 350;

type Result = {
    domain: string;
    breadcrumb: string;
    title: string;
    description: string;
    chips?: string[];
    isPrimary?: boolean;
};

const RESULTS: Result[] = [
    {
        domain: "gitshow.io",
        breadcrumb: "gitshow.io › yatendra",
        title: "Yatendra Kumar — Staff Engineer · Distributed systems",
        description:
            "Backend engineer. 8 years on checkout, payments, real-time messaging at scale. 4,812 commits across 23 repos · last shipped Rust edge handler ↗",
        chips: ["Rust", "Edge compute", "PostgreSQL"],
        isPrimary: true,
    },
    {
        domain: "linkedin.com",
        breadcrumb: "linkedin.com › in › yatendra-kumar",
        title: "Yatendra Kumar – Staff Engineer | LinkedIn",
        description:
            "Experienced engineer with a demonstrated history of working in the internet industry. Skilled in Rust, Go, and distributed systems...",
    },
    {
        domain: "github.com",
        breadcrumb: "github.com › yatendra",
        title: "yatendra (Yatendra Kumar) · GitHub",
        description: "23 repositories · followed by 412 · pinned: checkout-edge, dotfiles, side-project-2024",
    },
];

export function RecruiterSearchBlock() {
    const containerRef = useRef<HTMLDivElement>(null);
    const inView = useInView(containerRef, { amount: 0.4, margin: "-80px" });

    const [typed, setTyped] = useState("");
    const [showResults, setShowResults] = useState(false);
    const timersRef = useRef<NodeJS.Timeout[]>([]);

    useEffect(() => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];

        if (!inView) {
            setTyped("");
            setShowResults(false);
            return;
        }

        for (let i = 1; i <= QUERY.length; i++) {
            const t = setTimeout(() => setTyped(QUERY.slice(0, i)), i * TYPE_SPEED_MS);
            timersRef.current.push(t);
        }
        const showT = setTimeout(
            () => setShowResults(true),
            QUERY.length * TYPE_SPEED_MS + RESULTS_DELAY_MS,
        );
        timersRef.current.push(showT);

        return () => {
            timersRef.current.forEach(clearTimeout);
            timersRef.current = [];
        };
    }, [inView]);

    const isTyping = useMemo(() => typed.length < QUERY.length, [typed]);

    return (
        <div
            ref={containerRef}
            className="relative min-h-[400px] md:min-h-[500px] overflow-hidden p-6 md:p-10"
        >
            <div className="relative mx-auto w-full max-w-xl">
                <SearchCard
                    typed={typed}
                    isTyping={isTyping}
                    showResults={showResults}
                />
                <RankBadge show={showResults} />
            </div>
        </div>
    );
}

function SearchCard({
    typed,
    isTyping,
    showResults,
}: {
    typed: string;
    isTyping: boolean;
    showResults: boolean;
}) {
    return (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                <span className="size-2 rounded-full bg-red-500/80" />
                <span className="size-2 rounded-full bg-yellow-500/80" />
                <span className="size-2 rounded-full bg-green-500/80" />
                <span className="ml-2 truncate font-mono text-[10px] text-muted-foreground">
                    google.com / search
                </span>
            </div>

            <div className="space-y-5 p-5 md:p-6">
                <div className="flex items-center gap-3 rounded-full border border-border bg-background px-4 py-2.5 shadow-sm">
                    <Search className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">
                        <span className="text-foreground">{typed}</span>
                        {isTyping && (
                            <motion.span
                                animate={{ opacity: [0, 1, 1, 0] }}
                                transition={{ duration: 0.9, repeat: Infinity }}
                                className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-foreground"
                            />
                        )}
                    </span>
                    <span className="hidden font-mono text-[9px] uppercase tracking-wider text-muted-foreground sm:inline">
                        Recruiter · Stripe Talent
                    </span>
                </div>

                <div className="space-y-4">
                    <AnimatePresence>
                        {showResults &&
                            RESULTS.map((r, idx) => (
                                <motion.div
                                    key={r.domain}
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{
                                        delay: idx * 0.18,
                                        duration: 0.4,
                                        ease: [0.22, 1, 0.36, 1],
                                    }}
                                >
                                    <ResultRow result={r} primary={!!r.isPrimary} />
                                </motion.div>
                            ))}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}

function ResultRow({ result, primary }: { result: Result; primary: boolean }) {
    if (primary) {
        return (
            <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-b from-primary/[0.06] via-transparent to-transparent p-4">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
                <div className="flex items-center gap-2">
                    <DomainFavicon domain={result.domain} highlight />
                    <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-foreground">
                            {result.domain}
                        </p>
                        <p className="truncate text-[10px] text-muted-foreground">
                            {result.breadcrumb}
                        </p>
                    </div>
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary-foreground">
                        <Sparkles className="size-2.5" />
                        Top hit
                    </span>
                </div>
                <h4 className="mt-2 text-[15px] font-semibold leading-snug tracking-tight text-foreground">
                    {result.title}
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {result.description}
                </p>
                {result.chips ? (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                        {result.chips.map((chip) => (
                            <span
                                key={chip}
                                className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-medium text-foreground"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className="px-1">
            <div className="flex items-center gap-2">
                <DomainFavicon domain={result.domain} />
                <div className="min-w-0">
                    <p className="truncate text-[11px] text-muted-foreground/80">
                        {result.domain}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground/60">
                        {result.breadcrumb}
                    </p>
                </div>
            </div>
            <h4 className="mt-1 text-[13px] font-medium leading-snug text-foreground/80">
                {result.title}
            </h4>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
                {result.description}
            </p>
        </div>
    );
}

function DomainFavicon({ domain, highlight = false }: { domain: string; highlight?: boolean }) {
    const letter = domain.charAt(0).toUpperCase();
    return (
        <span
            className={
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold " +
                (highlight
                    ? "bg-gradient-to-br from-sky-400 to-violet-500 text-white"
                    : "bg-muted text-muted-foreground")
            }
        >
            {letter}
        </span>
    );
}

function RankBadge({ show }: { show: boolean }) {
    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.85, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{
                        delay: 0.55,
                        type: "spring",
                        stiffness: 280,
                        damping: 22,
                    }}
                    className="pointer-events-none absolute -bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-medium text-foreground shadow-lg"
                >
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Indexed by Google · ranks above LinkedIn
                </motion.div>
            )}
        </AnimatePresence>
    );
}
