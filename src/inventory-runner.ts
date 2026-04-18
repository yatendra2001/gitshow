/**
 * Clone-and-inventory runner — one repo's data at a time.
 *
 * Kept separate from pipeline.ts so the orchestrator stays focused on
 * stage sequencing. Retries transient network / auth errors; persists
 * the clone under `<profileDir>/repos/<safe>/` for the code tools to
 * reuse on later runs.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getStructuredInventory } from "./git-inventory.js";
import type { StructuredInventory } from "./types.js";

const execFileAsync = promisify(execFile);

const MAX_RETRIES = 3;

/** Transient error signatures we should retry vs. fail fast. */
function isTransient(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("timeout") ||
    m.includes("network") ||
    m.includes("econnreset") ||
    m.includes("socket hang up") ||
    m.includes("502") ||
    m.includes("503") ||
    m.includes("504") ||
    m.includes("429") ||
    m.includes("rate limit")
  );
}

export interface CloneAndInventoryInput {
  /** Repo in "owner/name" form. */
  fullName: string;
  /** GitHub handle to attribute commits to. */
  handle: string;
  /** Profile directory; clone goes under `<profileDir>/repos/<safe>/`. */
  profileDir: string;
  /** Progress logger. */
  log: (text: string) => void;
}

/**
 * Ensure the repo is cloned under the profile dir, then run the
 * structured-inventory scan over the clone.
 */
export async function cloneAndInventory(
  input: CloneAndInventoryInput,
): Promise<StructuredInventory> {
  const { fullName, handle, profileDir, log } = input;
  const safeName = fullName.replace(/\//g, "-");
  const clonePath = join(profileDir, "repos", safeName);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (!existsSync(join(clonePath, ".git"))) {
        log(`[inv] cloning ${fullName}${attempt > 1 ? ` (retry ${attempt})` : ""}...\n`);
        await mkdir(join(profileDir, "repos"), { recursive: true });
        // Full checkout — code-reading tools want the working tree.
        // No timeout — huge repos legitimately take a while.
        await execFileAsync("gh", ["repo", "clone", fullName, clonePath], {
          timeout: 0,
        });
      } else {
        log(`[inv] reusing existing clone of ${fullName}\n`);
      }
      log(`[inv] inventorying ${fullName}...\n`);
      return await getStructuredInventory(clonePath, handle);
    } catch (err) {
      lastError = err as Error;
      if (!isTransient(lastError.message) || attempt >= MAX_RETRIES) {
        throw lastError;
      }
      const waitMs = attempt * 5000;
      log(
        `[inv] transient error on ${fullName}: ${lastError.message.slice(0, 100)}; retry in ${waitMs / 1000}s\n`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError ?? new Error("cloneAndInventory: exhausted retries");
}
