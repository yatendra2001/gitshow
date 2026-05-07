import { requireAdminPage } from "@/lib/admin";

/**
 * Layout for the full-bleed admin draft preview surface
 * (`/app/admin-preview/...`). Lives OUTSIDE the dashboard sidebar shell
 * deliberately so each user's portfolio template can render full-width
 * exactly like a visitor would see it on `/{handle}`.
 *
 * Auth gate is the same as the rest of the admin panel.
 */
export default async function AdminPreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage();
  return <>{children}</>;
}
