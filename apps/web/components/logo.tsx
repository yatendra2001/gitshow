/* eslint-disable @next/next/no-img-element */

/**
 * Gitshow brand marks.
 *
 * Two variants are provided because the mark itself has different
 * colour treatments for light vs. dark surfaces. We render both images
 * and let CSS pick one via the `.dark` class applied by
 * `<ThemeProvider>` — no client-side JS, no flash-on-mount.
 *
 * Asset layout:
 *   public/icon-light.png   — dark pixels, for light surfaces
 *   public/icon-dark.png    — light pixels, for dark surfaces
 *   (.svg variants exist but the PNGs are cheaper to rasterize at the
 *    small sizes the logo ever renders)
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface LogoMarkProps {
  /** Pixel size of the square mark. Default 28. */
  size?: number;
  className?: string;
}

/**
 * Just the square mark. No wordmark. Use this in tight headers or
 * alongside a different label.
 */
export function LogoMark({ size = 28, className }: LogoMarkProps) {
  const common = "block object-contain";
  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <img
        src="/icon-light.png"
        alt=""
        width={size}
        height={size}
        className={cn(common, "dark:hidden")}
      />
      <img
        src="/icon-dark.png"
        alt=""
        width={size}
        height={size}
        className={cn(common, "hidden dark:block")}
      />
    </span>
  );
}

export interface LogoProps {
  /** Wrap the logo in a Link to `href`. Skip for static contexts. */
  href?: string;
  /** Pixel size of the square mark. Default 28. */
  size?: number;
  /** Hide the "gitshow.io" wordmark — mark only. */
  markOnly?: boolean;
  /** Hide the ".io" suffix if you want just "gitshow". Ignored when `markOnly`. */
  hideSuffix?: boolean;
  className?: string;
}

/**
 * Mark + wordmark. "gitshow" is bold foreground, ".io" is muted — the
 * two-tone treatment we had on the old placeholder lockup, now hung
 * off the real icon.
 */
export function Logo({
  href,
  size = 28,
  markOnly = false,
  hideSuffix = false,
  className,
}: LogoProps) {
  const body = (
    <span
      className={cn(
        "inline-flex items-center gap-2 leading-none",
        className,
      )}
    >
      <LogoMark size={size} />
      {markOnly ? null : (
        <span className="text-[14px] font-semibold tracking-tight">
          gitshow
          {hideSuffix ? null : (
            <span className="text-muted-foreground font-medium">.io</span>
          )}
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label="gitshow home"
        className="inline-flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {body}
      </Link>
    );
  }

  return body;
}
