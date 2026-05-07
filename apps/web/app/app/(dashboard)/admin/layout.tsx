import { requireAdminPage } from "@/lib/admin";

/**
 * Admin shell — sits inside the regular `(dashboard)` route group, so
 * the dashboard sidebar + topbar still wrap every admin page. This
 * layout's only job is the auth gate (`requireAdminPage`), which
 * redirects non-admins back to /app and unauthenticated users to
 * /signin.
 *
 * Render is intentionally minimal: pages choose their own page header /
 * subnav placement so a list page can sit closer to the top than a
 * detail page.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      {children}
    </div>
  );
}
