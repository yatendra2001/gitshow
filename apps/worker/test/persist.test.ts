/**
 * Unit tests for the auto-publish R2 plumbing in resume/persist.ts.
 *
 * The worker calls `copyDraftToPublished` immediately after marking a
 * scan succeeded so that gitshow.io/{handle} goes live without a
 * manual click. These tests pin the contract the run-scan flow
 * relies on:
 *   - GET draft.json → PUT published.json with the same body
 *   - Lowercase handle in both keys (matches publishedResumeKey)
 *   - Throws if the draft body is missing (so run-scan logs and falls
 *     back to the manual Publish button instead of silently lying)
 */

import { describe, expect, test } from "bun:test";
import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  copyDraftToPublished,
  draftResumeKey,
  publishedResumeKey,
} from "../src/resume/persist.js";

interface FakeR2 {
  client: S3Client;
  puts: Array<{ key: string; body: string; contentType?: string }>;
  gets: string[];
}

function makeFakeR2(opts: {
  draftBody?: string | null;
  putShouldThrow?: boolean;
}): FakeR2 {
  const puts: FakeR2["puts"] = [];
  const gets: string[] = [];
  const client = {
    send: async (cmd: GetObjectCommand | PutObjectCommand) => {
      if (cmd instanceof GetObjectCommand) {
        gets.push(cmd.input.Key ?? "");
        if (opts.draftBody == null) {
          return { Body: { transformToString: async () => "" } };
        }
        const body = opts.draftBody;
        return { Body: { transformToString: async () => body } };
      }
      if (cmd instanceof PutObjectCommand) {
        if (opts.putShouldThrow) throw new Error("simulated r2 PUT failure");
        puts.push({
          key: cmd.input.Key ?? "",
          body: String(cmd.input.Body ?? ""),
          contentType: cmd.input.ContentType,
        });
        return {};
      }
      throw new Error(`unexpected command: ${(cmd as object).constructor.name}`);
    },
  } as unknown as S3Client;
  return { client, puts, gets };
}

describe("key helpers", () => {
  test("draft + published keys lowercase the handle", () => {
    expect(draftResumeKey("YatendraKumar")).toBe(
      "resumes/yatendrakumar/draft.json",
    );
    expect(publishedResumeKey("YatendraKumar")).toBe(
      "resumes/yatendrakumar/published.json",
    );
  });
});

describe("copyDraftToPublished", () => {
  test("copies draft.json bytes verbatim into published.json", async () => {
    const draftBody = JSON.stringify({ schema: "1.4.0", handle: "alice" });
    const { client, puts, gets } = makeFakeR2({ draftBody });

    const result = await copyDraftToPublished({
      handle: "Alice",
      client,
      bucket: "test-bucket",
    });

    expect(gets).toEqual(["resumes/alice/draft.json"]);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.key).toBe("resumes/alice/published.json");
    expect(puts[0]!.body).toBe(draftBody);
    expect(puts[0]!.contentType).toBe("application/json");
    expect(result).toEqual({
      draftKey: "resumes/alice/draft.json",
      publishedKey: "resumes/alice/published.json",
      bytes: draftBody.length,
    });
  });

  test("throws when the draft body is empty (caller should fall back)", async () => {
    const { client, puts } = makeFakeR2({ draftBody: null });
    await expect(
      copyDraftToPublished({
        handle: "ghost",
        client,
        bucket: "test-bucket",
      }),
    ).rejects.toThrow(/empty body/);
    expect(puts).toHaveLength(0); // never wrote a corrupt published.json
  });

  test("propagates R2 PUT failures so run-scan can mark auto-publish failed", async () => {
    const { client } = makeFakeR2({
      draftBody: "{}",
      putShouldThrow: true,
    });
    await expect(
      copyDraftToPublished({
        handle: "bob",
        client,
        bucket: "test-bucket",
      }),
    ).rejects.toThrow(/simulated r2 PUT failure/);
  });
});
