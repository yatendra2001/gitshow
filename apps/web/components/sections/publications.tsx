"use client";

import Link from "next/link";
import type { PublicationEntry } from "@gitshow/shared/resume";
import { BookOpen, FileText, Mic, Podcast, PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatHumanDate } from "@/lib/format-date";

/**
 * Publications section (researcher persona). Projected from
 * `kg.publications` where `kind in {paper, preprint, talk, podcast,
 * video}`. Renders nothing when empty — indie-builder profiles won't
 * see an orphan header.
 */
export default function PublicationsSection({
  entries,
}: {
  entries: PublicationEntry[];
}) {
  if (!entries || entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) => {
    const av = a.publishedAt ?? "";
    const bv = b.publishedAt ?? "";
    return bv.localeCompare(av);
  });

  return (
    <section id="publications" className="overflow-hidden">
      <div className="flex min-h-0 flex-col gap-y-6 w-full">
        <div className="flex flex-col gap-y-4 items-center justify-center">
          <div className="flex items-center w-full">
            <div className="flex-1 h-px bg-linear-to-r from-transparent from-5% via-border via-95% to-transparent" />
            <div className="border bg-primary z-10 rounded-xl px-4 py-1">
              <span className="text-background text-sm font-medium">
                Publications
              </span>
            </div>
            <div className="flex-1 h-px bg-linear-to-l from-transparent from-5% via-border via-95% to-transparent" />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {sorted.map((p) => (
            <Link
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-3 rounded-lg border bg-card p-4 hover:bg-accent/40 transition-colors"
            >
              <div className="mt-0.5 text-muted-foreground">
                <KindIcon kind={p.kind} />
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 className="font-semibold leading-snug group-hover:underline underline-offset-2">
                    {p.title}
                  </h3>
                  {p.publishedAt && (
                    <time className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {formatHumanDate(p.publishedAt)}
                    </time>
                  )}
                </header>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    {p.kind}
                  </Badge>
                  {p.venue && <span>{p.venue}</span>}
                </div>
                {p.coAuthors && p.coAuthors.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    with {formatCoAuthors(p.coAuthors)}
                  </p>
                )}
                {p.summary && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {p.summary}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function KindIcon({ kind }: { kind: PublicationEntry["kind"] }) {
  switch (kind) {
    case "paper":
    case "preprint":
      return <FileText className="size-4" aria-hidden />;
    case "talk":
      return <Mic className="size-4" aria-hidden />;
    case "podcast":
      return <Podcast className="size-4" aria-hidden />;
    case "video":
      return <PlayCircle className="size-4" aria-hidden />;
    default:
      return <BookOpen className="size-4" aria-hidden />;
  }
}

function formatCoAuthors(authors: string[]): string {
  const first = authors.slice(0, 3);
  const rest = authors.length - first.length;
  const joined = first.join(", ");
  return rest > 0 ? `${joined} +${rest} more` : joined;
}
