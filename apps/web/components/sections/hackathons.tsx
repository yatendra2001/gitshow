"use client";

import Link from "next/link";
import type { HackathonEntry } from "@gitshow/shared/resume";
import { Badge } from "@/components/ui/badge";

/**
 * New-pipeline Hackathons section: a projection of `kg.achievements`
 * where `kind === "hackathon"`. Only rendered by the resume pipeline
 * when the projection is non-empty — profiles without hackathons
 * never see an empty header.
 *
 * This lives in `components/sections/` (new dir, §9.3) alongside the
 * other pipeline-projected sections. The legacy template-wrapper
 * version in `components/section/` keeps working for the legacy data
 * shape until the new renderer fully replaces it.
 */
export default function HackathonsSection({
  entries,
}: {
  entries: HackathonEntry[];
}) {
  if (!entries || entries.length === 0) return null;

  return (
    <section id="hackathons" className="overflow-hidden">
      <div className="flex min-h-0 flex-col gap-y-8 w-full">
        <div className="flex flex-col gap-y-4 items-center justify-center">
          <div className="flex items-center w-full">
            <div className="flex-1 h-px bg-linear-to-r from-transparent from-5% via-border via-95% to-transparent" />
            <div className="border bg-primary z-10 rounded-xl px-4 py-1">
              <span className="text-background text-sm font-medium">
                Hackathons
              </span>
            </div>
            <div className="flex-1 h-px bg-linear-to-l from-transparent from-5% via-border via-95% to-transparent" />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {entries.map((h) => (
            <article
              key={h.id}
              className="rounded-lg border bg-card p-4 flex flex-col gap-2"
            >
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-semibold leading-snug">{h.title}</h3>
                {h.rank && (
                  <Badge className="text-xs bg-primary text-primary-foreground">
                    {h.rank}
                  </Badge>
                )}
                {h.date && (
                  <time className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {h.date}
                  </time>
                )}
              </header>
              {h.location && (
                <p className="text-xs text-muted-foreground">{h.location}</p>
              )}
              {h.description && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {h.description}
                </p>
              )}
              {h.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {h.sources.map((s, idx) => (
                    <Link
                      key={idx}
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Badge
                        variant="secondary"
                        className="text-xs"
                      >
                        {s.label}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
