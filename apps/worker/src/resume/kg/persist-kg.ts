/**
 * R2 persistence for the KnowledgeGraph snapshot.
 *
 * Two paths:
 *   kg/{handle}/latest.json       — overwritten per scan (source of truth)
 *   kg/{handle}/scan-{scanId}.json — immutable snapshot (cross-scan diffing)
 *
 * Best-effort: we never fail the scan over a KG-persistence error. The
 * pipeline still ships the draft Resume even if R2 is unavailable.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { KnowledgeGraph } from "@gitshow/shared/kg";

export function kgLatestKey(handle: string): string {
  return `kg/${handle.toLowerCase()}/latest.json`;
}
export function kgSnapshotKey(handle: string, scanId: string): string {
  return `kg/${handle.toLowerCase()}/scan-${scanId}.json`;
}

export interface WriteKgInput {
  handle: string;
  scanId: string;
  kg: KnowledgeGraph;
  log?: (text: string) => void;
}

export interface WriteKgResult {
  latestKey: string;
  snapshotKey: string;
  ok: boolean;
  error?: string;
  bytes: number;
}

export async function writeKgToR2(input: WriteKgInput): Promise<WriteKgResult> {
  const { handle, scanId, kg, log } = input;
  const logFn = log ?? (() => {});

  const latestKey = kgLatestKey(handle);
  const snapshotKey = kgSnapshotKey(handle, scanId);
  const body = JSON.stringify(kg, null, 2);

  const accountId = process.env.CF_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    logFn(`[kg] skipping R2 upload — missing R2 env\n`);
    return { latestKey, snapshotKey, ok: false, error: "missing-env", bytes: body.length };
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    await Promise.all([
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: latestKey,
          Body: body,
          ContentType: "application/json",
          CacheControl: "no-store",
        }),
      ),
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: snapshotKey,
          Body: body,
          ContentType: "application/json",
          CacheControl: "max-age=31536000, immutable",
        }),
      ),
    ]);
    logFn(`[kg] wrote ${latestKey} + ${snapshotKey} (${body.length} bytes)\n`);
    return { latestKey, snapshotKey, ok: true, bytes: body.length };
  } catch (err) {
    const message = (err as Error).message;
    logFn(`[kg] R2 upload failed: ${message}\n`);
    return { latestKey, snapshotKey, ok: false, error: message, bytes: body.length };
  }
}
