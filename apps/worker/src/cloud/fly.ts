/**
 * Minimal Fly Machines API client.
 *
 * Used by:
 *   - scripts/spawn-test-scan.ts (local smoke test)
 *   - apps/web POST /api/scan (production — spawn one machine per scan)
 *   - apps/web POST /api/scan/:id/retry (spawn a replacement machine against
 *     the same SCAN_ID to resume from R2 checkpoints).
 *
 * fetch-only, no Node-specific APIs, so this module is portable to the
 * Cloudflare Workers runtime when apps/web wires it up.
 */

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
}

export interface SpawnMachineInput {
  scanId: string;
  env: Record<string, string>;
  /** Machine name shown in the Fly dashboard. Defaults to `scan-<scanId>`. */
  name?: string;
  /** Override resources. Defaults to shared-cpu-2x / 2048 MB. */
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

  constructor(cfg: FlyConfig) {
    this.apiToken = cfg.apiToken;
    this.appName = cfg.appName;
    this.region = cfg.region;
    this.image = cfg.image;
  }

  static fromEnv(): FlyClient {
    const apiToken = requireEnv("FLY_API_TOKEN");
    const appName = requireEnv("FLY_APP_NAME");
    const region = process.env.FLY_REGION || "iad";
    const image = process.env.FLY_WORKER_IMAGE || `registry.fly.io/${appName}:latest`;
    return new FlyClient({ apiToken, appName, region, image });
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
          memory_mb: input.memoryMb ?? 2048,
        },
        // Evict on exit so we don't pay for zombie machines, and never
        // restart — a scan either finishes or is retried via a fresh spawn.
        auto_destroy: true,
        restart: { policy: "no" },
        metadata: {
          scan_id: input.scanId,
          spawned_by: "gitshow",
        },
      },
    };

    return this.request<FlyMachine>("POST", `/apps/${this.appName}/machines`, body);
  }

  async destroyMachine(machineId: string, force = true): Promise<void> {
    const qs = force ? "?force=true" : "";
    await this.request<void>(
      "DELETE",
      `/apps/${this.appName}/machines/${machineId}${qs}`,
    );
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
   * Otherwise returns the configured image unchanged.
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

  /**
   * Get the image ref of the app's current release via Fly's GraphQL API.
   * Works with deploy tokens scoped to the app (same token we use for
   * the Machines API).
   */
  async getCurrentImage(): Promise<string> {
    const query = `
      query ($name: String!) {
        app(name: $name) {
          currentReleaseUnprocessed { imageRef }
          currentRelease { imageRef }
        }
      }
    `;
    const resp = await fetch(GRAPHQL_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { name: this.appName } }),
    });
    if (!resp.ok) {
      throw new Error(`fly graphql: ${resp.status} ${await resp.text()}`);
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
      throw new Error(
        `fly graphql: ${json.errors.map((e) => e.message).join("; ")}`,
      );
    }
    const app = json.data?.app;
    const ref =
      app?.currentReleaseUnprocessed?.imageRef ??
      app?.currentRelease?.imageRef ??
      null;
    if (!ref) {
      throw new Error(
        `fly graphql: no image for app ${this.appName} — has it been deployed?`,
      );
    }
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`missing required env var: ${name}`);
  }
  return v;
}
