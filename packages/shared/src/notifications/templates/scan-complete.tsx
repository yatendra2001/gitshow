import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface ScanCompleteEmailProps {
  handle: string;
  profileUrl: string;
  logoUrl?: string;
  /** Founder's first name — used in the personal signature. */
  founderName?: string;
  /**
   * Whether the worker successfully auto-published the profile to
   * `/{handle}` at scan completion. Drives the celebratory "you're
   * live" copy + the public profile button. Defaults to false for
   * backwards-compatibility with the legacy "review your draft"
   * framing (kept as a fallback when auto-publish fails).
   */
  autoPublished?: boolean;
}

const colors = {
  bg: "#f5f5f3",
  card: "#ffffff",
  border: "#e8e8e5",
  ink: "#111111",
  body: "#3a3a37",
  muted: "#8a8a85",
  faint: "#b5b5af",
  accent: "#10b981",
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const monoStack =
  '"SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace';

export function ScanCompleteEmail({
  handle,
  profileUrl,
  logoUrl,
  founderName = "Yatendra",
  autoPublished = false,
}: ScanCompleteEmailProps) {
  const liveUrl = `gitshow.io/${handle}`;
  return (
    <Html>
      <Head />
      <Preview>
        {autoPublished
          ? `You're live at ${liveUrl} — share it, tweak it, tell me what you think.`
          : `Your gitshow draft is ready — have a look, tweak anything, and tell me what you think.`}
      </Preview>
      <Body
        style={{
          margin: 0,
          padding: "32px 16px",
          backgroundColor: colors.bg,
          fontFamily: fontStack,
          color: colors.ink,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: "16px",
            overflow: "hidden",
          }}
        >
          <Section style={{ padding: "28px 32px 0 32px" }}>
            <table role="presentation" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  {logoUrl ? (
                    <td valign="middle" style={{ paddingRight: "10px" }}>
                      <Img
                        src={logoUrl}
                        width="28"
                        height="28"
                        alt="gitshow"
                        style={{ display: "block", borderRadius: "6px" }}
                      />
                    </td>
                  ) : null}
                  <td valign="middle">
                    <Text
                      style={{
                        margin: 0,
                        fontSize: "15px",
                        fontWeight: 600,
                        letterSpacing: "-0.015em",
                        color: colors.ink,
                      }}
                    >
                      gitshow
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section style={{ padding: "16px 32px 0 32px" }}>
            <Text
              style={{
                margin: "0 0 12px 0",
                fontSize: "12px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: colors.accent,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "6px",
                  height: "6px",
                  borderRadius: "999px",
                  backgroundColor: colors.accent,
                  marginRight: "8px",
                  verticalAlign: "middle",
                }}
              />
              {autoPublished ? "You're live" : "Scan complete"}
            </Text>
            <Heading
              as="h1"
              style={{
                margin: 0,
                fontSize: "30px",
                lineHeight: "1.15",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: colors.ink,
              }}
            >
              {autoPublished ? `You're live at ${liveUrl}.` : "Your draft is ready."}
            </Heading>
            <Text
              style={{
                margin: "20px 0 0 0",
                fontSize: "15px",
                lineHeight: "1.6",
                color: colors.body,
              }}
            >
              Hey,
            </Text>
            <Text
              style={{
                margin: "12px 0 0 0",
                fontSize: "15px",
                lineHeight: "1.6",
                color: colors.body,
              }}
            >
              gitshow finished reading the commits, PRs, and reviews for{" "}
              <span style={{ fontFamily: monoStack, color: colors.ink, fontSize: "14px" }}>
                @{handle}
              </span>
              .{" "}
              {autoPublished
                ? "Your portfolio is already live — every claim is anchored to the work that proves it. Share the URL, or jump in and tweak anything."
                : "Every claim in your portfolio is anchored to the work that proves it — no fluff, just receipts."}
            </Text>
          </Section>

          <Section style={{ padding: "28px 32px 0 32px" }}>
            <Button
              href={profileUrl}
              style={{
                display: "inline-block",
                padding: "13px 22px",
                backgroundColor: colors.ink,
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: 600,
                lineHeight: 1,
                letterSpacing: "-0.005em",
                borderRadius: "10px",
                textDecoration: "none",
              }}
            >
              {autoPublished ? "View your live profile →" : "Review your draft →"}
            </Button>
          </Section>

          <Section style={{ padding: "28px 32px 0 32px" }}>
            <Hr
              style={{
                margin: "0 0 20px 0",
                border: "none",
                borderTop: `1px solid ${colors.border}`,
              }}
            />
            <Text
              style={{
                margin: "0 0 14px 0",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: colors.muted,
              }}
            >
              {autoPublished ? "Two things you can do now" : "Three things before you publish"}
            </Text>
            {autoPublished ? (
              <>
                <NextStep
                  n="01"
                  title="Share"
                  body={`Your URL is ${liveUrl}. Drop it in your bio, your résumé, your next intro DM.`}
                />
                <NextStep
                  n="02"
                  title="Edit"
                  body="Reorder, rewrite, drop anything that doesn't sound like you. Edits go live the moment you save."
                  last
                />
              </>
            ) : (
              <>
                <NextStep
                  n="01"
                  title="Review"
                  body="Skim the claims I surfaced. Each one links back to the commit, PR, or review."
                />
                <NextStep
                  n="02"
                  title="Edit"
                  body="Reorder, rewrite, drop anything that doesn't sound like you. The editor is live."
                />
                <NextStep
                  n="03"
                  title="Publish"
                  body="Share your gitshow URL when it feels right. You can keep iterating after."
                  last
                />
              </>
            )}
          </Section>

          <Section style={{ padding: "28px 32px 0 32px" }}>
            <Text
              style={{
                margin: 0,
                fontSize: "14px",
                lineHeight: "1.6",
                color: colors.body,
              }}
            >
              Anything that looks off, or feedback you want to share? Just reply to this email
              — it goes straight to me, and I read every one.
            </Text>
            <Text
              style={{
                margin: "20px 0 0 0",
                fontSize: "14px",
                lineHeight: "1.5",
                color: colors.body,
              }}
            >
              — {founderName}
              <br />
              <span style={{ color: colors.muted, fontSize: "13px" }}>
                founder, gitshow
              </span>
            </Text>
          </Section>

          <Section style={{ padding: "28px 32px 28px 32px" }}>
            <Hr
              style={{
                margin: "0 0 16px 0",
                border: "none",
                borderTop: `1px solid ${colors.border}`,
              }}
            />
            <Text
              style={{
                margin: 0,
                fontSize: "12px",
                lineHeight: "1.5",
                color: colors.muted,
              }}
            >
              <span style={{ color: colors.ink, fontWeight: 600 }}>gitshow</span> · your
              engineering portfolio, in motion.
            </Text>
            <Text
              style={{
                margin: "6px 0 0 0",
                fontSize: "12px",
                color: colors.faint,
                wordBreak: "break-all",
              }}
            >
              If the button doesn't work, paste this into your browser:{" "}
              <Link
                href={profileUrl}
                style={{ color: colors.muted, textDecoration: "underline" }}
              >
                {profileUrl}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function NextStep({
  n,
  title,
  body,
  last,
}: {
  n: string;
  title: string;
  body: string;
  last?: boolean;
}) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      width="100%"
      style={{ marginBottom: last ? 0 : "14px", borderCollapse: "collapse" }}
    >
      <tbody>
        <tr>
          <td
            valign="top"
            style={{
              width: "44px",
              paddingTop: "2px",
              fontFamily: monoStack,
              fontSize: "12px",
              fontWeight: 600,
              color: colors.faint,
              letterSpacing: "0",
            }}
          >
            {n}
          </td>
          <td valign="top">
            <Text
              style={{
                margin: 0,
                fontSize: "14px",
                fontWeight: 600,
                color: colors.ink,
                letterSpacing: "-0.005em",
              }}
            >
              {title}
            </Text>
            <Text
              style={{
                margin: "2px 0 0 0",
                fontSize: "13px",
                lineHeight: "1.55",
                color: colors.body,
              }}
            >
              {body}
            </Text>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export default ScanCompleteEmail;
