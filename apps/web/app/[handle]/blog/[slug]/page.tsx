"use client";

import Link from "next/link";
import { useParams, notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useData, useUrlPrefix } from "@/components/data-provider";
import { markdownComponents } from "@/components/mdx/markdown-components";
import { formatHumanDate as formatDate } from "@/lib/format-date";

/**
 * `/{handle}/blog/{slug}` — individual post renderer.
 *
 * Mirrors the reference template's `app/blog/[slug]/page.tsx` one-to-one
 * in structure. The post body is markdown imported verbatim from the
 * original source (Medium / dev.to / Hashnode / Substack / personal site),
 * rendered with `react-markdown` + `remark-gfm` and styled via
 * `markdownComponents` to match the reference portfolio's MDX surface
 * (gradient `<hr>`, bordered tables, inline code chips, syntax-highlighted
 * `<pre>` via shiki).
 *
 * Source attribution lives inline next to the date as a plain link back
 * to the canonical URL, keeping the header visually quiet (the reference
 * template has nothing else there) while preserving SEO + provenance.
 *
 * URL construction: every internal link uses `urlPrefix` from the
 * DataProvider so a request on a custom domain produces handle-less
 * navigation paths.
 */

export default function BlogPost() {
  const DATA = useData();
  const urlPrefix = useUrlPrefix();
  const params = useParams<{ handle: string; slug: string }>();
  const slug = params?.slug ?? "";

  const sorted = [...DATA.blog].sort((a, b) =>
    new Date(a.publishedAt) > new Date(b.publishedAt) ? -1 : 1,
  );
  const currentIndex = sorted.findIndex((p) => p.slug === slug);
  const post = sorted[currentIndex];

  if (!post) notFound();

  const previousPost = currentIndex > 0 ? sorted[currentIndex - 1] : null;
  const nextPost =
    currentIndex < sorted.length - 1 ? sorted[currentIndex + 1] : null;

  return (
    <section id="blog-post">
      <div className="flex justify-start gap-4 items-center">
        <Link
          href={`${urlPrefix}/blog`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors border border-border rounded-lg px-2 py-1 inline-flex items-center gap-1 mb-6 group"
          aria-label="Back to Blog"
        >
          <ChevronLeft className="size-3 group-hover:-translate-x-px transition-transform" />
          Back to Blog
        </Link>
      </div>

      <div className="flex flex-col gap-4">
        <h1 className="title font-semibold text-3xl md:text-4xl tracking-tighter leading-tight">
          {post.title}
        </h1>
        <p className="text-sm text-muted-foreground inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{formatDate(post.publishedAt)}</span>
          {post.sourceUrl && (
            <>
              <span aria-hidden className="text-border">
                ·
              </span>
              <a
                href={post.sourceUrl}
                rel="canonical nofollow noopener"
                target="_blank"
                className="hover:text-foreground transition-colors underline-offset-4 hover:underline"
              >
                {post.sourcePlatform
                  ? `Originally on ${post.sourcePlatform}`
                  : "Original source"}
              </a>
            </>
          )}
        </p>
      </div>

      <div className="my-6 flex w-full items-center">
        <div
          className="flex-1 h-px bg-border"
          style={{
            maskImage:
              "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
            WebkitMaskImage:
              "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
          }}
        />
      </div>

      <article className="prose max-w-full text-pretty font-sans leading-relaxed text-muted-foreground dark:prose-invert">
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {post.body}
        </Markdown>
      </article>

      <nav className="mt-12 pt-8 max-w-2xl">
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          {previousPost ? (
            <Link
              href={`${urlPrefix}/blog/${previousPost.slug}`}
              className="group flex-1 flex flex-col gap-1 p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors"
            >
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ChevronLeft className="size-3" />
                Previous
              </span>
              <span className="text-sm font-medium group-hover:text-foreground transition-colors whitespace-normal wrap-break-word">
                {previousPost.title}
              </span>
            </Link>
          ) : (
            <div className="hidden sm:block flex-1" />
          )}
          {nextPost ? (
            <Link
              href={`${urlPrefix}/blog/${nextPost.slug}`}
              className="group flex-1 flex flex-col gap-1 p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors text-right"
            >
              <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                Next
                <ChevronRight className="size-3" />
              </span>
              <span className="text-sm font-medium group-hover:text-foreground transition-colors whitespace-normal wrap-break-word">
                {nextPost.title}
              </span>
            </Link>
          ) : (
            <div className="hidden sm:block flex-1" />
          )}
        </div>
      </nav>
    </section>
  );
}
