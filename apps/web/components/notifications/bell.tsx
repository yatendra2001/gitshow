"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * In-app notification bell. Fetches /api/notifications on mount and
 * every 30s while the tab is visible. Shows a dot when unread > 0.
 * Click opens a panel; individual click marks-read and navigates to
 * action_url. "Mark all read" nukes the badge.
 *
 * Mobile-first: panel anchors to the top-right on desktop, falls back
 * to a bottom sheet on screens narrower than ~640px.
 */

interface Notification {
  id: string;
  kind: string;
  scan_id: string | null;
  title: string;
  body: string | null;
  action_url: string | null;
  read: boolean;
  created_at: number;
}

interface ApiResponse {
  notifications: Notification[];
  unread_count: number;
}

const POLL_INTERVAL_MS = 30_000;

export function NotificationBell({ className = "" }: { className?: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const resp = await fetch("/api/notifications?limit=20", {
        cache: "no-store",
      });
      if (!resp.ok) return;
      const data = (await resp.json()) as ApiResponse;
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
    } catch {
      // Silent failure — the bell just stays stale until next poll.
    } finally {
      setLoading(false);
    }
  }, []);

  // Mount + 30s polling (only while tab is visible, to save battery).
  useEffect(() => {
    void fetchNotifications();
    const schedulePoll = () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await fetchNotifications();
        }
        schedulePoll();
      }, POLL_INTERVAL_MS);
    };
    schedulePoll();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchNotifications();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchNotifications]);

  // Click outside to close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const markOne = useCallback(async (id: string) => {
    // Optimistic.
    setNotifications((ns) => ns.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
    } catch {
      /* revert handled by next fetch */
    }
  }, []);

  const markAll = useCallback(async () => {
    // Optimistic.
    setNotifications((ns) => ns.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-all-read" }),
      });
    } catch {
      /* revert on next fetch */
    }
  }, []);

  const onNotificationClick = useCallback(
    async (n: Notification) => {
      if (!n.read) void markOne(n.id);
      if (n.action_url) {
        window.location.href = n.action_url;
      } else {
        setOpen(false);
      }
    },
    [markOne],
  );

  return (
    <div ref={panelRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        className="relative inline-flex items-center justify-center h-9 w-9 rounded-xl border border-border/40 bg-card/60 text-muted-foreground transition-[color,box-shadow] duration-200 hover:text-foreground hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span
            aria-hidden
            className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[var(--destructive)] ring-2 ring-[var(--card)]"
          />
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-2 bottom-2 max-h-[70vh] z-50 sm:absolute sm:inset-auto sm:right-0 sm:top-[calc(100%+8px)] sm:bottom-auto sm:w-96 sm:max-h-[520px] rounded-2xl border border-border/40 bg-popover text-popover-foreground shadow-[var(--shadow-float)] overflow-hidden flex flex-col gs-enter"
        >
          <header className="flex items-center justify-between px-4 py-3 border-b border-border/30">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Notifications</span>
              {unreadCount > 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  {unreadCount} unread
                </span>
              ) : null}
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAll}
                className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Mark all read
              </button>
            ) : null}
          </header>

          <div className="overflow-y-auto flex-1 gs-pane-scroll">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                {loading ? (
                  <span className="gs-shimmer">Loading…</span>
                ) : (
                  "You're all caught up."
                )}
              </div>
            ) : (
              <ul className="divide-y divide-border/30">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void onNotificationClick(n)}
                      className={`w-full text-left px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40 ${
                        n.read ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <KindDot kind={n.kind} read={n.read} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium leading-snug truncate">
                            {n.title}
                          </div>
                          {n.body ? (
                            <div className="text-[12px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">
                              {n.body}
                            </div>
                          ) : null}
                          <div className="text-[11px] text-muted-foreground/70 mt-1">
                            {formatRelative(n.created_at)}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────

function BellIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="16"
      height="16"
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

function KindDot({ kind, read }: { kind: string; read: boolean }) {
  const color =
    kind === "scan-failed"
      ? "bg-[var(--destructive)]"
      : kind === "agent-question"
        ? "bg-[var(--chart-4)]"
        : "bg-[var(--primary)]";
  return (
    <span
      aria-hidden
      className={`mt-1.5 h-1.5 w-1.5 rounded-full ${color} ${read ? "opacity-30" : ""}`}
    />
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
