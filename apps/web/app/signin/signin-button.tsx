"use client";

import * as React from "react";
import { ArrowUpRight, Github, Loader2 } from "lucide-react";

/**
 * Client-side signin trigger. Hand-rolled instead of using
 * `next-auth/react`'s `signIn` — the library's client bundle wasn't
 * firing network requests on click in the deployed OpenNext-CF
 * environment, with no console error, no DevTools request. Rather
 * than chase that invisible failure mode, replicate the flow directly:
 *
 *   1. GET /api/auth/csrf      → sets a cookie + returns the token
 *   2. Build a <form> dynamically with the token as a hidden field
 *   3. form.submit() → POST /api/auth/signin/github → 302 to GitHub
 *
 * NextAuth's REST handler accepts this exact shape. Works without any
 * React-side signin library.
 */
export function SignInButton() {
  const [busy, setBusy] = React.useState(false);

  const signIn = async () => {
    setBusy(true);
    try {
      const csrfRes = await fetch("/api/auth/csrf", { cache: "no-store" });
      if (!csrfRes.ok) throw new Error(`csrf: ${csrfRes.status}`);
      const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/auth/signin/github";

      const csrfInput = document.createElement("input");
      csrfInput.type = "hidden";
      csrfInput.name = "csrfToken";
      csrfInput.value = csrfToken;
      form.appendChild(csrfInput);

      const cbInput = document.createElement("input");
      cbInput.type = "hidden";
      cbInput.name = "callbackUrl";
      cbInput.value = "/dashboard";
      form.appendChild(cbInput);

      const jsonInput = document.createElement("input");
      jsonInput.type = "hidden";
      jsonInput.name = "json";
      jsonInput.value = "true";
      form.appendChild(jsonInput);

      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      setBusy(false);
      // Surface the failure to the user — silent no-op is the worst UX.
      alert(
        `Sign-in failed: ${
          err instanceof Error ? err.message : String(err)
        }\n\nCheck DevTools console and network tab.`,
      );
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={signIn}
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
