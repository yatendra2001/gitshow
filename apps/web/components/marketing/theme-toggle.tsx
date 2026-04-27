"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/marketing/ui/button";
import { flipTheme } from "@/lib/theme-helpers";

/**
 * Marketing theme toggle. Uses flipTheme() so transitions don't
 * cross-fade everywhere on the .dark class swap.
 *
 * Icons use Tailwind's transition-all on rotate+scale here because
 * the change is purely cosmetic (rotation + scale) and capped at
 * 280ms — matches the dashboard ThemeToggle aesthetic.
 */
export function ThemeToggle() {
    const { theme, setTheme } = useTheme();

    return (
        <Button
            variant="outline"
            size="icon"
            onClick={() => flipTheme(setTheme, theme === "light" ? "dark" : "light")}
            className="cursor-pointer rounded-full h-8 w-8 overflow-hidden"
            aria-label="Toggle theme"
        >
            <Sun
                className={
                    "h-[1.2rem] w-[1.2rem] rotate-0 scale-100 dark:-rotate-90 dark:scale-0 text-primary " +
                    "transition-[transform,opacity] duration-[280ms] ease-[cubic-bezier(0.215,0.61,0.355,1)]"
                }
            />
            <Moon
                className={
                    "absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 dark:rotate-0 dark:scale-100 text-primary " +
                    "transition-[transform,opacity] duration-[280ms] ease-[cubic-bezier(0.215,0.61,0.355,1)]"
                }
            />
            <span className="sr-only">Toggle theme</span>
        </Button>
    );
}
