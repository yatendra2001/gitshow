/* eslint-disable @next/next/no-img-element */
"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import Markdown from "react-markdown";

function ProjectImage({ src, alt }: { src: string; alt: string }) {
  const [imageError, setImageError] = useState(false);

  if (!src || imageError) {
    return <div className="w-full h-48 bg-muted" />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-48 object-cover"
      onError={() => setImageError(true)}
    />
  );
}

interface Props {
  title: string;
  href?: string;
  description: string;
  dates: string;
  tags: readonly string[];
  link?: string;
  image?: string;
  video?: string;
  links?: readonly {
    icon: React.ReactNode;
    type: string;
    href: string;
  }[];
  /** 0..1 — fraction of repo authored by the user. Renders as a badge. */
  userShare?: number;
  /** Press / community mentions of the project (HN, Product Hunt, dev.to). */
  webMentions?: ReadonlyArray<{
    title: string;
    url: string;
    source: string;
  }>;
  className?: string;
}

/**
 * ProjectCard — the entire surface is clickable now. Used to be that
 * only the image and the corner arrow opened the link, because the
 * body sat outside the inner Link wrapper. Fix uses the standard
 * stretched-link pattern: the card is `position: relative`, a single
 * absolutely-positioned Link sits below the visible content as the
 * default click target, and any inner Source/Website badges layer
 * above it with `relative z-10` + `stopPropagation` so they
 * intercept their own clicks instead of opening the main project
 * link.
 *
 * Nested anchors aren't valid HTML, so the inner badges have to be
 * siblings of the stretched link, not descendants. That's why the
 * card root is a `div`, not a `Link`.
 */
export function ProjectCard({
  title,
  href,
  description,
  dates,
  tags,
  image,
  video,
  links,
  userShare,
  webMentions,
  className,
}: Props) {
  const targetHref = href || "#";
  const sharePct =
    typeof userShare === "number" && userShare > 0
      ? Math.round(userShare * 100)
      : null;
  return (
    <div
      className={cn(
        "group relative flex flex-col h-full border border-border rounded-xl overflow-hidden",
        // Premium hover: -1px lift + soft drop + slight border tint.
        // Active = bounce-back. Hover effects gated to fine pointers
        // so touch devices don't get a stuck-hover state.
        "transition-[transform,box-shadow,border-color] duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        "hover:border-foreground/15 hover:shadow-[0_2px_4px_-2px_oklch(0_0_0_/_0.08),0_8px_24px_-8px_oklch(0_0_0_/_0.12)]",
        "[@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-px",
        "active:translate-y-0 active:duration-[80ms]",
        className,
      )}
    >
      {/* Stretched click target. Sits beneath visible content but
        above the card background, so a click on whitespace, title,
        description, or image opens the project. */}
      <Link
        href={targetHref}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
        aria-label={`Open ${title}`}
      />

      <div className="relative shrink-0 pointer-events-none">
        {video ? (
          <video
            src={video}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-48 object-cover"
          />
        ) : image ? (
          <ProjectImage src={image} alt={title} />
        ) : (
          <div className="w-full h-48 bg-muted" />
        )}
        {links && links.length > 0 && (
          <div className="pointer-events-auto absolute top-2 right-2 flex flex-wrap gap-2 z-10">
            {links.map((l, idx) => (
              <Link
                href={l.href}
                key={idx}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <Badge
                  className="flex items-center gap-1.5 text-xs bg-black text-white hover:bg-black/90"
                  variant="default"
                >
                  {l.icon}
                  {l.type}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="relative p-6 flex flex-col gap-3 flex-1 pointer-events-none">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">{title}</h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <time>{dates}</time>
              {sharePct !== null && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono tabular-nums">
                    {sharePct}% authored
                  </span>
                </>
              )}
            </div>
          </div>
          <ArrowUpRight
            className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
            aria-hidden
          />
        </div>
        <div className="text-xs flex-1 prose max-w-full text-pretty font-sans leading-relaxed text-muted-foreground dark:prose-invert">
          <Markdown>{description}</Markdown>
        </div>
        {webMentions && webMentions.length > 0 && (
          <div className="pointer-events-auto relative z-10 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground/70">
              <span className="size-1 rounded-full bg-[var(--primary)]/80" />
              Featured at
            </div>
            <div className="flex flex-wrap gap-1.5">
              {webMentions.slice(0, 5).map((m) => (
                <Link
                  href={m.url}
                  key={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground/80 hover:text-foreground border border-border/60 hover:border-[var(--primary)]/50 rounded-md px-2 py-0.5 bg-gradient-to-br from-background/70 to-background hover:from-[var(--primary)]/[0.06] hover:to-background transition-colors"
                  title={m.title}
                >
                  {m.source}
                </Link>
              ))}
            </div>
          </div>
        )}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto">
            {tags.map((tag) => (
              <Badge
                key={tag}
                className="text-[11px] font-medium border border-border h-6 w-fit px-2"
                variant="outline"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

