/**
 * Human-readable labels for every pipeline stage, worker, and tool.
 *
 * Rules (from the /ux-copy pass):
 *   - Second person: "your commits", "your code".
 *   - Present continuous in flight, past tense with a number when done.
 *   - Outcome, not operation: never "normalize", "bind", "emit-card".
 *   - ≤ 5 words title, ≤ 10 subtitle.
 *   - No internal jargon: no "worker", "agent", "pipeline".
 *
 * UI consumers import from @gitshow/shared/phase-copy. Any new phase
 * added to PIPELINE_PHASES must gain a matching entry here — the
 * `phaseCopy(name)` helper falls back to the raw id so missing entries
 * are visible in QA but don't crash the app.
 */

export type PhaseTier = "silent" | "single" | "multi" | "container";

export interface PhaseCopy {
  /** Stable internal id (matches PIPELINE_PHASES). */
  id: string;
  /** Title while the phase is running: "Reading your code". */
  in_flight: string;
  /** Title once complete: "Read 14,203 commits". UI injects numbers from stage-end detail. */
  done: string;
  /** One-line context shown under the title. */
  subtitle?: string;
  /** Narrative tier — controls collapse/disclose behavior. */
  tier: PhaseTier;
  /** For container stages, the internal names of child agents. */
  children?: string[];
}

export const PHASE_COPY: Record<string, PhaseCopy> = {
  "github-fetch": {
    id: "github-fetch",
    in_flight: "Reading your GitHub",
    done: "Read your GitHub",
    subtitle: "Pulling repos, PRs, and review history",
    tier: "silent",
  },
  "repo-filter": {
    id: "repo-filter",
    in_flight: "Picking what's worth a deep read",
    done: "Chose which repos to go deep on",
    subtitle: "Signal-ranking the rest",
    tier: "silent",
  },
  inventory: {
    id: "inventory",
    in_flight: "Reading your code",
    done: "Read your code",
    subtitle: "Cloning and mining commit histories",
    tier: "multi",
  },
  normalize: {
    id: "normalize",
    in_flight: "Organizing the evidence",
    done: "Indexed the evidence",
    subtitle: "Tying every commit and PR to a stable id",
    tier: "silent",
  },
  discover: {
    id: "discover",
    in_flight: "Finding what makes you distinctive",
    done: "Found what makes you distinctive",
    subtitle: "What you're recognizable for",
    tier: "single",
  },
  workers: {
    id: "workers",
    in_flight: "Running 6 investigations in parallel",
    done: "Finished 6 investigations",
    subtitle: "Breadth, rhythm, quality, signals, depth, reviews",
    tier: "container",
    children: [
      "cross-repo",
      "temporal",
      "content",
      "signal",
      "deep-dive",
      "reviews",
    ],
  },
  hook: {
    id: "hook",
    in_flight: "Writing your opener",
    done: "Picked your opener",
    subtitle: "One line that names what you do",
    tier: "container",
    children: ["angle-selector", "hook-writer", "hook-critic"],
  },
  numbers: {
    id: "numbers",
    in_flight: "Picking your three best numbers",
    done: "Chose 3 KPIs with receipts",
    subtitle: "Durability, adaptability, ownership",
    tier: "single",
  },
  disclosure: {
    id: "disclosure",
    in_flight: "Writing the honest paragraph",
    done: "Wrote your honest paragraph",
    subtitle: "What you're moving past",
    tier: "single",
  },
  shipped: {
    id: "shipped",
    in_flight: "Cataloging what you've shipped",
    done: "Pulled your projects forward",
    subtitle: "The work worth leading with",
    tier: "single",
  },
  assemble: {
    id: "assemble",
    in_flight: "Writing in your voice",
    done: "Finished the voice pass",
    subtitle: "Removing AI-prose tells",
    tier: "single",
  },
  critic: {
    id: "critic",
    in_flight: "Double-checking every claim",
    done: "Verified every claim",
    subtitle: "Downgrading anything soft",
    tier: "single",
  },
  bind: {
    id: "bind",
    in_flight: "Attaching receipts",
    done: "Linked every claim to evidence",
    subtitle: "Commits, PRs, reviews",
    tier: "silent",
  },
};

/**
 * Child / worker / sub-agent copy. Used when a container stage expands
 * or when the Reasoning block needs a human title for a sub-agent.
 */
