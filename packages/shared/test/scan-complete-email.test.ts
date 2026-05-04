/**
 * Unit tests for the scan-complete email render.
 *
 * Pin the auto-publish copy contract: when the worker successfully
 * promoted draft.json → published.json (the new default), the email
 * celebrates "you're live", points the CTA at the public profile,
 * and drops the legacy "publish before sharing" three-step ladder.
 * The pre-auto-publish copy stays as a fallback path so failed
 * auto-publishes still send a useful email.
 */

import { describe, expect, test } from "bun:test";
import { renderScanComplete } from "../src/notifications/email.js";

describe("renderScanComplete — auto-published (new default)", () => {
  test("subject + body announce the live URL", async () => {
    const out = await renderScanComplete({
      handle: "alice",
      profileUrl: "https://gitshow.io/alice",
      autoPublished: true,
    });

    expect(out.subject).toBe("You're live at gitshow.io/alice");
    expect(out.html).toContain("You&#x27;re live at gitshow.io/alice");
    expect(out.html).toContain("View your live profile");
    expect(out.html).toContain("Two things you can do now");
    expect(out.text).toContain("View your live profile");
  });

  test("drops the legacy three-step 'before you publish' ladder", async () => {
    const out = await renderScanComplete({
      handle: "alice",
      profileUrl: "https://gitshow.io/alice",
      autoPublished: true,
    });
    expect(out.html).not.toContain("Three things before you publish");
    expect(out.html).not.toContain("Review your draft");
  });
});

describe("renderScanComplete — fallback (auto-publish failed)", () => {
  test("falls back to legacy 'review your draft' copy", async () => {
    const out = await renderScanComplete({
      handle: "alice",
      profileUrl: "https://gitshow.io/app",
      autoPublished: false,
    });
    expect(out.subject).toBe("Your gitshow draft is ready, @alice");
    expect(out.html).toContain("Review your draft");
    expect(out.html).toContain("Three things before you publish");
    expect(out.html).not.toContain("View your live profile");
  });

  test("autoPublished defaults to false (backwards-compat)", async () => {
    const out = await renderScanComplete({
      handle: "alice",
      profileUrl: "https://gitshow.io/app",
    });
    expect(out.subject).toBe("Your gitshow draft is ready, @alice");
  });
});
