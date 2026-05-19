"use client";

import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useSession } from "@/lib/auth-client";

/**
 * Client-side PostHog — the growth funnel (acquisition → activation →
 * revenue).
 *
 * Key/host are passed as **props from the server layout**, not read
 * from `process.env` here. Reason: with Turbopack pinned at the
 * monorepo root + OpenNext, `NEXT_PUBLIC_*` does not reliably inline
 * into the client bundle (verified: server sees the env, client
 * bundle doesn't). The server component reads `process.env` at
 * runtime — deterministic in `next dev` (.env.local) and in the
 * OpenNext Worker (wrangler.jsonc vars) — and hands the (public,
 * write-only) token down as a prop. No key → no-op, site unchanged.
 *
 * `$pageview` is captured manually (App Router client nav). UTM
 * params ride every pageview automatically — that's what attributes
 * the "Built with gitshow" badge loop and organic SEO.
 */

let started = false;
function ensureInit(key?: string, host?: string) {
  if (started || !key || typeof window === "undefined") return;
  started = true;
  posthog.init(key, {
    api_host: host || "https://us.i.posthog.com",
    // App Router → we fire $pageview ourselves on route change.
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    // Cheap: anonymous funnel events still flow; person profiles only
    // for signed-in users.
    person_profiles: "identified_only",
  });
}

function isReady(): boolean {
  // Check the imported instance, NOT window.posthog — the npm SDK
  // (unlike the HTML snippet) never assigns the global, so a
  // window.posthog check would falsely no-op every funnel event even
  // though PostHog is fully initialized.
  return (
    typeof window !== "undefined" &&
    (posthog as unknown as { __loaded?: boolean }).__loaded === true
  );
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!isReady()) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);
  return null;
}

function IdentifyOnAuth() {
  const { data } = useSession();
  useEffect(() => {
    if (!isReady()) return;
    const user = data?.user as
      | { id?: string; login?: string | null; email?: string; name?: string }
      | undefined;
    if (user?.id) {
      // Prefer the GitHub login so the client funnel lines up with the
      // worker's server-side scan events (which key on the handle).
      posthog.identify(user.login || user.id, {
        github_login: user.login ?? undefined,
        email: user.email,
        name: user.name,
      });
    }
  }, [data?.user]);
  return null;
}

export function PostHogProvider({
  children,
  posthogKey,
  posthogHost,
}: {
  children: React.ReactNode;
  posthogKey?: string;
  posthogHost?: string;
}) {
  useEffect(() => {
    ensureInit(posthogKey, posthogHost);
  }, [posthogKey, posthogHost]);

  if (!posthogKey) return <>{children}</>;

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      <IdentifyOnAuth />
      {children}
    </PHProvider>
  );
}

/**
 * Fire-and-forget event on mount. For server-rendered surfaces with
 * no natural click handler (e.g. the claim page view). No-ops until
 * PostHog has initialized.
 */
export function CaptureOnMount({
  event,
  properties,
}: {
  event: string;
  properties?: Record<string, unknown>;
}) {
  useEffect(() => {
    if (!isReady()) return;
    posthog.capture(event, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Imperative capture helper — safe to call anywhere, no-ops if PostHog is off. */
export function track(event: string, properties?: Record<string, unknown>) {
  if (!isReady()) return;
  posthog.capture(event, properties);
}
