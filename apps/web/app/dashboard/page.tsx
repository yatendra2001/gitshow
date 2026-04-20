import { redirect } from "next/navigation";

/**
 * Legacy /dashboard → single-person /app. Preserved as a redirect so
 * any bookmarks / old emails still land somewhere sensible.
 */
export default function DashboardRedirect(): never {
  redirect("/app");
}
