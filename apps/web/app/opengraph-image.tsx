/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";

/**
 * Root marketing OG card for `gitshow.io`. Sibling pattern to
 * `[handle]/opengraph-image.tsx`: same canvas, same neutrals, same
 * lockup — the difference is this one carries the product pitch
 * instead of a person's name.
 *
 * Why a real 1200×630 card and not the apple-touch-icon: WhatsApp
 * (and Slack/Discord/Twitter) render square favicons as a giant
 * block. A 1.91:1 card scales down to a tidy preview row instead.
 *
 * No `runtime = "edge"` — OpenNext bundles every route for the
 * Cloudflare Worker runtime. Declaring `edge` forces Next to emit a
 * separate edge-runtime build that OpenNext can't serve, so the route
 * 500s in production. The default (Node-style) emit runs fine on
 * Workers via OpenNext.
 */

export const alt = "GitShow — portfolios from your git history";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  const base = publicBase();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: "80px 88px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 26,
            color: "#a3a3a3",
          }}
        >
          <img
            src={`${base}/icon-dark.png`}
            width={44}
            height={44}
            alt=""
            style={{ borderRadius: 8 }}
          />
          <span style={{ color: "#fafafa", fontWeight: 600 }}>gitshow</span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          <div
            style={{
              fontSize: 108,
              fontWeight: 600,
              letterSpacing: -4,
              lineHeight: 1.0,
              maxWidth: 980,
            }}
          >
            Portfolios from your git history.
          </div>
          <div
            style={{
              fontSize: 30,
              color: "#a3a3a3",
              lineHeight: 1.4,
              maxWidth: 880,
              display: "flex",
            }}
          >
            AI reads your GitHub and builds your portfolio, ATS resume, and
            custom domain. Live in 20 minutes.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 22,
            color: "#737373",
          }}
        >
          <span>gitshow.io</span>
          <span>Sign in with GitHub →</span>
        </div>
      </div>
    ),
    size,
  );
}

function publicBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io").replace(
    /\/+$/,
    "",
  );
}
