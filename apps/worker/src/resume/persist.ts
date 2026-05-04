/**
 * R2 persistence for the resume pipeline.
 *
 * Writes the validated Resume JSON to `resumes/{handle}/draft.json`,
 * then auto-publishes by copying draft.json → published.json so the
 * public `/{handle}` route goes live the moment the scan finishes.
 * The standalone `/api/profile/publish-resume` endpoint stays available
 * as a manual recovery path and as the republish target after edits.
 *
 * The key prefix is `resumes/` (not `scans/`), matching the convention
 * established by `apps/web/lib/resume-io.ts`.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

export function publishedResumeKey(handle: string): string {
  return `resumes/${handle.toLowerCase()}/published.json`;
}

function buildR2Client(): { client: S3Client; bucket: string } {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const bucket = requireEnv("R2_BUCKET_NAME");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket };
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

  const { client, bucket } = buildR2Client();

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

export interface CopyDraftToPublishedInput {
  handle: string;
  log?: (text: string) => void;
  /** Override the S3 client (tests). */
  client?: S3Client;
  bucket?: string;
}

export interface CopyDraftToPublishedResult {
  draftKey: string;
  publishedKey: string;
  bytes: number;
}

/**
 * Copy `resumes/{handle}/draft.json` → `resumes/{handle}/published.json`.
 * Called by the worker right after a scan succeeds so the public
 * `/{handle}` route goes live without a manual Publish click.
 *
 * R2 has no native server-side copy primitive, so we GET → PUT. The
 * draft we just wrote is 20–200 KB, so this completes in well under a
 * second. A partial failure (GET ok, PUT throws) leaves the previous
 * `published.json` in place — the manual Publish button remains as a
 * recovery path. Throws on failure so the caller decides whether to
 * surface it.
 */
export async function copyDraftToPublished(
  input: CopyDraftToPublishedInput,
): Promise<CopyDraftToPublishedResult> {
  const { handle, log } = input;
  const logFn = log ?? (() => {});

  const { client, bucket } = input.client && input.bucket
    ? { client: input.client, bucket: input.bucket }
    : buildR2Client();

  const draftKey = draftResumeKey(handle);
  const publishedKey = publishedResumeKey(handle);

  logFn(`[publish] copying ${draftKey} → ${publishedKey}\n`);

  const got = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: draftKey }),
  );
  const body = await got.Body?.transformToString();
  if (!body) {
    throw new Error(`copyDraftToPublished: empty body at ${draftKey}`);
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: publishedKey,
      Body: body,
      ContentType: "application/json",
      CacheControl: "no-store",
    }),
  );

  logFn(`[publish] live at /${handle.toLowerCase()} (${body.length} bytes)\n`);
  return { draftKey, publishedKey, bytes: body.length };
}
