"use client";

import { Reveal } from "@/components/ui/motion";

interface SectionHeaderProps {
    children: React.ReactNode;
}

/**
 * Wraps every marketing section header in a CSS reveal — fades +
 * 12px slide-up on first scroll into view. Triggers once and uses
 * the same `--ease-out-cubic` token as motion tokens.
 *
 * If you ever need a header without the reveal (rare), wrap the
 * inner div directly. */
export function SectionHeader({ children }: SectionHeaderProps) {
    return (
        <div className="border-b w-full h-full p-6 md:p-24">
            <Reveal as="div" amount={0.3} className="max-w-lg mx-auto flex flex-col items-center justify-center gap-2">
                {children}
            </Reveal>
        </div>
    );
}
