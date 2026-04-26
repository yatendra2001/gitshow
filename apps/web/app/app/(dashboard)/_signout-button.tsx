"use client";

import * as React from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/**
 * Sign-out — styled to sit next to the theme toggle in the sidebar
 * footer. Same nav-row footprint as the rest of the rail so the bottom
 * strip reads as a coherent group.
 *
 * Uses Better Auth's `authClient.signOut()` so the server clears the
 * session row + expires the cookie; we hard-navigate to `/` afterward
 * so RSC + cookie caches are fully flushed.
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
      aria-label="Sign out"
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2.5 py-2",
        "text-[13px] font-medium leading-none",
        "text-muted-foreground hover:text-foreground",
        "transition-[background-color,color,opacity] duration-150 ease",
        "hover:bg-foreground/[0.04]",
        "disabled:opacity-60 disabled:cursor-progress",
      )}
    >
      <LogOut
        className="size-4 shrink-0 text-muted-foreground/70 group-hover:text-foreground"
        strokeWidth={2}
      />
      <span>{busy ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}
