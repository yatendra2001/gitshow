"use client";

import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import type { MarketingAuth } from "@/lib/marketing-auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/marketing/ui/button";

/**
 * Landing-page primary CTA — flips between "Sign in with GitHub" and
 * "Open dashboard" based on the live Better Auth session.
 *
 * Runtime notes:
 *   Prod (OpenNext Workers): `/api/auth/get-session` returns in ~100ms
 *   against a warm Cloudflare context, so the CTA label swaps almost
 *   immediately after hydration.
 *
 *   Local `next dev`: `getCloudflareContext({ async: true })` can stall
 *   for tens of seconds on cold boots. That's a dev-only quirk — it
 *   never blocks render because the hook's initial state is
 *   signed-out, so the CTA is always clickable. It just means a
 *   signed-in visitor sees "Sign in with GitHub" for a few seconds
 *   instead of "Open dashboard" until the session fetch eventually
 *   resolves. Use `opennextjs-cloudflare preview` if you want the
 *   prod behaviour locally.
 *
 * Better Auth's `useSession()` shares a single store across hook
 * instances, so the five AuthCta call sites on the landing dedupe
 * to one network call per visitor.
 */

const SIGNED_OUT: MarketingAuth = {
    label: "Sign in with GitHub",
    href: "/signin",
};
const SIGNED_IN: MarketingAuth = {
    label: "Open dashboard",
    href: "/app",
};

export function useMarketingAuth(): MarketingAuth {
    const { data: session } = useSession();
    return session?.user?.id ? SIGNED_IN : SIGNED_OUT;
}

type CtaVariant = "pill" | "nav" | "mobile-nav";

export function AuthCta({
    variant = "pill",
    onClick,
    className,
}: {
    variant?: CtaVariant;
    onClick?: () => void;
    className?: string;
}) {
    const auth = useMarketingAuth();

    if (variant === "pill") {
        return (
            <Button
                asChild
                size="lg"
                className={cn(
                    "rounded-full px-8 py-6 text-base font-medium text-white",
                    "bg-linear-to-b from-sky-500 to-sky-600",
                    "shadow-[0px_1px_2px_0px_#00000016,0px_2px_4px_0px_#00000006,inset_0px_0px_1.5px_#0084D1,inset_0px_2.5px_0px_#ffffff16,inset_0px_0px_2.5px_#ffffff08]",
                    "ring-2 ring-sky-600 hover:from-sky-600 hover:to-sky-700",
                    className,
                )}
            >
                <Link href={auth.href} onClick={onClick}>
                    {auth.label}
                </Link>
            </Button>
        );
    }

    if (variant === "nav") {
        return (
            <Button
                asChild
                className={cn(
                    "hidden md:flex rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90",
                    className,
                )}
            >
                <Link href={auth.href} onClick={onClick}>
                    {auth.label}
                </Link>
            </Button>
        );
    }

    return (
        <Button
            asChild
            className={cn(
                "w-full rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90",
                className,
            )}
        >
            <Link href={auth.href} onClick={onClick}>
                {auth.label}
            </Link>
        </Button>
    );
}
