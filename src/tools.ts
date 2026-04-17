import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Layer 1 — Execution: raw Unix semantics
// ---------------------------------------------------------------------------

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

const COMMAND_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 20 * 1024 * 1024; // 20 MB

const DENIED_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+(\/|~|\$HOME)/,
  /\bcurl\b[^|]*\|\s*(bash|sh)\b/,
  /\bwget\b[^|]*\|\s*(bash|sh)\b/,
  /\bchmod\s+777\b/,
  /\bnc\s+-[elL]/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,
];

function checkSafety(command: string): { safe: true } | { safe: false; reason: string } {
  for (const pattern of DENIED_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: `command matches denied pattern ${pattern}` };
    }
  }
  return { safe: true };
}

/**
 * Layer 1: execute a bash command and return the raw result.
 * Pipes, redirects, and subshells all work — we spawn /bin/bash -c.
 */
export async function executeBashRaw(cwd: string, command: string): Promise<ExecResult> {
  const safety = checkSafety(command);
  if (!safety.safe) {
    return { stdout: "", stderr: `[denied] ${safety.reason}`, exitCode: 1, durationMs: 0 };
  }

  const start = performance.now();
  try {
    const { stdout, stderr } = await execFileAsync("/bin/bash", ["-c", command], {
      cwd,
      maxBuffer: MAX_BUFFER,
      timeout: COMMAND_TIMEOUT_MS,
    });
    return { stdout, stderr, exitCode: 0, durationMs: Math.round(performance.now() - start) };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    const exitCode = typeof e.code === "number" ? e.code : 1;
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
      exitCode,
      durationMs: Math.round(performance.now() - start),
    };
  }
}

// ---------------------------------------------------------------------------
// Layer 2 — Presentation: what the LLM agent sees
// ---------------------------------------------------------------------------

const MAX_LINES = 200;
let tempFileCounter = 0;

function isBinary(buf: string): boolean {
  if (buf.length === 0) return false;
  let controlCount = 0;
  const len = Math.min(buf.length, 8192); // sample first 8 KB
  for (let i = 0; i < len; i++) {
    const code = buf.charCodeAt(i);
    if (code === 0) return true; // null byte → binary
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controlCount++;
  }
  return controlCount / len > 0.1;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Layer 2: execute + format for the LLM agent.
 * Binary guard, overflow with temp-file navigation, metadata footer.
 */
export async function executeBash(cwd: string, command: string): Promise<string> {
  const raw = await executeBashRaw(cwd, command);

  // --- binary guard ---
  if (isBinary(raw.stdout)) {
    const size = Buffer.byteLength(raw.stdout, "utf-8");
    return `[binary output (${formatSize(size)}). If image, use: see <path>]\n[exit:${raw.exitCode} | ${raw.durationMs}ms]`;
  }

  const lines = raw.stdout.split("\n");
  const parts: string[] = [];

  // --- overflow mode ---
  if (lines.length > MAX_LINES) {
    const truncated = lines.slice(0, MAX_LINES).join("\n");
    const totalBytes = Buffer.byteLength(raw.stdout, "utf-8");
    const counter = ++tempFileCounter;
    const tmpPath = `/tmp/gitshow-cmd-${counter}.txt`;
    writeFileSync(tmpPath, raw.stdout, "utf-8");

    parts.push(truncated);
    parts.push("");
    parts.push(`--- truncated (${lines.length.toLocaleString()} lines, ${formatSize(totalBytes)}) ---`);
    parts.push(`Full output: ${tmpPath}`);
    parts.push(`Explore: cat ${tmpPath} | grep <pattern>`);
    parts.push(`         cat ${tmpPath} | tail 100`);
  } else {
    const content = raw.stdout || "[no output]";
    parts.push(content);
  }

  // --- stderr attachment ---
  if (raw.stderr) {
    parts.push(`[stderr]\n${raw.stderr}`);
  }

  // --- error-as-navigation hints ---
  if (raw.exitCode !== 0 && !raw.stderr) {
    parts.push(`[command failed with no stderr — check exit code]`);
  }

  // --- metadata footer ---
  parts.push(`[exit:${raw.exitCode} | ${raw.durationMs}ms]`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Tool descriptions (backward compat)
// ---------------------------------------------------------------------------

export const BASH_TOOL_DESCRIPTION =
  "Execute a bash command in the repository root. Use this for git commands (log, show, blame, diff, shortlog), file navigation (ls, find, cat, head, tail, wc), and repo inspection. Long output is auto-truncated to 200 lines with a temp-file link for deeper exploration. Commands run inside the cloned repo.";

export const SUBMIT_TOOL_DESCRIPTION =
  "Submit the final scan result as structured JSON. Call this exactly once, when you have gathered enough evidence to populate all three metrics (durability, adaptability, ownership), the repo summary, and the commit classifications. After the tool returns, you should end the turn — the caller has the data.";
