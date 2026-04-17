/**
 * Checkpoint persistence system.
 *
 * Saves pipeline state to disk after each phase so that:
 * 1. Progress is never lost if a phase crashes/times out
 * 2. The pipeline can resume from the last completed phase
 * 3. We can analyze agent performance by reading the checkpoint files
 *
 * Checkpoint directory: profiles/<handle>/
 *   checkpoint.json         — current phase + metadata
 *   01-github-data.json     — GitHub API data
 *   02-filtered-repos.json  — filtered repo list
 *   03-systems.json         — system mapping
 *   04-repo-<name>.json     — per-repo analysis (one per repo)
 *   05-external-<name>.json — per-external-repo PR analysis
 *   06-synthesis.json       — synthesized profile (pre-evaluation)
 *   07-evaluation.json      — evaluator result
 *   08-final.json           — final ProfileResult
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type CheckpointPhase =
  | "init"
  | "github-fetch"
  | "repo-filter"
  | "system-map"
  | "repo-analysis"
  | "pr-analysis"
  | "synthesis"
  | "evaluation"
  | "complete";

export interface CheckpointMeta {
  handle: string;
  phase: CheckpointPhase;
  startedAt: string;
  updatedAt: string;
  completedRepos: string[];
  completedExternalRepos: string[];
  agentCalls: number;
  errors: string[];
}

export class CheckpointManager {
  private dir: string;
  private meta: CheckpointMeta;

  constructor(handle: string, baseDir: string = "profiles") {
    this.dir = join(baseDir, handle);
    this.meta = {
      handle,
      phase: "init",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedRepos: [],
      completedExternalRepos: [],
      agentCalls: 0,
      errors: [],
    };
  }

  get checkpointDir(): string {
    return this.dir;
  }

  /** Initialize checkpoint directory. */
  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /** Check if a previous checkpoint exists and load it. */
  async loadExisting(): Promise<CheckpointMeta | null> {
    const metaPath = join(this.dir, "checkpoint.json");
    if (!existsSync(metaPath)) return null;
    try {
      const raw = await readFile(metaPath, "utf-8");
      this.meta = JSON.parse(raw) as CheckpointMeta;
      return this.meta;
    } catch {
      return null;
    }
  }

  /** Update phase and persist metadata. */
  async setPhase(phase: CheckpointPhase): Promise<void> {
    this.meta.phase = phase;
    this.meta.updatedAt = new Date().toISOString();
    await this.saveMeta();
  }

  /** Increment agent call count. */
  incrementAgentCalls(): void {
    this.meta.agentCalls++;
  }

  /** Record an error. */
  addError(msg: string): void {
    this.meta.errors.push(`[${new Date().toISOString()}] ${msg}`);
  }

  /** Mark a repo analysis as completed. */
  markRepoComplete(repoName: string): void {
    if (!this.meta.completedRepos.includes(repoName)) {
      this.meta.completedRepos.push(repoName);
    }
  }

  /** Mark an external repo analysis as completed. */
  markExternalRepoComplete(repoName: string): void {
    if (!this.meta.completedExternalRepos.includes(repoName)) {
      this.meta.completedExternalRepos.push(repoName);
    }
  }

  /** Check if a repo was already analyzed in a previous run. */
  isRepoComplete(repoName: string): boolean {
    return this.meta.completedRepos.includes(repoName);
  }

  /** Check if an external repo was already analyzed. */
  isExternalRepoComplete(repoName: string): boolean {
    return this.meta.completedExternalRepos.includes(repoName);
  }

  /** Get the last completed phase. */
  get currentPhase(): CheckpointPhase {
    return this.meta.phase;
  }

  get totalAgentCalls(): number {
    return this.meta.agentCalls;
  }

  /** Generic save for arbitrary files in the checkpoint dir. */
  async saveFile(filename: string, data: unknown): Promise<void> {
    await writeFile(
      join(this.dir, filename),
      JSON.stringify(data, null, 2)
    );
  }

  // ── Save helpers ──

  private async saveMeta(): Promise<void> {
    await writeFile(
      join(this.dir, "checkpoint.json"),
      JSON.stringify(this.meta, null, 2)
    );
  }

  async saveGitHubData(data: unknown): Promise<void> {
    await writeFile(
      join(this.dir, "01-github-data.json"),
      JSON.stringify(data, null, 2)
    );
    await this.setPhase("github-fetch");
  }

  async saveFilteredRepos(data: unknown): Promise<void> {
    await writeFile(
      join(this.dir, "02-filtered-repos.json"),
      JSON.stringify(data, null, 2)
    );
    await this.setPhase("repo-filter");
  }

  async saveSystems(data: unknown): Promise<void> {
    await writeFile(
      join(this.dir, "03-systems.json"),
      JSON.stringify(data, null, 2)
    );
    await this.setPhase("system-map");
  }

  async saveRepoAnalysis(repoName: string, data: unknown): Promise<void> {
    // Sanitize repo name for filesystem (replace / with -)
    const safeName = repoName.replace(/\//g, "-");
    await writeFile(
      join(this.dir, `04-repo-${safeName}.json`),
      JSON.stringify(data, null, 2)
    );
    this.markRepoComplete(repoName);
    await this.saveMeta();
  }

  async saveExternalAnalysis(repoName: string, data: unknown): Promise<void> {
    const safeName = repoName.replace(/\//g, "-");
    await writeFile(
      join(this.dir, `05-external-${safeName}.json`),
      JSON.stringify(data, null, 2)
    );
    this.markExternalRepoComplete(repoName);
    await this.saveMeta();
  }

  async saveSynthesis(data: unknown): Promise<void> {
    await writeFile(
      join(this.dir, "06-synthesis.json"),
      JSON.stringify(data, null, 2)
    );
    await this.setPhase("synthesis");
  }

  async saveEvaluation(data: unknown): Promise<void> {
    await writeFile(
      join(this.dir, "07-evaluation.json"),
      JSON.stringify(data, null, 2)
    );
    await this.setPhase("evaluation");
  }

  async saveFinal(data: unknown): Promise<void> {
    await writeFile(
      join(this.dir, "08-final.json"),
      JSON.stringify(data, null, 2)
    );
    await this.setPhase("complete");
  }

  // ── Load helpers (for resume) ──

  async loadGitHubData<T>(): Promise<T | null> {
    return this.loadFile<T>("01-github-data.json");
  }

  async loadFilteredRepos<T>(): Promise<T | null> {
    return this.loadFile<T>("02-filtered-repos.json");
  }

  async loadSystems<T>(): Promise<T | null> {
    return this.loadFile<T>("03-systems.json");
  }

  async loadRepoAnalysis<T>(repoName: string): Promise<T | null> {
    const safeName = repoName.replace(/\//g, "-");
    return this.loadFile<T>(`04-repo-${safeName}.json`);
  }

  async loadExternalAnalysis<T>(repoName: string): Promise<T | null> {
    const safeName = repoName.replace(/\//g, "-");
    return this.loadFile<T>(`05-external-${safeName}.json`);
  }

  async loadSynthesis<T>(): Promise<T | null> {
    return this.loadFile<T>("06-synthesis.json");
  }

  async loadEvaluation<T>(): Promise<T | null> {
    return this.loadFile<T>("07-evaluation.json");
  }

  private async loadFile<T>(filename: string): Promise<T | null> {
    const path = join(this.dir, filename);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
