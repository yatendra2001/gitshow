"use client";

import * as React from "react";

/**
 * Reader-facing light/dark toggle on the public profile.
 *
 * - The root <html> class is "dark" by default (see layout.tsx).
 * - On mount, this component reads gs-theme from localStorage and
 *   applies it, so a visitor who flipped to light keeps light on
 *   their next visit. To avoid the FOUC that would otherwise flash
 *   dark → light on first paint, the matching inline script lives
 *   in layout.tsx and runs before hydration.
 * - Click flips the class + persists.
 *
 * No framework dep — we rewrote this on top of a 30-line component
 * because next-themes was pulling weight we didn't need (it was in
 * the dead-deps list audited in PR #30).
 */
export function ThemeToggle() {
  const [mounted, setMounted] = React.useState(false);
  const [theme, setTheme] = React.useState<"light" | "dark">("dark");

  React.useEffect(() => {
    setMounted(true);
    const current = document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
    setTheme(current);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("gs-theme", next);
    } catch {
      /* private mode / quota — cosmetic, ignore */
    }
    setTheme(next);
  };

  // Render a neutral placeholder during SSR so hydration matches the
  // default "dark" class on <html>. The icon flips on the client tick
  // immediately after mount when the real theme is known.
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border/50 bg-card/50 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      {mounted && theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}
