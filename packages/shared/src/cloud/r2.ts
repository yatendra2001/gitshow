/**
 * R2 storage client for scan checkpoints (Fly worker side — Node.js only
 * because of `node:fs` usage in hydrateToLocal).
 *
 * Keys are laid out as `scans/{scan_id}/{filename}`.
 *
 * Inside the Next.js app running on Cloudflare Workers, prefer the native
 * `env.BUCKET` binding over this client — binding access is zero-cost,
 * whereas this class ships the @aws-sdk/client-s3 bundle.
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
import { requireEnv, consoleLogger, type Logger } from "../util";

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  logger?: Logger;
}

export class R2Client {
  private client: S3Client;
  private bucket: string;
  private log: Logger;

  constructor(cfg: R2Config) {
    this.bucket = cfg.bucket;
    this.log = (cfg.logger ?? consoleLogger).child({ src: "r2" });
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  static fromEnv(opts?: { logger?: Logger }): R2Client {
    const accountId = requireEnv("CF_ACCOUNT_ID");
    const bucket = requireEnv("R2_BUCKET_NAME");
    const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
    const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
    return new R2Client({
      accountId,
      bucket,
      accessKeyId,
      secretAccessKey,
      logger: opts?.logger,
    });
  }

  private scanKey(scanId: string, filename: string): string {
    return `scans/${scanId}/${filename}`;
  }

  async uploadStageFile(
    scanId: string,
    filename: string,
    data: unknown,
  ): Promise<void> {
    const key = this.scanKey(scanId, filename);
    const body =
      typeof data === "string" ? data : JSON.stringify(data, null, 2);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: "application/json",
        }),
      );
    } catch (err) {
      this.log.error(
        { err, scan_id: scanId, key, bytes: body.length },
        "upload failed",
      );
      throw err;
    }
  }

  async listScanKeys(scanId: string): Promise<string[]> {
    const prefix = `scans/${scanId}/`;
    const keys: string[] = [];
    let continuationToken: string | undefined;
    try {
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
    } catch (err) {
      this.log.error({ err, scan_id: scanId, prefix }, "list failed");
      throw err;
    }
    return keys;
  }

  async downloadKey(key: string): Promise<string> {
    try {
      const resp = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = resp.Body;
      if (!body) throw new Error(`r2: empty body for key ${key}`);
      return await body.transformToString();
    } catch (err) {
      this.log.error({ err, key }, "download failed");
      throw err;
    }
  }

  /**
   * Pull every object under `scans/{scanId}/` into `localDir`, preserving
   * the relative path under the prefix. Creates the local dir if missing.
   * Returns the number of files hydrated.
   */
  async hydrateToLocal(scanId: string, localDir: string): Promise<number> {
    const prefix = `scans/${scanId}/`;
    const keys = await this.listScanKeys(scanId);
    if (keys.length === 0) {
      this.log.info(
        { scan_id: scanId, local_dir: localDir },
        "nothing to hydrate (fresh scan)",
      );
      return 0;
    }

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
    this.log.info(
      { scan_id: scanId, files: count, local_dir: localDir },
      "hydrated",
    );
    return count;
  }
}
