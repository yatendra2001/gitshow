"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Enable desktop alerts" — one-button permission flow for Web Push.
 *
 * Hidden entirely when:
 *   - The browser doesn't support Push / service workers, or
 *   - /api/push/vapid-key returns { enabled: false } (no VAPID keys
 *     configured on the server), or
 *   - Permission is already granted AND a subscription is stored.
 *
 * Failure modes surface inline — if permission is denied the button
 * becomes a disabled hint; users can re-enable via browser settings.
 */

type Supported = "unknown" | "yes" | "no";
type Permission = NotificationPermission | "unknown";

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const normalized = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function PushEnableButton({ className = "" }: { className?: string }) {
  const [supported, setSupported] = useState<Supported>("unknown");
  const [permission, setPermission] = useState<Permission>("unknown");
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Environment checks.
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        if (!cancelled) setSupported("no");
        return;
      }
      if (!cancelled) setSupported("yes");
      if (!cancelled) setPermission(Notification.permission);

      // Check server VAPID config.
      try {
        const r = await fetch("/api/push/vapid-key", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as {
          enabled: boolean;
          public_key?: string;
        };
        if (!data.enabled || !data.public_key) {
          if (!cancelled) setVapidKey(null);
          return;
        }
        if (!cancelled) setVapidKey(data.public_key);
      } catch {
        /* silent — feature just stays hidden */
      }

      // Existing subscription?
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) {
          if (!cancelled) setSubscribed(false);
          return;
        }
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(Boolean(sub));
      } catch {
        if (!cancelled) setSubscribed(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!vapidKey) return;
    setBusy(true);
    try {
      const reg =
        (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // The runtime happily accepts Uint8Array; the typings disagree
        // with Safari's older shape so we cast to BufferSource.
        applicationServerKey: urlBase64ToUint8Array(
          vapidKey,
        ) as unknown as BufferSource,
      });

      const raw = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      // Safari can return the keys as ArrayBuffers; normalize.
      const p256dh =
        raw.keys?.p256dh ??
        arrayBufferToBase64(sub.getKey("p256dh") as ArrayBuffer);
      const authToken =
        raw.keys?.auth ??
        arrayBufferToBase64(sub.getKey("auth") as ArrayBuffer);

      const resp = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: { p256dh, auth: authToken },
          user_agent: navigator.userAgent,
        }),
      });
      if (resp.ok) setSubscribed(true);
    } finally {
      setBusy(false);
    }
  }, [vapidKey]);

  // Render decisions.
  if (supported !== "yes" || !vapidKey) return null;
  if (subscribed && permission === "granted") return null;

  if (permission === "denied") {
    return (
      <div
        className={`text-[12px] text-muted-foreground ${className}`}
        aria-live="polite"
      >
        Desktop alerts are blocked. Enable them in your browser settings.
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={enable}
      disabled={busy}
      className={`inline-flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 px-3 py-1.5 text-[12px] text-muted-foreground transition-[color,box-shadow] duration-200 hover:text-foreground hover:shadow-[var(--shadow-card)] disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      <BellSmall />
      {busy ? "Enabling…" : "Turn on desktop alerts"}
    </button>
  );
}

function BellSmall() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
