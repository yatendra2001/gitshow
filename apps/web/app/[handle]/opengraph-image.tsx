/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { loadPublishedResume } from "@/lib/resume-io";
import { isReservedHandle } from "@/lib/profiles";

/**
 * Per-handle OG image for `/{handle}`. Rendered via `next/og` (Satori
 * under the hood) so it works on Cloudflare Workers / OpenNext without
 * shipping a full browser.
 *
 * Layout mirrors the portfolio's hero: big name left, description
 * below, avatar on the right, subtle "gitshow.io" lockup bottom-left.
 * Grayscale — matches the template's pure-neutral aesthetic and
 * doesn't fight any accent color the user picks.
 */

export const runtime = "edge";
export const alt = "gitshow portfolio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  if (isReservedHandle(handle)) {
    return fallbackImage("gitshow", "Portfolios from your git history.");
  }

  const { env } = await getCloudflareContext({ async: true });
  const resume = await loadPublishedResume(env.BUCKET, handle);
  if (!resume) {
    return fallbackImage(
      `@${handle}`,
      "No portfolio published yet.",
    );
  }

  const name = resume.person.name || handle;
  const description = resume.person.description.slice(0, 220);
  const avatar = resume.person.avatarUrl;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: "80px 88px",
          flexDirection: "column",
          justifyContent: "space-between",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 24,
            color: "#8a8a8a",
          }}
        >
          gitshow.io/{handle}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 48,
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
              flex: 1,
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 96,
                fontWeight: 600,
                letterSpacing: -3,
                lineHeight: 1.05,
              }}
            >
              {name}
            </div>
            {description ? (
              <div
                style={{
                  fontSize: 30,
                  color: "#a3a3a3",
                  lineHeight: 1.35,
                  display: "flex",
                }}
              >
                {description}
              </div>
            ) : null}
          </div>
          {avatar ? (
            <img
              src={avatar}
              alt=""
              width={240}
              height={240}
              style={{
                width: 240,
                height: 240,
                borderRadius: 240,
                border: "6px solid #262626",
                flex: "none",
                objectFit: "cover",
              }}
            />
          ) : null}
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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Inline icon. Satori needs an absolute URL, not a path. */}
            <img
              src={`${publicBase()}/icon-dark.png`}
              width={28}
              height={28}
              alt=""
              style={{ borderRadius: 4 }}
            />
            <span>gitshow</span>
          </div>
          {resume.person.location ? <span>{resume.person.location}</span> : null}
        </div>
      </div>
    ),
    size,
  );
}

function publicBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io"
  ).replace(/\/+$/, "");
}

function fallbackImage(title: string, subtitle: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: "80px 88px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 96,
            fontWeight: 600,
            letterSpacing: -3,
            marginBottom: 24,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 30,
            color: "#a3a3a3",
            display: "flex",
          }}
        >
          {subtitle}
        </div>
      </div>
    ),
    size,
  );
}
