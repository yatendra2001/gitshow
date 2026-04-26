"use client";

import * as React from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Sign-out button. Calls Better Auth's `authClient.signOut()` — the
 * server clears the session row in D1 + expires the cookie, then we
 * hard-navigate to `/` so the next server render reads the absent
 * session. A plain <form action="/api/auth/signout"> was what broke
 * under the old Auth.js setup: that route expects a CSRF token the
 * form wasn't sending, so signout silently no-op'd.
 */
export function SignOutButton() {
  const [busy, setBusy] = React.useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess() {
            // Full reload, not router.push — guarantees every RSC /
            // cookie cache is flushed even if a cached page is served.
            window.location.href = "/";
          },
        },
      });
    } catch {
      setBusy(false);
      window.location.href = "/";
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="text-[12px] text-muted-foreground hover:text-foreground transition-colors min-h-9 px-2 disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
