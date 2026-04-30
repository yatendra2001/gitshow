import type { ComponentProps } from "react";
import type { Components } from "react-markdown";
import { CodeBlock } from "@/components/mdx/code-block";

/**
 * Shared component overrides for `react-markdown` so blog-post bodies
 * imported from Medium / dev.to / Hashnode / Substack render with the
 * same polish as the reference portfolio's MDX surface.
 *
 * Mirrors `portfolio/src/mdx-components.tsx`. Differences come from the
 * ecosystem we render in:
 *
 *  - `react-markdown` calls `<code>` for both inline and fenced code,
 *    and only annotates fenced blocks with a `language-…` className.
 *    We sniff the className to differentiate, so inline `code` keeps
 *    its muted-chip styling without nesting inside the `<pre>` shiki
 *    treatment.
 *  - There's no `MediaContainer` shortcode equivalent here — embedded
 *    images flow straight from the import, so `<img>` gets a tasteful
 *    rounded border + subtle background instead.
 *
 * Wrapping `<pre>` triggers `CodeBlock`, which lazily runs Shiki on
 * the client to syntax-highlight the inner `<code>`. Because Shiki
 * runs in `useEffect`, the unstyled fallback shown during hydration
 * IS the markdown's raw text — no flicker of the wrong language.
 */

type CodeProps = ComponentProps<"code"> & {
  inline?: boolean;
};

export const markdownComponents: Components = {
  pre: (props) => <CodeBlock {...(props as ComponentProps<"pre">)} />,
  code: ({ className, children, ...props }: CodeProps) => {
    // `react-markdown` passes `inline=true` for inline code in older
    // versions; v9+ stops passing it and instead lets us rely on the
    // absence of a `language-…` className. Honour both — newer code
    // reaches the path through the className check.
    const isFenced =
      typeof className === "string" && /language-[\w-]+/i.test(className);
    if (isFenced) {
      // Pass through verbatim — the wrapping `<pre>` handler picks
      // it up via querySelector("code") and runs Shiki.
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="px-1.5 py-0.5 rounded-md bg-muted/60 dark:bg-muted/40 text-sm font-mono text-foreground/90 not-prose"
        {...props}
      >
        {children}
      </code>
    );
  },
  hr: (props) => (
    <div className="my-10 flex w-full items-center" {...props}>
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
  ),
  table: (props) => (
    <div className="my-6 border border-border rounded-xl overflow-hidden">
      <div className="w-full overflow-x-auto">
        <table
          className="m-0! w-full min-w-full border-separate border-spacing-0"
          {...(props as ComponentProps<"table">)}
        />
      </div>
    </div>
  ),
  img: ({ alt, ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt ?? ""}
      loading="lazy"
      className="my-6 rounded-xl border border-border bg-muted/30"
      {...(props as ComponentProps<"img">)}
    />
  ),
  a: ({ href, children, ...props }) => {
    const isExternal =
      typeof href === "string" && /^(https?:)?\/\//i.test(href);
    return (
      <a
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        className="underline decoration-border underline-offset-4 hover:decoration-foreground hover:text-foreground transition-colors"
        {...props}
      >
        {children}
      </a>
    );
  },
  blockquote: (props) => (
    <blockquote
      className="my-6 border-l-2 border-border pl-4 italic text-muted-foreground"
      {...(props as ComponentProps<"blockquote">)}
    />
  ),
};
