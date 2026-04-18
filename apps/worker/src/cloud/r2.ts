/**
 * R2 storage client for scan checkpoints.
 *
 * Keys are laid out as `scans/{scan_id}/{filename}` — one prefix per scan.
 * A scan's R2 prefix mirrors its local `profiles/<handle>/` dir one-to-one:
 * same filenames, same JSON, same semantics. `hydrateToLocal` pulls every
 * file under a scan's prefix back to disk so the existing checkpoint loader
 * (`ScanCheckpoint.loadExisting`) can resume unchanged.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type _Object,
} from "@aws-sdk/client-s3";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class R2Client {
  private client: S3Client;
  private bucket: string;

  constructor(cfg: R2Config) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  static fromEnv(): R2Client {
    const accountId = requireEnv("CF_ACCOUNT_ID");
    const bucket = requireEnv("R2_BUCKET_NAME");
    const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
    const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
    return new R2Client({ accountId, bucket, accessKeyId, secretAccessKey });
  }

  private scanKey(scanId: string, filename: string): string {
    return `scans/${scanId}/${filename}`;
  }

  async uploadStageFile(
    scanId: string,
    filename: string,
    data: unknown,
  ): Promise<void> {
    const body =
      typeof data === "string" ? data : JSON.stringify(data, null, 2);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.scanKey(scanId, filename),
        Body: body,
        ContentType: "application/json",
      }),
    );
  }

  async listScanKeys(scanId: string): Promise<string[]> {
    const prefix = `scans/${scanId}/`;
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const resp = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of resp.Contents ?? []) {
        const k = (obj as _Object).Key;
        if (k) keys.push(k);
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  async downloadKey(key: string): Promise<string> {
    const resp = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = resp.Body;
    if (!body) throw new Error(`r2: empty body for key ${key}`);
    return await body.transformToString();
  }

  /**
   * Pull every object under `scans/{scanId}/` into `localDir`, preserving
   * the relative path under the prefix. Creates the local dir if missing.
   * Returns the number of files hydrated.
   */
  async hydrateToLocal(scanId: string, localDir: string): Promise<number> {
    const prefix = `scans/${scanId}/`;
    const keys = await this.listScanKeys(scanId);
    if (keys.length === 0) return 0;

    await mkdir(localDir, { recursive: true });
    let count = 0;
    for (const key of keys) {
      const rel = key.startsWith(prefix) ? key.slice(prefix.length) : key;
      const dest = join(localDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      const body = await this.downloadKey(key);
      await writeFile(dest, body, "utf-8");
      count++;
    }
    return count;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`missing required env var: ${name}`);
  }
  return v;
}
