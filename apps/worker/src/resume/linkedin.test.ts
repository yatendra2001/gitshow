/**
 * Sanity checks for the LinkedIn fallback chain's usability heuristic
 * + TinyFish client error shape. We do NOT hit the network here.
 *
 * Run: bun test apps/worker/src/resume/linkedin.test.ts
 */
import { describe, test, expect } from "bun:test";
import { __private, extractCompaniesFromNotes } from "./linkedin.js";
import { TinyFishClient } from "@gitshow/shared/cloud/tinyfish";

const { isUsable, MIN_TEXT_CHARS } = __private;

describe("linkedin.isUsable", () => {
  test("rejects null and empty", () => {
    expect(isUsable(null)).toBe(false);
    expect(isUsable("")).toBe(false);
    expect(isUsable(undefined)).toBe(false);
  });

  test("rejects short login-wall pages", () => {
    const loginWall = "Join LinkedIn to see more. Sign in to continue.";
    expect(loginWall.length).toBeLessThan(MIN_TEXT_CHARS);
    expect(isUsable(loginWall)).toBe(false);
  });

  test("accepts short non-login content (404 / small profiles)", () => {
    // Short but without login-wall keywords — we let it through so
    // small/empty profiles aren't misclassified.
    const short = "name: jane doe\nheadline: builder\nlocation: sf\n";
    expect(short.length).toBeLessThan(MIN_TEXT_CHARS);
    expect(isUsable(short)).toBe(true);
  });

  test("accepts long content even if it mentions sign-in (chrome text)", () => {
    const long =
      "Experience\n" +
      "Engineer at Foo · 2020 – 2022\n".repeat(80) +
      "Join LinkedIn · Sign in"; // header chrome at the end
    expect(long.length).toBeGreaterThan(MIN_TEXT_CHARS);
    expect(isUsable(long)).toBe(true);
  });

  test('rejects anything with a "Sign Up | LinkedIn" title, regardless of length', () => {
    // The TinyFish fetch of a logged-out linkedin.com/in/X returns a
    // "Sign Up | LinkedIn" title with variable body length (150 chars
    // in the observed case, but could be bigger). Title alone is the
    // definitive signal.
    expect(isUsable("a".repeat(MIN_TEXT_CHARS + 500), "Sign Up | LinkedIn")).toBe(false);
    expect(isUsable("body", "Sign In | LinkedIn")).toBe(false);
    expect(isUsable("body", "Log In | LinkedIn")).toBe(false);
    expect(isUsable("body", "Join LinkedIn")).toBe(false);
  });

  test("accepts legit long content with a normal title", () => {
    const long = "real content ".repeat(200);
    expect(isUsable(long, "Jane Doe | LinkedIn")).toBe(true);
  });
});

describe("linkedin.extractCompaniesFromNotes", () => {
  test("returns empty when nothing passed", () => {
    expect(extractCompaniesFromNotes(undefined)).toEqual([]);
    expect(extractCompaniesFromNotes("")).toEqual([]);
  });

  test("extracts @handles, dedupes", () => {
    const notes = "I worked @stripe and then @Anthropic; more @stripe time.";
    const out = extractCompaniesFromNotes(notes);
    expect(out).toContain("stripe");
    expect(out).toContain("Anthropic");
    expect(out.length).toBe(2);
  });
});

describe("TinyFishClient static construction", () => {
  test("fromEnv returns null when key missing", () => {
    const prev = process.env.TINYFISH_API_KEY;
    delete process.env.TINYFISH_API_KEY;
    try {
      expect(TinyFishClient.fromEnv()).toBeNull();
    } finally {
      if (prev !== undefined) process.env.TINYFISH_API_KEY = prev;
    }
  });

  test("fromEnv returns a client when key is set", () => {
    const prev = process.env.TINYFISH_API_KEY;
    process.env.TINYFISH_API_KEY = "tf_test";
    try {
      const c = TinyFishClient.fromEnv();
      expect(c).not.toBeNull();
    } finally {
      if (prev === undefined) delete process.env.TINYFISH_API_KEY;
      else process.env.TINYFISH_API_KEY = prev;
    }
  });
});

describe("TinyFishClient.fetchUrls error shape", () => {
  test("refuses batches over 10 URLs without calling the network", async () => {
    const client = new TinyFishClient({ apiKey: "x" });
    const urls = Array.from({ length: 11 }, (_, i) => `https://x${i}.com`);
    const r = await client.fetchUrls(urls);
    expect(r.ok).toBe(false);
    expect(r.requestError).toContain("too many urls");
  });

  test("empty array returns ok with empty results (no call)", async () => {
    const client = new TinyFishClient({ apiKey: "x" });
    const r = await client.fetchUrls([]);
    expect(r.ok).toBe(true);
    expect(r.results).toEqual([]);
  });
});
