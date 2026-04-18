/**
 * Checkpoint persistence for the v2 pipeline.
 *
 * Each stage of the pipeline writes its output to `profiles/<handle>/`
 * immediately on completion. If the process crashes, re-running with the
 * same handle resumes from the last completed stage. The OpenRouter
 * session_id is reused on resume so the dashboard shows one continuous
 * trace across runs.
 *
 * Files under profiles/<handle>/:
 *   checkpoint.json           — current phase + metadata + session ref
 *   01-github-data.json       — raw GitHub API data (from gh CLI)
 *   02-filter.json            — repo tiering
 *   03-inventories.json       — per-repo StructuredInventory (clone + git-inventory)
 *   04-normalized.json        — { artifacts, indexes } from normalize()
 *   05-discover.json          — DiscoverOutput
 *   06-workers.json           — WorkerOutput[] (cross-repo, temporal, content, signal)
 *   07-hook.json              — { candidates, critic, winner }
 *   08-numbers.json           — WorkerOutput (numbers agent)
 *   09-disclosure.json        — WorkerOutput (0 or 1 claim)
 *   10-shipped.json           — WorkerOutput (up to 7 claims)
 *   11-profile-draft.json     — assembled Profile before critic
 *   12-critic.json            — ProfileCriticOutput
 *   13-profile.json           — final Profile (post-critic revisions)
 *   web-cache/                — cached browse_web / search_web results
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { ScanSession } from "./schemas.js";
import { sanitizeHandle } from "./session.js";

export type ScanPhase =
  | "init"
  | "github-fetch"
  | "repo-filter"
  | "inventory"
  | "normalize"
  | "discover"
  | "workers"
  | "hook"
  | "numbers"
  | "disclosure"
  | "shipped"
  | "assemble"
  | "critic"
  | "bind"
  | "complete";

const PHASE_ORDER: readonly ScanPhase[] = [
  "init",
  "github-fetch",
  "repo-filter",
  "inventory",
  "normalize",
  "discover",
  "workers",
  "hook",
  "numbers",
  "disclosure",
  "shipped",
  "assemble",
  "critic",
  "bind",
  "complete",
] as const;

const PHASE_SET: Record<string, true> = Object.fromEntries(
  PHASE_ORDER.map((p) => [p, true]),
);

export function phaseIndex(phase: ScanPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

/** Should we (re)run `target` given current phase `current`? */
export function shouldRun(current: ScanPhase, target: ScanPhase): boolean {
  return phaseIndex(current) < phaseIndex(target);
}

export interface ScanCheckpointMeta {
  handle: string;
  session_id: string;
  phase: ScanPhase;
  started_at: string;
  updated_at: string;
  completed_inventories: string[];  // repo fullNames whose inventory is cached
  errors: string[];
}

/**
 * Fired after every successful local checkpoint write — both stage files
 * (`01-github-data.json`, ..., `14-card.json`) and the meta file
 * (`checkpoint.json`). The cloud entrypoint uses this to mirror writes into
 * R2. Throws propagate up and fail the stage, so a failed upload fails
 * the scan loudly instead of silently drifting between local and cloud.
 */
export type CheckpointSaveHook = (
  filename: string,
  data: unknown,
) => Promise<void>;

export class ScanCheckpoint {
  private dir: string;
  private meta: ScanCheckpointMeta;
  private onSaveFile?: CheckpointSaveHook;

  constructor(
    session: ScanSession,
    baseDir = "profiles",
    onSaveFile?: CheckpointSaveHook,
  ) {
    this.dir = join(baseDir, sanitizeHandle(session.handle));
    this.onSaveFile = onSaveFile;
    this.meta = {
      handle: session.handle,
      session_id: session.id,
      phase: "init",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_inventories: [],
      errors: [],
    };
  }

  get checkpointDir(): string {
    return this.dir;
  }
  get webCacheDir(): string {
    return join(this.dir, "web-cache");
  }
  get currentPhase(): ScanPhase {
    return this.meta.phase;
  }
  get sessionId(): string {
    return this.meta.session_id;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await mkdir(this.webCacheDir, { recursive: true });
  }

