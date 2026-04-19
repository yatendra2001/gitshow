"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { ArrowUpRight, Github, Loader2 } from "lucide-react";

/**
 * Client-side signin trigger. Uses `next-auth/react`'s `signIn` because
 * server actions aren't reliably intercepted on OpenNext-Cloudflare
 * right now — a server-action form renders as `<form action="">`,
 * and on plain HTML submit the form POSTs to the current URL with no
 * handler (silent no-op).
 *
 * This version does a client-side POST with the NextAuth CSRF token
 * baked in, then redirects to GitHub. Works everywhere Next renders.
 */
export function SignInButton() {
  const [busy, setBusy] = React.useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signIn("github", { callbackUrl: "/dashboard" });
        } catch {
          setBusy(false);
        }
      }}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-70"
    >
      {busy ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Redirecting to GitHub…
        </>
      ) : (
        <>
          <Github className="size-4" />
          Continue with GitHub
          <ArrowUpRight className="size-4" />
        </>
      )}
    </button>
  );
}
