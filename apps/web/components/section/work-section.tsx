/* eslint-disable @next/next/no-img-element */
"use client";
import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useData } from "@/components/data-provider";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Format a date string from the resume schema into something readable.
 * Inputs come from a few sources and arrive in mixed shapes:
 *   "2024-03-01" → "Mar 2024"
 *   "2024-03"    → "Mar 2024"
 *   "2024"       → "2024"
 *   "May 2021"   → unchanged (already pretty)
 *   "Present"    → "Present"
 *   ""           → "Present"  (matches the existing fallback)
 *   anything else unparseable → returned verbatim
 */
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function formatWorkDate(raw: string | null | undefined): string {
  if (!raw) return "Present";
  const s = raw.trim();
  if (!s) return "Present";
  // ISO-ish: YYYY-MM-DD, YYYY-MM, or YYYY
  const iso = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-\d{1,2})?$/);
  if (iso) {
    const year = iso[1];
    const month = iso[2] ? Number(iso[2]) : null;
    if (month && month >= 1 && month <= 12) return `${MONTH_NAMES[month - 1]} ${year}`;
    return year;
  }
  return s;
}

function formatWorkRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = formatWorkDate(start);
  const e = end == null || end === "" ? "Present" : formatWorkDate(end);
  if (!s || s === "Present") return e;
  return `${s} — ${e}`;
}

function LogoImage({ src, alt }: { src?: string; alt: string }) {
  const [imageError, setImageError] = useState(false);

  if (!src || imageError) {
    return (
      <div className="size-8 md:size-10 p-1 border rounded-full shadow ring-2 ring-border bg-muted flex-none" />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="size-8 md:size-10 p-1 border rounded-full shadow ring-2 ring-border overflow-hidden object-contain flex-none"
      onError={() => setImageError(true)}
    />
  );
}

export default function WorkSection() {
  const DATA = useData();
  return (
    <Accordion type="single" collapsible className="w-full grid gap-6">
      {DATA.work.map((work) => (
        <AccordionItem
          key={work.company}
          value={work.company}
          className="w-full border-b-0 grid gap-2"
        >
          <AccordionTrigger className="hover:no-underline p-0 cursor-pointer transition-colors rounded-none group [&>svg]:hidden">
            <div className="flex items-center gap-x-3 justify-between w-full text-left">
              <div className="flex items-center gap-x-3 flex-1 min-w-0">
                <LogoImage src={work.logoUrl} alt={work.company} />
                <div className="flex-1 min-w-0 gap-0.5 flex flex-col">
                  <div className="font-semibold leading-none flex items-center gap-2">
                    {work.company}
                    <span className="relative inline-flex items-center w-3.5 h-3.5">
                      <ChevronRight
                        className={cn(
                          "absolute h-3.5 w-3.5 shrink-0 text-muted-foreground stroke-2 transition-all duration-300 ease-out",
                          "translate-x-0 opacity-0",
                          "group-hover:translate-x-1 group-hover:opacity-100",
                          "group-data-[state=open]:opacity-0 group-data-[state=open]:translate-x-0"
                        )}
                      />
                      <ChevronDown
                        className={cn(
                          "absolute h-3.5 w-3.5 shrink-0 text-muted-foreground stroke-2 transition-all duration-200",
                          "opacity-0 rotate-0",
                          "group-data-[state=open]:opacity-100 group-data-[state=open]:rotate-180"
                        )}
                      />
                    </span>
                  </div>
                  <div className="font-sans text-sm text-muted-foreground">
                    {work.title}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground text-right flex-none">
                <span>{formatWorkRange(work.start, work.end)}</span>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0 ml-13 text-xs sm:text-sm text-muted-foreground">
            {work.description}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

