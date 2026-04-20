"use client";

import { PrivacyDrawer } from "@/components/profile/privacy-drawer";

/**
 * Thin client wrapper around the privacy drawer that wires the delete
 * action to /api/profile/delete. Page-local so the server-side /app
 * page stays auth-scoped.
 */
export function DeleteAccountHandler() {
  return (
    <PrivacyDrawer
      onDelete={async () => {
        await fetch("/api/profile/delete", { method: "POST" });
        window.location.href = "/";
      }}
    />
  );
}
