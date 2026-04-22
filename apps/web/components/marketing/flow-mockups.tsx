/**
 * Flow-step mockups for the "Sign in · Generate · Share" Connect
 * section. Each mockup is a credible, static snapshot of that step's
 * real UI — meant to sit on the sticky left column and rotate as the
 * user scrolls through the three text steps on the right.
 *
 * OAuth scopes shown here must match what `apps/web/auth.ts` actually
 * requests so the copy isn't lying.
 */

import { ArrowUpRight, CheckCircle2 } from "lucide-react";

export function SignInFlowMockup() {
    return (
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-5 space-y-1.5 text-center">
                <h3 className="text-base font-semibold">Sign in to GitShow</h3>
                <p className="text-xs text-muted-foreground">
                    We only read commit metadata. Never source code.
                </p>
            </div>
            <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background"
            >
                <svg
                    viewBox="0 0 24 24"
                    className="size-4"
                    fill="currentColor"
                    aria-hidden
                >
                    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-1.97c-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.33.95.1-.74.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18.92-.26 1.9-.38 2.88-.39.98.01 1.96.13 2.88.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.22 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
                </svg>
                <span>Continue with GitHub</span>
            </button>
            <div className="mt-5 space-y-1.5 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
                <p className="font-medium text-foreground">OAuth scopes</p>
                <p className="font-mono">read:user · user:email · repo</p>
                <p>Enough to read your repos (public + private + org).</p>
            </div>
        </div>
    );
}

export function PipelineFlowMockup() {
    const tasks = [
        { label: "Indexed repositories", count: "23", done: true },
        { label: "Read commits", count: "4,812", done: true },
        { label: "Extracted PRs & reviews", count: "1,204", done: true },
        { label: "Writing portfolio…", count: "72%", done: false },
    ];
    return (
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
                <p className="text-xs font-mono text-muted-foreground">
                    github.com/yatendra
                </p>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    12 min remaining
                </span>
            </div>
            <ul className="space-y-3">
                {tasks.map((t) => (
                    <li
                        key={t.label}
                        className="flex items-center justify-between gap-3 text-sm"
                    >
                        <div className="flex items-center gap-2.5">
                            {t.done ? (
                                <CheckCircle2 className="size-4 text-primary" />
                            ) : (
                                <span className="relative flex size-4 items-center justify-center">
                                    <span className="absolute inline-flex size-3 animate-ping rounded-full bg-primary/40" />
                                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                                </span>
                            )}
                            <span>{t.label}</span>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                            {t.count}
                        </span>
                    </li>
                ))}
            </ul>
            <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-[72%] rounded-full bg-foreground/80" />
            </div>
        </div>
    );
}

export function PublishFlowMockup() {
    return (
        <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
                <span className="size-2 rounded-full bg-red-500/80" />
                <span className="size-2 rounded-full bg-yellow-500/80" />
                <span className="size-2 rounded-full bg-green-500/80" />
                <div className="ml-3 flex flex-1 items-center gap-1 rounded-md bg-background px-3 py-1 font-mono text-[11px] text-muted-foreground">
                    <span className="text-primary">https://</span>
                    <span>gitshow.io/yatendra</span>
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-current" />
                        Live
                    </span>
                </div>
            </div>
            <div className="space-y-4 p-5">
                <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        Engineer · 8 yrs · 4,812 commits
                    </p>
                    <h4 className="mt-1 text-xl font-semibold tracking-tight">
                        Yatendra Kumar
                    </h4>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        Backend engineer. Ships distributed systems at scale.
                        Currently focused on checkout performance.
                    </p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                    >
                        Share
                        <ArrowUpRight className="size-3" />
                    </button>
                    <p className="text-[11px] text-muted-foreground">
                        Indexed by Google · 412 visits this week
                    </p>
                </div>
            </div>
        </div>
    );
}
