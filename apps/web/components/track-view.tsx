"use client";

import { useEffect, useRef } from "react";

/**
 * Fires a single POST /api/views/{handle} per mount. Idempotent within
 * a page load (useRef flag guards against Strict Mode double-effect).
 *
 * Sends `path` and `referrer` in the body. The server prefers the HTTP
 * Referer header but falls back to `document.referrer` from this body
 * — that JS API often survives when in-app browsers (LinkedIn,
 * Instagram, etc.) strip the HTTP Referer header for privacy.
 *
 * The endpoint is a no-op for unpublished / nonexistent profiles, so
 * it's safe to render this even before publish completes.
 */
export function TrackView({ handle }: { handle: string }) {
  const hitRef = useRef(false);
  useEffect(() => {
    if (hitRef.current) return;
    hitRef.current = true;
    const path = window.location.pathname + window.location.search;
    const referrer = document.referrer || null;
    // Tell the server which hostname the user actually loaded on so the
    // dashboard can attribute traffic to a custom domain vs gitshow.io.
    // The middleware also injects `x-gs-served-hostname`; the body is a
    // belt-and-braces fallback for cases where the rewrite path drops it.
    const host = window.location.host;
    void fetch(`/api/views/${encodeURIComponent(handle)}`, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, referrer, host }),
    }).catch(() => {
      // Swallow — best-effort metric.
    });
  }, [handle]);
  return null;
}
