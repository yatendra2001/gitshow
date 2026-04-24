import { requireProPage } from "@/lib/entitlements";

/**
 * Server-side Pro gate for /app/intake/[id]. The page itself is a
 * client component (interactive question cards), so we enforce the
 * subscription check in this layout wrapper instead — bounces to
 * /signin if signed out, /pricing if signed in without Pro.
 */

export const dynamic = "force-dynamic";

export default async function IntakeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireProPage();
  return children;
}
