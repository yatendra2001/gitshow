import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { NotificationBell } from "@/components/notifications/bell";
import { PushEnableButton } from "@/components/notifications/push-enable";
import { SignOutButton } from "./_signout-button";
import { loadDashboardContext } from "./_context";

/**
 * Sidebar shell layout for every /app/* route except /scan and /intake
 * (those are focused full-bleed flows that live outside the group).
 *
 * Both Pro and non-Pro users see the shell — the sidebar still
 * surfaces Billing and Support for cancelled accounts. The page itself
 * decides whether to render the upgrade card or the dashboard.
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
      avatarUrl={ctx.avatarUrl}
      publicSlug={ctx.profile?.public_slug ?? null}
      isPublished={ctx.isPublished}
      planLabel={ctx.planLabel}
      topbarTrailing={
        <>
          <PushEnableButton />
          <NotificationBell />
        </>
      }
      signOutSlot={<SignOutButton />}
    >
      {children}
    </DashboardShell>
  );
}
