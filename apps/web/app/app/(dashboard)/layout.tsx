import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { NotificationBell } from "@/components/notifications/bell";
import { PushEnableButton } from "@/components/notifications/push-enable";
import { SignOutButton } from "./_signout-button";
import { loadDashboardContext } from "./_context";

/**
 * Sidebar shell layout for /app, /app/billing.
 *
 * Edit / Preview / Scan / Intake stay outside this group on purpose —
 * they're full-bleed authoring surfaces (no sidebar) so the editor and
 * scan-progress views can use the entire viewport.
 *
 * Non-Pro users still see the shell so the sidebar surfaces Billing
 * and Support; the Workspace section is hidden for them in the rail.
 */

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await loadDashboardContext();
  if (!ctx) redirect("/signin");

  return (
    <DashboardShell
      handle={ctx.handle}
      publicSlug={ctx.profile?.public_slug ?? null}
      isPublished={ctx.isPublished}
      planLabel={ctx.planLabel}
      topbarTrailing={
        <>
          <PushEnableButton />
          <NotificationBell />
        </>
      }
      sidebarFooterTrailing={<SignOutButton />}
    >
      {children}
    </DashboardShell>
  );
}
