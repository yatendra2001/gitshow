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
    in_flight: "Picking which repos matter",
    done: "Picked which repos matter",
    subtitle: "Signal-ranking the rest",
    tier: "silent",
  },
  inventory: {
    id: "inventory",
    in_flight: "Studying your top repos",
    done: "Studied your top repos",
    subtitle: "Cloning and reading the code",
    tier: "single",
  },
  "repo-judge": {
    id: "repo-judge",
    in_flight: "Spotting what's distinctive",
    done: "Spotted what's distinctive",
    subtitle: "Reading READMEs to decide what to feature",
    tier: "single",
  },
  fetchers: {
    id: "fetchers",
    in_flight: "Gathering context from across the web",
    done: "Gathered context from across the web",
    subtitle: "LinkedIn, your blog, Twitter, papers, and more",
    tier: "container",
    children: [
      "fetch:linkedin",
      "fetch:personal-site",
      "fetch:twitter",
      "fetch:hn",
      "fetch:devto",
      "fetch:medium",
      "fetch:orcid",
      "fetch:semantic-scholar",
      "fetch:arxiv",
      "fetch:stackoverflow",
      "fetch:youtube",
      "blog-import",
    ],
  },
  merge: {
    id: "merge",
    in_flight: "Organising the pieces",
    done: "Organised the pieces",
    subtitle: "Reconciling what each source said about you",
    tier: "single",
  },
  media: {
    id: "media",
    in_flight: "Finding cover images",
    done: "Found cover images",
    subtitle: "Project banners, company logos",
    tier: "silent",
  },
  "persist-kg": {
    id: "persist-kg",
    in_flight: "Saving the picture",
    done: "Saved the picture",
    tier: "silent",
  },
  "evaluate-kg": {
    id: "evaluate-kg",
    in_flight: "Double-checking everything",
    done: "Double-checked everything",
    tier: "silent",
  },
  "hero-prose": {
    id: "hero-prose",
    in_flight: "Writing your hero + about",
    done: "Wrote your hero + about",
    subtitle: "One line that names what you do",
    tier: "single",
  },
  render: {
    id: "render",
    in_flight: "Crafting your portfolio sections",
    done: "Crafted your portfolio sections",
    tier: "silent",
  },
  "persist-resume": {
    id: "persist-resume",
    in_flight: "Saving your draft",
    done: "Saved your draft",
    tier: "silent",
  },
  "persist-trace": {
    id: "persist-trace",
    in_flight: "Wrapping up",
    done: "Done",
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
  "fetch:linkedin": {
    in_flight: "Reading your LinkedIn",
    done: "Read your LinkedIn",
  },
  "fetch:personal-site": {
    in_flight: "Reading your personal site",
    done: "Read your personal site",
  },
  "fetch:twitter": {
    in_flight: "Reading your Twitter bio",
    done: "Read your Twitter bio",
  },
  "fetch:hn": {
    in_flight: "Checking Hacker News",
    done: "Checked Hacker News",
  },
  "fetch:devto": {
    in_flight: "Checking dev.to",
    done: "Checked dev.to",
  },
  "fetch:medium": {
    in_flight: "Checking Medium",
    done: "Checked Medium",
  },
  "fetch:orcid": {
    in_flight: "Looking up your ORCID",
    done: "Looked up your ORCID",
  },
  "fetch:semantic-scholar": {
    in_flight: "Searching Semantic Scholar",
    done: "Searched Semantic Scholar",
  },
  "fetch:arxiv": {
    in_flight: "Searching arXiv",
    done: "Searched arXiv",
  },
  "fetch:stackoverflow": {
    in_flight: "Reading your Stack Overflow",
    done: "Read your Stack Overflow",
  },
  "fetch:youtube": {
    in_flight: "Reading your YouTube channel",
    done: "Read your YouTube channel",
  },
  "blog-import": {
    in_flight: "Importing your blog posts",
    done: "Imported your blog posts",
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
