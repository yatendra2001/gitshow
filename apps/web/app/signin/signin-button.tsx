"use client";

import * as React from "react";
import { ArrowUpRight, Github, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";

/**
 * Kicks off the GitHub OAuth round-trip via Better Auth. The client
 * POSTs to /api/auth/sign-in/social with { provider, callbackURL },
 * the server responds with a 200 containing the GitHub authorize URL,
 * and Better Auth's client redirects the tab to it. On callback we
 * land back at callbackURL ("/app").
 */
export function SignInButton() {
  const [busy, setBusy] = React.useState(false);

  const onClick = async () => {
    setBusy(true);
    try {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: "/app",
        errorCallbackURL: "/signin?error=1",
      });
    } catch (err) {
      setBusy(false);
      alert(
        `Sign-in failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
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
