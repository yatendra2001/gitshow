/**
 * Pure, deterministic helpers for the initials-avatar fallback.
 *
 * Used everywhere a Project has no hero image and a Company/School
 * has no logo. Runs on the server and the client — no window/document.
 *
 * Determinism matters: the same input always produces the same
 * initials + color across scans + sessions, so the user's "I see
 * Flightcast as green" recognition carries over.
 */

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map(w => w[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "?";
}

export function avatarBgFor(name: string): string {
  const palette = [
    "#e57373", "#f06292", "#ba68c8", "#9575cd",
    "#7986cb", "#64b5f6", "#4fc3f7", "#4dd0e1",
    "#4db6ac", "#81c784", "#aed581", "#ffb74d",
    "#ff8a65", "#a1887f", "#90a4ae",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length]!;
}
