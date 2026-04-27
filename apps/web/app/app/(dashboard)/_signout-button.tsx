"use client";

import * as React from "react";
import { Logout01Icon } from "@hugeicons/core-free-icons";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/dashboard/icon";

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
        "transition-[background-color,color,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        "hover:bg-foreground/[0.06]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
        "disabled:opacity-60 disabled:cursor-progress",
      )}
    >
      <Icon
        icon={Logout01Icon}
        className="size-4 text-muted-foreground/70 group-hover:text-foreground"
      />
      <span>{busy ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}
