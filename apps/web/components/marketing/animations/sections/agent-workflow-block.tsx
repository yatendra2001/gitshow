"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, AnimatePresence } from "motion/react";
import { Rss } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Pull in your writing" block.
 *
 * Replaces the old AgentWorkflowBlock — a generic three-step pipeline
 * card — with a literal demonstration: a blog feed on the left, posts
 * flying right, landing as styled "Writing" cards on the user's
 * portfolio with syntax-highlighted code blocks intact.
 */

type Post = {
    title: string;
    date: string;
    readMin: number;
    tag: string;
    snippet: ReadonlyArray<{ tone: "key" | "fn" | "str" | "num" | "fg" | "mute"; text: string }[]>;
};

const POSTS: Post[] = [
    {
        title: "Cutting checkout p99 by 62% on Cloudflare Workers",
        date: "Mar 12",
        readMin: 7,
        tag: "Edge compute",
        snippet: [
            [
                { tone: "key", text: "export default " },
                { tone: "fg", text: "{" },
            ],
            [
                { tone: "mute", text: "  " },
                { tone: "fn", text: "fetch" },
                { tone: "fg", text: "(req, env) {" },
            ],
            [
                { tone: "mute", text: "    " },
                { tone: "key", text: "return " },
                { tone: "fn", text: "handleCheckout" },
                { tone: "fg", text: "(req)" },
            ],
            [{ tone: "fg", text: "  }" }],
            [{ tone: "fg", text: "}" }],
        ],
    },
    {
        title: "Postgres advisory locks for idempotent webhooks",
        date: "Feb 28",
        readMin: 5,
        tag: "PostgreSQL",
        snippet: [
            [
                { tone: "key", text: "SELECT " },
                { tone: "fn", text: "pg_advisory_xact_lock" },
                { tone: "fg", text: "(" },
            ],
            [
                { tone: "mute", text: "  " },
                { tone: "fn", text: "hashtextextended" },
                { tone: "fg", text: "(" },
                { tone: "str", text: "$1" },
                { tone: "fg", text: ", " },
                { tone: "num", text: "0" },
                { tone: "fg", text: ")" },
            ],
            [{ tone: "fg", text: ");" }],
        ],
    },
    {
        title: "Idempotency keys, but for an event-sourced ledger",
        date: "Feb 14",
        readMin: 9,
        tag: "Distributed systems",
        snippet: [
            [
                { tone: "key", text: "type " },
                { tone: "fn", text: "Idempotent" },
                { tone: "fg", text: "<" },
                { tone: "fn", text: "E" },
                { tone: "fg", text: "> = {" },
            ],
            [
                { tone: "mute", text: "  " },
                { tone: "fg", text: "key: " },
                { tone: "fn", text: "string" },
                { tone: "fg", text: ";" },
            ],
            [
                { tone: "mute", text: "  " },
                { tone: "fg", text: "envelope: " },
                { tone: "fn", text: "E" },
                { tone: "fg", text: ";" },
            ],
            [{ tone: "fg", text: "};" }],
        ],
    },
];

const POST_DELAY_MS = 700;
const FLY_DURATION_MS = 700;

export function AgentWorkflowBlock() {
    const containerRef = useRef<HTMLDivElement>(null);
    const inView = useInView(containerRef, { amount: 0.4, margin: "-80px" });
    const [arrived, setArrived] = useState<number[]>([]);
    const [flying, setFlying] = useState<number | null>(null);
    const timersRef = useRef<NodeJS.Timeout[]>([]);

    useEffect(() => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];

        if (!inView) {
            setArrived([]);
            setFlying(null);
            return;
        }

        POSTS.forEach((_, idx) => {
            const startT = setTimeout(() => setFlying(idx), 400 + idx * POST_DELAY_MS);
            const arriveT = setTimeout(() => {
                setArrived((prev) => [...prev, idx]);
                setFlying((current) => (current === idx ? null : current));
            }, 400 + idx * POST_DELAY_MS + FLY_DURATION_MS);
            timersRef.current.push(startT, arriveT);
        });

        return () => {
            timersRef.current.forEach(clearTimeout);
            timersRef.current = [];
        };
    }, [inView]);

    return (
        <div
            ref={containerRef}
            className="relative min-h-[400px] md:min-h-[500px] overflow-hidden p-6 md:p-10"
        >
            <div className="relative mx-auto grid w-full max-w-3xl grid-cols-1 gap-5 md:grid-cols-[1fr_auto_1.05fr] md:items-stretch md:gap-3">
                <BlogPanel flyingIdx={flying} arrived={arrived} />
                <PostStream active={flying !== null} />
                <WritingPanel arrived={arrived} />
            </div>
        </div>
    );
}

