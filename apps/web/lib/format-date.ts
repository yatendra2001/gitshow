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

/**
 * Compact "Mon YYYY" format for resume work / education ranges. Tighter
 * than `formatHumanDate` (no day component, even when one is present)
 * because resume rows are typically displayed with the date on the right
 * in a small tabular column.
 *
 * Inputs:
 *   "2024-03-01" → "Mar 2024"
 *   "2024-03"    → "Mar 2024"
 *   "2024"       → "2024"
 *   "May 2021"   → unchanged (already pretty)
 *   "Present"    → "Present"
 *   ""           → "Present"  (matches the resume schema convention)
 *   anything else unparseable → returned verbatim
 */
const RESUME_MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatResumeDate(raw: string | null | undefined): string {
  if (!raw) return "Present";
  const s = raw.trim();
  if (!s) return "Present";
  const iso = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-\d{1,2})?$/);
  if (iso) {
    const year = iso[1];
    const month = iso[2] ? Number(iso[2]) : null;
    if (month && month >= 1 && month <= 12)
      return `${RESUME_MONTH_NAMES[month - 1]} ${year}`;
    return year;
  }
  return s;
}

export function formatResumeDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = formatResumeDate(start);
  const e = end == null || end === "" ? "Present" : formatResumeDate(end);
  if (!s || s === "Present") return e;
  return `${s} — ${e}`;
}
