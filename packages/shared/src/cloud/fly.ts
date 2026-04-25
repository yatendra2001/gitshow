/**
 * Minimal Fly Machines API client. fetch-only, works in Node.js AND
 * Cloudflare Workers. Used by scripts in apps/worker today and by the
 * Next.js web app (/api/scan, /api/revise) to spawn scan/revise machines.
 */
import { requireEnv, consoleLogger, type Logger } from "../util";

const MACHINES_API = "https://api.machines.dev/v1";
const GRAPHQL_API = "https://api.fly.io/graphql";

/**
 * The sentinel for "ask Fly what the current deployed image is" — because
 * Fly doesn't auto-tag as `:latest`, the actual tag is a per-deploy
 * `deployment-XXX` string we can only learn via the GraphQL API.
 */
const RESOLVE_SENTINELS = new Set(["", ":latest"]);

export interface FlyConfig {
  apiToken: string;
  appName: string;
  region: string;
  /** Full image ref, or a sentinel like `registry.fly.io/<app>:latest` / empty to auto-resolve via GraphQL. */
  image: string;
  logger?: Logger;
}

export interface SpawnMachineInput {
  scanId: string;
  env: Record<string, string>;
  /** Machine name shown in the Fly dashboard. Defaults to `scan-<scanId>`. */
  name?: string;
  /** Override resources. Defaults to shared-cpu-2x / 4096 MB. */
  cpus?: number;
  cpuKind?: "shared" | "performance";
  memoryMb?: number;
  /**
   * Override the container's CMD. Used to dispatch to a different
   * entrypoint inside the same image — e.g. `["bun", "scripts/revise-claim.ts"]`
   * for revisions. If unset, the Dockerfile CMD (run-scan.ts) runs.
   */
  initCmd?: string[];
}

export interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  image_ref?: { registry?: string; repository?: string; tag?: string };
  private_ip?: string;
}

export class FlyClient {
  private apiToken: string;
  private appName: string;
  private region: string;
  private image: string;
  private log: Logger;

  constructor(cfg: FlyConfig) {
    this.apiToken = cfg.apiToken;
    this.appName = cfg.appName;
    this.region = cfg.region;
    this.image = cfg.image;
    this.log = (cfg.logger ?? consoleLogger).child({ src: "fly" });
  }

  static fromEnv(opts?: { logger?: Logger }): FlyClient {
    const apiToken = requireEnv("FLY_API_TOKEN");
    const appName = requireEnv("FLY_APP_NAME");
    const region =
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env?.FLY_REGION ?? "iad";
    const image =
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env?.FLY_WORKER_IMAGE ?? `registry.fly.io/${appName}:latest`;
    return new FlyClient({ apiToken, appName, region, image, logger: opts?.logger });
  }

  /**
   * Spawn a fresh, auto-destructing machine for one scan. Returns the
   * machine id so the caller can persist it (scans.fly_machine_id) for
   * later destroy/inspection.
   */
  async spawnScanMachine(input: SpawnMachineInput): Promise<FlyMachine> {
    const image = await this.resolveImage();
    const body = {
      name: input.name ?? `scan-${input.scanId}`,
      region: this.region,
      config: {
        image,
        env: input.env,
        ...(input.initCmd ? { init: { cmd: input.initCmd } } : {}),
        guest: {
          cpu_kind: input.cpuKind ?? "shared",
          cpus: input.cpus ?? 2,
          // 4 GB. Playwright Chromium baseline is ~350 MB; running it in
          // parallel with blog-import's Kimi reasoning stream and the
          // other parallel HTTP fetchers regularly OOMed the previous
          // 2 GB default — every scan died at ~1m30s into the fetchers
          // phase with no error, just a silent disappearance from
          // `fly machines list`.
          memory_mb: input.memoryMb ?? 4096,
        },
        auto_destroy: true,
        restart: { policy: "no" },
        metadata: {
          scan_id: input.scanId,
          spawned_by: "gitshow",
        },
      },
    };

    try {
      const machine = await this.request<FlyMachine>(
        "POST",
        `/apps/${this.appName}/machines`,
        body,
      );
      this.log.info(
        {
          scan_id: input.scanId,
          machine_id: machine.id,
          machine_name: machine.name,
          region: machine.region,
          image,
          init_cmd: input.initCmd ?? null,
        },
        "machine spawned",
      );
      return machine;
    } catch (err) {
      this.log.error({ err, scan_id: input.scanId, image }, "machine spawn failed");
      throw err;
    }
  }

  async destroyMachine(machineId: string, force = true): Promise<void> {
    const qs = force ? "?force=true" : "";
    try {
      await this.request<void>(
        "DELETE",
        `/apps/${this.appName}/machines/${machineId}${qs}`,
      );
      this.log.info({ machine_id: machineId, force }, "machine destroyed");
    } catch (err) {
      this.log.error({ err, machine_id: machineId }, "machine destroy failed");
      throw err;
    }
  }

  async getMachine(machineId: string): Promise<FlyMachine> {
    return this.request<FlyMachine>(
      "GET",
      `/apps/${this.appName}/machines/${machineId}`,
    );
  }

  /**
   * Resolve the image ref to spawn from. If the configured image is a
   * sentinel (`:latest` or empty), query Fly's GraphQL API for the app's
   * current release image — that's the only source of truth since Fly
   * tags each deploy with a unique `deployment-XXX` id, not `latest`.
   */
  async resolveImage(): Promise<string> {
    const tagSuffix = this.image.includes(":")
      ? this.image.slice(this.image.lastIndexOf(":"))
      : "";
    if (this.image !== "" && !RESOLVE_SENTINELS.has(tagSuffix)) {
      return this.image;
    }
    return this.getCurrentImage();
  }

  async getCurrentImage(): Promise<string> {
    const query = `
      query ($name: String!) {
        app(name: $name) {
          currentReleaseUnprocessed { imageRef }
          currentRelease { imageRef }
        }
      }
    `;
    let resp: Response;
    try {
      resp = await fetch(GRAPHQL_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables: { name: this.appName } }),
      });
    } catch (err) {
      this.log.error({ err, app: this.appName }, "graphql fetch failed");
      throw err;
    }
    if (!resp.ok) {
      const text = await resp.text();
      this.log.error(
        { status: resp.status, body: text.slice(0, 300), app: this.appName },
        "graphql http error",
      );
      throw new Error(`fly graphql: ${resp.status} ${text}`);
    }
    const json = (await resp.json()) as {
      data?: {
        app?: {
          currentReleaseUnprocessed?: { imageRef?: string | null } | null;
          currentRelease?: { imageRef?: string | null } | null;
        } | null;
      };
      errors?: Array<{ message: string }>;
    };
    if (json.errors && json.errors.length > 0) {
      const messages = json.errors.map((e) => e.message).join("; ");
      this.log.error({ errors: messages, app: this.appName }, "graphql returned errors");
      throw new Error(`fly graphql: ${messages}`);
    }
    const app = json.data?.app;
    const ref =
      app?.currentReleaseUnprocessed?.imageRef ??
      app?.currentRelease?.imageRef ??
      null;
    if (!ref) {
      this.log.error({ app: this.appName }, "graphql returned no image — app not yet deployed?");
      throw new Error(
        `fly graphql: no image for app ${this.appName} — has it been deployed?`,
      );
    }
    this.log.debug({ app: this.appName, image: ref }, "resolved current image");
    return ref;
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const resp = await fetch(`${MACHINES_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`fly ${method} ${path}: ${resp.status} ${text}`);
    }
    if (resp.status === 204 || method === "DELETE") return undefined as T;
    return (await resp.json()) as T;
  }
}