export const WORKER_COPY: Record<string, { in_flight: string; done: string; subtitle?: string }> = {
  "cross-repo": {
    in_flight: "Mapping your breadth",
    done: "Mapped your breadth",
    subtitle: "PRs outside your own repos",
  },
  temporal: {
    in_flight: "Tracking your cadence",
    done: "Tracked your cadence",
    subtitle: "When and how often you ship",
  },
  content: {
    in_flight: "Reading your commit messages",
    done: "Read your commit messages",
    subtitle: "Bug-to-feature ratio, refactor density",
  },
  signal: {
    in_flight: "Checking external recognition",
    done: "Checked external recognition",
    subtitle: "Stars, adoption, press, talks",
  },
  "deep-dive": {
    in_flight: "Studying your biggest repo",
    done: "Studied your biggest repo",
    subtitle: "Architecture, ownership, impact",
  },
  reviews: {
    in_flight: "Reading what teammates said",
    done: "Read your teammates' reviews",
    subtitle: "External validation of your code",
  },
  "angle-selector": {
    in_flight: "Choosing the right framing",
    done: "Chose the framing",
  },
  "hook-writer": {
    in_flight: "Drafting 5 candidate openers",
    done: "Drafted 5 candidate openers",
  },
  "hook-critic": {
    in_flight: "Scoring your opener drafts",
    done: "Picked your strongest draft",
  },
  "copy-editor": {
    in_flight: "Writing in your voice",
    done: "Voice pass complete",
  },
};

/**
 * Tool-call labels. Each entry turns a raw tool name + its input into
 * a ux-copy-compliant label shown on the inline Tool card.
 *
 * The resolver gets the parsed input so it can inject specifics
 * ("Reading commits in caddy-plugin"). Fallback: "Running {name}".
 */
export const TOOL_COPY: Record<string, (input?: unknown) => string> = {
  run: (input) => {
    const cmd = pickString(input, "command") ?? "";
    if (cmd.startsWith("gh ")) return `Asking GitHub · ${truncate(cmd.slice(3), 40)}`;
    if (cmd.startsWith("git log")) return `Reading commit history`;
    if (cmd.startsWith("git show")) return `Opening a commit`;
    if (cmd.startsWith("grep") || cmd.startsWith("rg"))
      return `Searching your code`;
    if (cmd.startsWith("cat ") || cmd.startsWith("head "))
      return `Reading a file`;
    return `Running: ${truncate(cmd, 48)}`;
  },
  query_artifacts: () => "Searching the evidence table",
  search_code: (input) => {
    const pat = pickString(input, "pattern") ?? pickString(input, "query");
    return pat ? `Searching code for "${truncate(pat, 30)}"` : "Searching your code";
  },
  search_github: (input) => {
    const q = pickString(input, "query");
    return q ? `Searching GitHub · ${truncate(q, 36)}` : "Searching GitHub";
  },
  browse_web: (input) => {
    const url = pickString(input, "url");
    return url ? `Opening ${shortDomain(url)}` : "Checking the web";
  },
  search_web: (input) => {
    const q = pickString(input, "query");
    return q ? `Searching the web · ${truncate(q, 36)}` : "Searching the web";
  },
  read_file: (input) => {
    const p = pickString(input, "path");
    return p ? `Reading ${truncate(p, 40)}` : "Reading a file";
  },
};

/**
 * Resolve a display label for a tool invocation. Falls back to
 * "Running {name}" when no copy entry exists, so new tools stay
 * visible in the UI even before we've written human labels for them.
 */
export function toolLabel(name: string, input?: unknown): string {
  const entry = TOOL_COPY[name];
  if (entry) {
    try {
      return entry(input);
    } catch {
      /* fall through */
    }
  }
  return `Running ${name}`;
}

/**
 * Look up phase copy with a safe fallback for new/unknown phases.
 */
export function phaseCopy(id: string): PhaseCopy {
  return (
    PHASE_COPY[id] ?? {
      id,
      in_flight: id,
      done: id,
      tier: "single",
    }
  );
}

/**
 * Look up worker copy with a safe fallback.
 */
export function workerCopy(id: string): { in_flight: string; done: string; subtitle?: string } {
  return WORKER_COPY[id] ?? { in_flight: id, done: id };
}

// ─── helpers ───────────────────────────────────────────────────────

function pickString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function shortDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "");
  } catch {
    return truncate(url, 30);
  }
}
