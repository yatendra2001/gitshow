/**
 * Scan session — one per `gitshow scan` invocation.
 *
 * The session.id doubles as OpenRouter's `session_id`, so every LLM call
 * made during a scan is grouped together in the OpenRouter dashboard.
 * Cost, latency, and tool-call traces are queryable per scan.
 *
 * If a scan crashes and resumes, the same session.id is reused so the
 * dashboard shows one continuous trace.
 */

import { nanoid } from "nanoid";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SCAN_MODEL } from "@gitshow/shared/models";
import type { ScanSession, ScanSocials } from "./schemas.js";

const OPENROUTER_DASHBOARD = "https://openrouter.ai/sessions";

export interface CreateSessionInput {
  handle: string;
  socials?: ScanSocials;
  context_notes?: string;
  model?: string;
  cost_cap_usd?: number;
}

/**
 * Create a fresh scan session. The id is deterministic in shape
 * (`gitshow-<handle>-<yymmdd>-<nanoid-8>`) so it's easy to spot in logs
 * and in the OpenRouter dashboard.
 */
export function createScanSession(input: CreateSessionInput): ScanSession {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 8); // yyyymmdd
  const id = `gitshow-${sanitize(input.handle)}-${stamp}-${nanoid(8)}`;
  return {
    id,
    handle: input.handle,
    socials: input.socials ?? {},
    context_notes: input.context_notes,
    started_at: new Date().toISOString(),
    dashboard_url: `${OPENROUTER_DASHBOARD}/${id}`,
    model: input.model ?? DEFAULT_SCAN_MODEL,
    // No cap by default — accuracy/quality > cost/time.
    cost_cap_usd: input.cost_cap_usd ?? Number.POSITIVE_INFINITY,
  };
}

/**
 * Safe filesystem-friendly form of a handle. Used for session filenames,
 * checkpoint directories, and repo-clone paths.
 * Exported so every module uses the same transformation — one source of truth.
 */
export function sanitizeHandle(handle: string): string {
  return handle.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "anon";
}
const sanitize = sanitizeHandle; // local alias kept for readability below

// ──────────────────────────────────────────────────────────────
// Persistence — so a resumed scan reuses the same session.id
// ──────────────────────────────────────────────────────────────

const SESSIONS_DIR = "sessions";

/** Path to the session file for a given handle. */
function sessionPath(handle: string): string {
  return join(SESSIONS_DIR, `${sanitize(handle)}.json`);
}

/** Persist the session so a future resume picks up the same id. */
export async function saveSession(session: ScanSession): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  await writeFile(sessionPath(session.handle), JSON.stringify(session, null, 2));
}

/** Load an existing session for this handle, if any. */
export async function loadSession(handle: string): Promise<ScanSession | null> {
  const path = sessionPath(handle);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as ScanSession;
  } catch {
    return null;
  }
}

/**
 * Get or create the session for a handle.
 * If `forceNew` is true, always creates a fresh session (used when user
 * explicitly starts a new scan vs. resuming).
 */
export async function resolveSession(
  input: CreateSessionInput & { forceNew?: boolean }
): Promise<{ session: ScanSession; resumed: boolean }> {
  if (!input.forceNew) {
    const existing = await loadSession(input.handle);
    if (existing) return { session: existing, resumed: true };
  }
  const session = createScanSession(input);
  await saveSession(session);
  return { session, resumed: false };
}

// ──────────────────────────────────────────────────────────────
// Usage tracker — accumulated across the scan
// ──────────────────────────────────────────────────────────────

/**
 * Lightweight in-memory accumulator for llm call count, tokens, estimated cost.
 * Lives for the duration of one scan; mirrored into PipelineMeta on persistence.
 */
export class SessionUsage {
  llmCalls = 0;
  webCalls = 0;
  githubSearchCalls = 0;
  totalTokens = 0;
  estimatedCostUsd = 0;
  errors: string[] = [];

  recordLlmCall(opts: {
    tokens?: number;
    estimatedCostUsd?: number;
  }): void {
    this.llmCalls += 1;
    this.totalTokens += opts.tokens ?? 0;
    this.estimatedCostUsd += opts.estimatedCostUsd ?? 0;
  }

  recordWebCall(): void {
    this.webCalls += 1;
  }

  recordGithubSearchCall(): void {
    this.githubSearchCalls += 1;
  }

  recordError(msg: string): void {
    this.errors.push(`[${new Date().toISOString()}] ${msg}`);
  }

  /** True if we've exceeded the session's cost cap. */
  exceededCostCap(session: ScanSession): boolean {
    return this.estimatedCostUsd >= session.cost_cap_usd;
  }
}
