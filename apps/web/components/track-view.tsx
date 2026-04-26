"use client";

import { useEffect, useRef } from "react";

/**
 * Fires a single POST /api/views/{handle} per mount. Idempotent within
 * a page load (useRef flag guards against Strict Mode double-effect).
 * The endpoint is a no-op for unpublished / nonexistent profiles, so
 * it's safe to render this even before publish completes.
 */
export function TrackView({ handle }: { handle: string }) {
  const hitRef = useRef(false);
  useEffect(() => {
    if (hitRef.current) return;
    hitRef.current = true;
    void fetch(`/api/views/${encodeURIComponent(handle)}`, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: window.location.pathname }),
    }).catch(() => {
      // Swallow — best-effort metric.
    });
  }, [handle]);
  return null;
}
