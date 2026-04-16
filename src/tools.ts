import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MAX_OUTPUT_SIZE = 50_000;
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 20 * 1024 * 1024;

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

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_SIZE) return output;
  return (
    output.slice(0, MAX_OUTPUT_SIZE) +
    `\n\n[... output truncated at ${MAX_OUTPUT_SIZE} bytes; narrow the query to see more]`
  );
}

/**
 * Execute a bash command inside the repo root. Used by the scanner agent's
 * bash tool to inspect the repository.
 */
export async function executeBash(repoPath: string, command: string): Promise<string> {
  const safety = checkSafety(command);
  if (!safety.safe) {
    return `[denied] ${safety.reason}`;
  }
  try {
    const { stdout, stderr } = await execFileAsync("/bin/bash", ["-c", command], {
      cwd: repoPath,
      maxBuffer: MAX_BUFFER,
      timeout: COMMAND_TIMEOUT_MS,
    });
    const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
    return truncate(combined || "[no output]");
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const parts = [
      `[error] ${e.message ?? String(err)}`,
      e.stdout ? `[stdout]\n${e.stdout}` : "",
      e.stderr ? `[stderr]\n${e.stderr}` : "",
    ].filter(Boolean);
    return truncate(parts.join("\n"));
  }
}

export const BASH_TOOL_DESCRIPTION =
  "Execute a bash command in the repository root. Use this for git commands (log, show, blame, diff, shortlog), file navigation (ls, find, cat, head, tail, wc), and repo inspection. Output is capped at ~50KB per call — if you hit the cap, narrow your query by piping to head, filtering with grep, or using --max-count. Commands run inside the cloned repo.";

export const SUBMIT_TOOL_DESCRIPTION =
  "Submit the final scan result as structured JSON. Call this exactly once, when you have gathered enough evidence to populate all three metrics (durability, adaptability, ownership), the repo summary, and the commit classifications. After the tool returns, you should end the turn — the caller has the data.";