function BlogPanel({
    flyingIdx,
    arrived,
}: {
    flyingIdx: number | null;
    arrived: number[];
}) {
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2.5">
                <Rss className="size-3 text-muted-foreground" />
                <span className="font-mono text-[10px] text-muted-foreground">
                    blog.yatendra.dev
                </span>
                <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary">
                    {POSTS.length} posts
                </span>
            </div>
            <ul className="divide-y divide-border">
                {POSTS.map((post, idx) => {
                    const isArrived = arrived.includes(idx);
                    const isFlying = flyingIdx === idx;
                    return (
                        <BlogRow
                            key={post.title}
                            post={post}
                            flying={isFlying}
                            arrived={isArrived}
                        />
                    );
                })}
            </ul>
        </div>
    );
}

function BlogRow({
    post,
    flying,
    arrived,
}: {
    post: Post;
    flying: boolean;
    arrived: boolean;
}) {
    return (
        <motion.li
            animate={{
                backgroundColor: flying
                    ? "color-mix(in oklch, var(--primary) 6%, transparent)"
                    : "transparent",
            }}
            transition={{ duration: 0.25 }}
            className="relative flex items-start gap-2 px-3.5 py-3"
        >
            <span
                className={cn(
                    "mt-1 size-1.5 shrink-0 rounded-full",
                    arrived ? "bg-foreground/20" : "bg-primary",
                )}
            />
            <div className="min-w-0 flex-1">
                <p
                    className={cn(
                        "truncate text-[12px] font-medium leading-snug transition-opacity",
                        arrived ? "opacity-50" : "opacity-100",
                    )}
                >
                    {post.title}
                </p>
                <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                    {post.date} · {post.readMin} min read
                </p>
            </div>
            <AnimatePresence>
                {flying && (
                    <motion.span
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="font-mono text-[9px] text-primary"
                    >
                        importing…
                    </motion.span>
                )}
            </AnimatePresence>
        </motion.li>
    );
}

function PostStream({ active }: { active: boolean }) {
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

function WritingPanel({ arrived }: { arrived: number[] }) {
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2.5">
                <span className="size-2 rounded-full bg-red-500/80" />
                <span className="size-2 rounded-full bg-yellow-500/80" />
                <span className="size-2 rounded-full bg-green-500/80" />
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    gitshow.io/yatendra/writing
                </span>
            </div>
            <div className="space-y-2.5 p-3.5">
                <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    Writing · {arrived.length}/{POSTS.length}
                </p>
                <div className="space-y-2">
                    {POSTS.map((post, idx) => (
                        <WritingCard
                            key={post.title}
                            post={post}
                            visible={arrived.includes(idx)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function WritingCard({ post, visible }: { post: Post; visible: boolean }) {
    return (
        <motion.div
            initial={false}
            animate={{
                opacity: visible ? 1 : 0,
                y: visible ? 0 : 10,
                scale: visible ? 1 : 0.98,
            }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
                "overflow-hidden rounded-md border border-border bg-background",
                !visible && "pointer-events-none",
            )}
            aria-hidden={!visible}
        >
            <div className="border-b border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[11px] font-semibold leading-snug">
                        {post.title}
                    </p>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wider text-foreground">
                        {post.tag}
                    </span>
                </div>
                <p className="mt-0.5 font-mono text-[8px] text-muted-foreground">
                    {post.date} · {post.readMin} min · syntax preserved
                </p>
            </div>
            <CodeSnippet snippet={post.snippet} />
        </motion.div>
    );
}

const TONE_CLASSES: Record<"key" | "fn" | "str" | "num" | "fg" | "mute", string> = {
    key: "text-pink-500 dark:text-pink-300",
    fn: "text-sky-600 dark:text-sky-300",
    str: "text-emerald-600 dark:text-emerald-300",
    num: "text-amber-600 dark:text-amber-300",
    fg: "text-foreground",
    mute: "text-muted-foreground",
};

function CodeSnippet({ snippet }: { snippet: Post["snippet"] }) {
    return (
        <div className="bg-muted/40 px-3 py-2 font-mono text-[9px] leading-relaxed">
            {snippet.map((line, i) => (
                <div key={i}>
                    {line.map((seg, j) => (
                        <span key={j} className={TONE_CLASSES[seg.tone]}>
                            {seg.text}
                        </span>
                    ))}
                </div>
            ))}
        </div>
    );
}
