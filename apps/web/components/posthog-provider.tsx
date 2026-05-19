"use client";

import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useSession } from "@/lib/auth-client";

/**
 * Client-side PostHog — the growth funnel (acquisition → activation →
 * revenue). Mirrors the server client's contract (packages/shared/
 * cloud/posthog.ts): **env-gated, no-op when the key is absent**, so
 * the site runs identically with or without analytics. The founder
 * flips it on by setting `NEXT_PUBLIC_POSTHOG_KEY` (the public
 * `phc_…` project key — safe to expose) and optionally
 * `NEXT_PUBLIC_POSTHOG_HOST` in the production env.
 *
 * `$pageview` is captured manually because the App Router does
 * client-side nav that posthog-js's default single-shot pageview
 * misses. UTM params ride on every pageview automatically — that's
 * what attributes the "Built with gitshow" badge loop
 * (utm_source=portfolio_badge) and organic SEO.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let started = false;
function ensureInit() {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;
  posthog.init(KEY, {
    api_host: HOST,
    // App Router → we fire $pageview ourselves on route change.
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    // Cheap: anonymous funnel events still flow; person profiles only
    // for signed-in users.
    person_profiles: "identified_only",
  });
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!KEY) return;
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
    if (!KEY) return;
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

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    ensureInit();
  }, []);

  if (!KEY) return <>{children}</>;

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
 * Fire-and-forget event on mount. Use for server-rendered surfaces
 * that have no natural click handler (e.g. the claim page view).
 * No-ops without the key.
 */
export function CaptureOnMount({
  event,
  properties,
}: {
  event: string;
  properties?: Record<string, unknown>;
}) {
  useEffect(() => {
    if (!KEY) return;
    posthog.capture(event, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Imperative capture helper — safe to call anywhere, no-ops without key. */
export function track(event: string, properties?: Record<string, unknown>) {
  if (!KEY || typeof window === "undefined") return;
  posthog.capture(event, properties);
}
