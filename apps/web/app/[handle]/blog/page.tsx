"use client";

import BlurFade from "@/components/magicui/blur-fade";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { paginate, normalizePage } from "@/lib/pagination";
import { formatHumanDate } from "@/lib/format-date";
import { useData, useUrlPrefix } from "@/components/data-provider";
import { ChevronRight } from "lucide-react";

/**
 * `/{handle}/blog` — paginated list of imported blog posts.
 *
 * Mirrors the reference template's `app/blog/page.tsx` one-to-one, but
 * reads posts from the per-handle Resume via `useData()` instead of
 * content-collections (build-time MDX is incompatible with our dynamic
 * per-user rendering).
 *
 * URL construction: every internal link uses `urlPrefix` from the
 * DataProvider so a request on a custom domain (e.g. yatendrakumar.com)
 * produces handle-less paths (`/blog/{slug}`) instead of leaking the
 * canonical handle into the address bar.
 */

const PAGE_SIZE = 5;
const BLUR_FADE_DELAY = 0.04;

export default function BlogPage() {
  const DATA = useData();
  const urlPrefix = useUrlPrefix();
  const search = useSearchParams();

  const posts = DATA.blog;
  const sortedPosts = [...posts].sort((a, b) => {
    if (new Date(a.publishedAt) > new Date(b.publishedAt)) return -1;
    return 1;
  });

  const totalPages = Math.max(1, Math.ceil(sortedPosts.length / PAGE_SIZE));
  const currentPage = normalizePage(search?.get("page") ?? undefined, totalPages);
  const { items: paginatedPosts, pagination } = paginate(sortedPosts, {
    page: currentPage,
    pageSize: PAGE_SIZE,
  });

  return (
    <section id="blog">
      <BlurFade delay={BLUR_FADE_DELAY}>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">
          Blog{" "}
          <span className="ml-1 bg-card border border-border rounded-md px-2 py-1 text-muted-foreground text-sm font-mono tabular-nums">
            {sortedPosts.length}
          </span>
        </h1>
        <p className="text-sm text-muted-foreground mb-10">
          {DATA.name.split(" ")[0]}&apos;s writing — articles, notes, and longer reads.
        </p>
      </BlurFade>

      {paginatedPosts.length > 0 ? (
        <>
          <BlurFade delay={BLUR_FADE_DELAY * 2}>
            <ul className="flex flex-col">
              {paginatedPosts.map((post, id) => {
                const indexNumber =
                  (pagination.page - 1) * PAGE_SIZE + id + 1;
                return (
                  <BlurFade
                    delay={BLUR_FADE_DELAY * 3 + id * 0.05}
                    key={post.slug}
                  >
                    <li className="border-t border-border first:border-t-0">
                      <Link
                        className="group flex items-start gap-4 py-5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md -mx-2 px-2 transition-colors hover:bg-accent/40"
                        href={`${urlPrefix}/blog/${post.slug}`}
                      >
                        <span
                          className="text-[11px] font-mono tabular-nums font-medium text-muted-foreground/70 mt-1.5 w-6 shrink-0"
                          aria-hidden
                        >
                          {String(indexNumber).padStart(2, "0")}
                        </span>
                        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                          <h2 className="tracking-tight text-lg sm:text-xl font-medium leading-snug text-foreground/90 group-hover:text-foreground transition-colors inline-flex items-baseline gap-1.5">
                            <span className="line-clamp-2">{post.title}</span>
                            <ChevronRight
                              className="size-4 stroke-[2.5] text-muted-foreground opacity-0 -translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 shrink-0 self-center"
                              aria-hidden
                            />
                          </h2>
                          {post.summary && (
                            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                              {post.summary}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/80 mt-0.5">
                            <span className="font-mono tabular-nums">
                              {formatHumanDate(post.publishedAt)}
                            </span>
                            {post.sourcePlatform && (
                              <>
                                <span aria-hidden className="text-border">
                                  ·
                                </span>
                                <span className="rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-medium">
                                  {post.sourcePlatform}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        {post.image && (
                          <div
                            className="hidden sm:block shrink-0 w-24 h-24 overflow-hidden rounded-lg border border-border bg-muted/30"
                            aria-hidden
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={post.image}
                              alt=""
                              loading="lazy"
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            />
                          </div>
                        )}
                      </Link>
                    </li>
                  </BlurFade>
                );
              })}
            </ul>
          </BlurFade>

          {pagination.totalPages > 1 && (
            <BlurFade delay={BLUR_FADE_DELAY * 4}>
              <div className="flex gap-3 flex-row items-center justify-between mt-8">
                <div className="text-sm text-muted-foreground">
                  Page {pagination.page} of {pagination.totalPages}
                </div>
                <div className="flex gap-2 sm:justify-end">
                  {pagination.hasPreviousPage ? (
                    <Link
                      href={`${urlPrefix}/blog?page=${pagination.page - 1}`}
                      className="h-8 w-fit px-2 flex items-center justify-center text-sm border border-border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span className="h-8 w-fit px-2 flex items-center justify-center text-sm border border-border rounded-lg opacity-50 cursor-not-allowed">
                      Previous
                    </span>
                  )}
                  {pagination.hasNextPage ? (
                    <Link
                      href={`${urlPrefix}/blog?page=${pagination.page + 1}`}
                      className="h-8 w-fit px-2 flex items-center justify-center text-sm border border-border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      Next
                    </Link>
                  ) : (
                    <span className="h-8 w-fit px-2 flex items-center justify-center text-sm border border-border rounded-lg opacity-50 cursor-not-allowed">
                      Next
                    </span>
                  )}
                </div>
              </div>
            </BlurFade>
          )}
        </>
      ) : (
        <BlurFade delay={BLUR_FADE_DELAY * 2}>
          <div className="flex flex-col items-center justify-center py-12 px-4 border border-border rounded-xl">
            <p className="text-muted-foreground text-center">
              No blog posts imported yet.
            </p>
          </div>
        </BlurFade>
      )}
    </section>
  );
}
