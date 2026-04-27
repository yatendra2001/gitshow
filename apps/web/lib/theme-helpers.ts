/**
 * Theme helpers — wraps next-themes' setTheme with the
 * `.theme-switching` class so transitions don't all fire at once
 * the moment the `.dark` class flips.
 *
 * Usage:
 *   const { setTheme } = useTheme();
 *   <button onClick={() => flipTheme(setTheme, isDark ? "light" : "dark")} />
 *
 * The class is added to <html>, the theme is set on the next paint,
 * and the class is removed one frame later. ~80–100ms of "frozen"
 * UI which is invisible to users but kills the cross-fade flash.
 */

type SetTheme = (theme: string) => void;

export function flipTheme(setTheme: SetTheme, next: string) {
  if (typeof document === "undefined") {
    setTheme(next);
    return;
  }

  const root = document.documentElement;
  root.classList.add("theme-switching");

  // Apply on the next frame so the suppression class is in place
  // before any transition would fire.
  requestAnimationFrame(() => {
    setTheme(next);
    requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
    });
  });
}
