"use client";

import { CheckCircle2, Globe, Lock } from "lucide-react";

/**
 * Custom-domain settings card. Renders in the WorkflowConnect section
 * where the user is promised "Your portfolio, your domain." — shows
 * what that configuration UI actually feels like: domain input, DNS
 * CNAME hint, live status badge, SSL indicator.
 *
 * The prop `popoverPosition` is kept for interface parity with the
 * old IntegrationBlock (so the section doesn't need refactoring) but
 * is unused here — this card doesn't need a popover.
 */
export function IntegrationBlock({
    popoverPosition: _popoverPosition = "top",
}: {
    popoverPosition?: "top" | "bottom";
}) {
    return (
        <div className="relative min-h-[400px] md:min-h-[500px] flex items-center justify-center p-6 md:p-12 overflow-visible">
            <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                    <div>
                        <h4 className="text-sm font-semibold">Custom domain</h4>
                        <p className="text-[11px] text-muted-foreground">
                            Pro plan — connected
                        </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-current" />
                        Live
                    </span>
                </div>

                <div className="space-y-4 p-5">
                    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5 font-mono text-sm">
                        <Globe className="size-4 text-muted-foreground" />
                        <span className="flex-1">yatendra.dev</span>
                        <CheckCircle2 className="size-4 text-primary" />
                    </div>

                    <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            DNS · CNAME
                        </p>
                        <div className="mt-2 grid grid-cols-[auto_auto_1fr] items-center gap-x-3 gap-y-1 font-mono text-[11px]">
                            <span className="text-muted-foreground">name</span>
                            <span className="text-foreground">@</span>
                            <span />
                            <span className="text-muted-foreground">value</span>
                            <span className="text-foreground">
                                cname.gitshow.io
                            </span>
                            <CheckCircle2 className="size-3 text-primary justify-self-start" />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div className="rounded-md border border-border bg-card p-2.5">
                            <p className="text-muted-foreground">SSL</p>
                            <p className="font-medium inline-flex items-center gap-1">
                                <Lock className="size-3 text-primary" />
                                Active
                            </p>
                        </div>
                        <div className="rounded-md border border-border bg-card p-2.5">
                            <p className="text-muted-foreground">TTFB</p>
                            <p className="font-medium">180ms</p>
                        </div>
                        <div className="rounded-md border border-border bg-card p-2.5">
                            <p className="text-muted-foreground">Region</p>
                            <p className="font-medium">Edge ×280</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
