"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary for the entire admin subtree. Next.js's default
 * error.tsx convention catches anything thrown inside the segment —
 * server-component fetches, render-time exceptions, late binding
 * failures — and lets us render a useful message instead of the
 * generic "This page couldn't load" 500 overlay.
 *
 * For an operator surface this is doubly useful: we'd rather the
 * person debugging see the stack and digest hash than be locked out.
 *
 * `digest` is Next.js's request-correlated hash that also lands in the
 * Worker logs — pasting it into wrangler tail / observability search
 * jumps straight to the failing request.
 */
export default function AdminErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console so it's visible without ever
    // leaving the page. The Worker side already has structured logs
    // for every server fetch (see safeAwait in user detail page).
    console.error("[admin] unhandled error in admin subtree", error);
  }, [error]);

  return (
    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.04] p-5 my-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="text-[15px] font-semibold text-rose-600 dark:text-rose-400">
          Admin page crashed
        </h2>
        {error.digest ? (
          <code className="font-mono text-[10.5px] text-muted-foreground">
            digest={error.digest}
          </code>
        ) : null}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-snug text-rose-700/90 dark:text-rose-400/80 mb-4">
        {error.name ? `${error.name}: ` : ""}
        {error.message || "(no message)"}
        {error.stack
          ? `\n\n${error.stack.split("\n").slice(0, 12).join("\n")}`
          : ""}
      </pre>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex h-9 items-center rounded-lg border border-border/50 bg-card/60 px-3 text-[12.5px] font-medium hover:bg-card"
        >
          Retry
        </button>
        <Link
          href="/app/admin"
          className="inline-flex h-9 items-center rounded-lg border border-border/50 bg-card/60 px-3 text-[12.5px] font-medium hover:bg-card"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}
