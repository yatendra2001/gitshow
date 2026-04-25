/**
 * Convert whatever date string the backend stored into a polished
 * display form. Handles:
 *
 *   ISO timestamp           → "Feb 3, 2024"
 *   YYYY-MM-DD              → "Feb 3, 2024"
 *   YYYY-MM                 → "Feb 2024"
 *   YYYY                    → "2024"
 *   anything unparseable    → returns the input verbatim
 *
 * Used by the blog index, blog post, and publications surfaces —
 * everywhere we render a publish date the user supplied or the
 * pipeline extracted. The backend stores raw ISO so the UI is the
 * single right place to humanise.
 */
export function formatHumanDate(raw: string | undefined | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // YYYY only.
  if (/^\d{4}$/.test(trimmed)) return trimmed;

  // YYYY-MM (no day) — render "Mon YYYY", drop the day to avoid
  // implying precision we don't have.
  const ymMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (ymMatch) {
    const d = new Date(`${trimmed}-01T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
      });
    }
  }

  // Anything Date can parse — render full "Mon D, YYYY".
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  return trimmed;
}
