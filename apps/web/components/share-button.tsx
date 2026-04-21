"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Floating share control for the public `/{handle}` page. Renders as
 * a small pill in the top-right; clicks open a dropdown with:
 *   - Copy link — writes the page URL to the clipboard
 *   - Share on X — prefilled tweet with the portfolio URL
 *   - Share on LinkedIn — LinkedIn's sharing URL helper
 *
 * The native `navigator.share` sheet is used when available (iOS /
 * Android / recent macOS) so the UX feels platform-first there, with
 * the dropdown as a fallback.
 */

export function ShareButton({
  handle,
  name,
}: {
  handle: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState<string>("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setUrl(window.location.origin + `/${handle}`);
  }, [handle]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* no-op */
    }
  }, [url]);

  const tryNativeShare = useCallback(async () => {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share({
          title: `${name} — gitshow`,
          text: `${name}'s portfolio`,
          url,
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }, [name, url]);

  const onShareClick = useCallback(async () => {
    const native = await tryNativeShare();
    if (!native) setOpen((v) => !v);
  }, [tryNativeShare]);

  const xUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(
    `${name}'s portfolio — `,
  )}&url=${encodeURIComponent(url)}`;
  const liUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
    url,
  )}`;

  return (
    <div ref={rootRef} className="fixed top-4 right-4 z-40">
      <button
        type="button"
        onClick={() => void onShareClick()}
        className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-card/80 backdrop-blur-sm px-3 py-1.5 text-[12px] text-foreground hover:bg-card transition-colors shadow-[var(--shadow-card)]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Share2 className="size-3.5" />
        Share
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 mt-2 w-56 rounded-xl border border-border/40 bg-card/95 backdrop-blur-md shadow-[var(--shadow-float)] overflow-hidden",
          )}
        >
          <button
            type="button"
            onClick={() => void onCopy()}
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] hover:bg-accent/40 transition-colors"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
            <span className="truncate">
              {copied ? "Link copied" : "Copy link"}
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground truncate max-w-24">
              /{handle}
            </span>
          </button>
          <a
            href={xUrl}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            className="flex items-center gap-2 px-3 py-2.5 text-[13px] hover:bg-accent/40 transition-colors border-t border-border/30"
          >
            <svg
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              className="size-3.5"
              fill="currentColor"
              aria-hidden
            >
              <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
            </svg>
            Share on X
          </a>
          <a
            href={liUrl}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            className="flex items-center gap-2 px-3 py-2.5 text-[13px] hover:bg-accent/40 transition-colors border-t border-border/30"
          >
            <Link2 className="size-3.5" />
            Share on LinkedIn
          </a>
        </div>
      ) : null}
    </div>
  );
}