  async loadExisting(): Promise<ScanCheckpointMeta | null> {
    const p = join(this.dir, "checkpoint.json");
    if (!existsSync(p)) return null;
    try {
      const raw = await readFile(p, "utf-8");
      const loaded = JSON.parse(raw) as Record<string, unknown>;

      // Migration: detect a v1 checkpoint (no session_id, old phase names,
      // completedRepos camelCase). If v1, reset phase to "repo-filter" so
      // the existing 01-github-data.json and 02-filter.json can be reused
      // but all new LLM stages re-run cleanly.
      const isV1 =
        !("session_id" in loaded) ||
        ("completedRepos" in loaded) ||
        (typeof loaded.phase === "string" &&
          !(loaded.phase as string in PHASE_SET));

      if (isV1) {
        // Keep handle + reset to "github-fetch" so:
        //   01-github-data.json — reused (format unchanged)
        //   02-filter.json       — regenerated under new filename
        //   everything past it   — re-runs cleanly under the v2 pipeline
        this.meta = {
          ...this.meta,
          handle: String(loaded.handle ?? this.meta.handle),
          phase: "github-fetch",
          completed_inventories: [],
          errors: Array.isArray(loaded.errors) ? (loaded.errors as string[]) : [],
          updated_at: new Date().toISOString(),
        };
        await this.saveMeta();
        return this.meta;
      }

      this.meta = loaded as unknown as ScanCheckpointMeta;
      return this.meta;
    } catch {
      return null;
    }
  }

  async setPhase(phase: ScanPhase): Promise<void> {
    this.meta.phase = phase;
    this.meta.updated_at = new Date().toISOString();
    await this.saveMeta();
  }

  addError(msg: string): void {
    this.meta.errors.push(`[${new Date().toISOString()}] ${msg}`);
  }

  markInventoryComplete(repoFullName: string): void {
    if (!this.meta.completed_inventories.includes(repoFullName)) {
      this.meta.completed_inventories.push(repoFullName);
    }
  }
  isInventoryComplete(repoFullName: string): boolean {
    return this.meta.completed_inventories.includes(repoFullName);
  }

  private async saveMeta(): Promise<void> {
    // Route through saveFile so the onSaveFile hook fires for checkpoint.json
    // too (cloud mode relies on this to mirror meta into R2).
    await this.saveFile("checkpoint.json", this.meta);
  }

  // ── Generic save/load ────────────────────────────────────
  async saveFile(name: string, data: unknown): Promise<void> {
    await writeFile(join(this.dir, name), JSON.stringify(data, null, 2));
    if (this.onSaveFile) {
      await this.onSaveFile(name, data);
    }
  }
  async loadFile<T>(name: string): Promise<T | null> {
    const p = join(this.dir, name);
    if (!existsSync(p)) return null;
    try {
      const raw = await readFile(p, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  // ── Stage-specific save helpers (enforce file naming) ───
  async saveGitHubData(data: unknown) {
    await this.saveFile("01-github-data.json", data);
    await this.setPhase("github-fetch");
  }
  async saveFilter(data: unknown) {
    await this.saveFile("02-filter.json", data);
    await this.setPhase("repo-filter");
  }
  async saveInventories(data: unknown) {
    await this.saveFile("03-inventories.json", data);
    await this.setPhase("inventory");
  }
  async saveNormalized(data: unknown) {
    await this.saveFile("04-normalized.json", data);
    await this.setPhase("normalize");
  }
  async saveDiscover(data: unknown) {
    await this.saveFile("05-discover.json", data);
    await this.setPhase("discover");
  }
  async saveWorkers(data: unknown) {
    await this.saveFile("06-workers.json", data);
    await this.setPhase("workers");
  }
  async saveHook(data: unknown) {
    await this.saveFile("07-hook.json", data);
    await this.setPhase("hook");
  }
  async saveNumbers(data: unknown) {
    await this.saveFile("08-numbers.json", data);
    await this.setPhase("numbers");
  }
  async saveDisclosure(data: unknown) {
    await this.saveFile("09-disclosure.json", data);
    await this.setPhase("disclosure");
  }
  async saveShipped(data: unknown) {
    await this.saveFile("10-shipped.json", data);
    await this.setPhase("shipped");
  }
  async saveProfileDraft(data: unknown) {
    await this.saveFile("11-profile-draft.json", data);
    await this.setPhase("assemble");
  }
  async saveCritic(data: unknown) {
    await this.saveFile("12-critic.json", data);
    await this.setPhase("critic");
  }
  async saveProfile(data: unknown) {
    await this.saveFile("13-profile.json", data);
    await this.setPhase("bind");
  }
  async markComplete() {
    await this.setPhase("complete");
  }
}

