/**
 * R2 persistence for the resume pipeline.
 *
 * Writes the validated Resume JSON to `resumes/{handle}/draft.json`.
 * The frontend `/{handle}` route reads `published.json` — the draft →
 * published transition happens via an explicit user "Publish" action
 * in the webapp (`/api/profile/publish`), which copies draft.json →
 * published.json in R2 atomically.
 *
 * The key prefix is `resumes/` (not `scans/`), matching the convention
 * established by `apps/web/lib/resume-io.ts`.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Resume } from "@gitshow/shared/resume";
import { requireEnv } from "../util.js";

export interface WriteDraftResumeInput {
  handle: string;
  resume: Resume;
  log?: (text: string) => void;
}

export function draftResumeKey(handle: string): string {
  return `resumes/${handle.toLowerCase()}/draft.json`;
}

/**
 * Upload `resume` to R2 at `resumes/{handle}/draft.json`.
 *
 * Uses the same env layout as the rest of the worker's cloud code
 * (CF_ACCOUNT_ID + R2_BUCKET_NAME + R2_ACCESS_KEY_ID +
 * R2_SECRET_ACCESS_KEY). Throws on failure so the caller can surface
 * the error to the user instead of silently losing work.
 */
export async function writeDraftResume(
  input: WriteDraftResumeInput,
): Promise<void> {
  const { handle, resume, log } = input;
  const logFn = log ?? (() => {});

  const accountId = requireEnv("CF_ACCOUNT_ID");
  const bucket = requireEnv("R2_BUCKET_NAME");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const key = draftResumeKey(handle);
  const body = JSON.stringify(resume, null, 2);

  logFn(`[persist] uploading ${key} (${body.length} bytes)\n`);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      CacheControl: "no-store",
    }),
  );

  logFn(`[persist] done.\n`);
}
