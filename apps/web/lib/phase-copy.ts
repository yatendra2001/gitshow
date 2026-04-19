/**
 * User-facing strings for each pipeline phase. The pipeline phase names
 * (e.g. `github-fetch`, `workers`, `bind`) read like engineering jargon.
 * Everywhere the UI would otherwise show one of those raw names, we look
 * it up here instead.
 *
 * One rule: no LLM / beat / inventory / adapter / claim-speak on screen.
 * Users don't care about "beats" or "discover" — they want to feel that
 * gitshow is reading their code and writing their story.
 */
import type { PipelinePhase } from "@gitshow/shared/events";

export interface PhaseCopy {
  /** Short title for the active-phase card. */
  title: string;
  /** Live activity string shown while the phase runs. */
  activity: string;
  /** Tiny caption shown under done phases, past tense. */
  done: string;
}

export const PHASE_COPY: Record<PipelinePhase, PhaseCopy> = {
  "github-fetch": {
    title: "Reading your GitHub",
    activity: "Pulling repos, PRs, and review history…",
    done: "Read your GitHub history",
  },
  "repo-filter": {
    title: "Finding repos worth a deep look",
    activity: "Sorting everything by signal…",
    done: "Picked the repos that matter",
  },
  inventory: {
    title: "Reading your code",
    activity: "Cloning and mining commit histories, in parallel…",
    done: "Read your code",
  },
  normalize: {
    title: "Building the evidence table",
    activity: "Tying every commit, PR, and review to a stable id…",
    done: "Built the evidence table",
  },
  discover: {
    title: "Looking for what's distinctive",
    activity: "Summarizing what makes you recognizable…",
    done: "Found what's distinctive about you",
  },
  workers: {
    title: "Running six deep-dives at once",
    activity:
      "Cross-repo patterns, timing, code quality, social signals, depth, reviews…",
    done: "Ran six parallel analyses",
  },
  hook: {
    title: "Writing your opening line",
    activity: "Picking the right angle, then drafting five candidates…",
    done: "Wrote your opening line",
  },
  numbers: {
    title: "Picking your three best numbers",
    activity: "Choosing KPIs that back up the opener…",
    done: "Picked your three best numbers",
  },
  disclosure: {
    title: "Writing the honest-flaw paragraph",
    activity: "Finding the trade-off worth naming…",
    done: "Wrote the honest-flaw paragraph",
  },
  shipped: {
    title: "Cataloging what you've shipped",
    activity: "Pulling out the projects worth leading with…",
    done: "Cataloged what you've shipped",
  },
  assemble: {
    title: "Putting your profile together",
    activity: "Copy-editing for voice and flow…",
    done: "Assembled your profile",
  },
  critic: {
    title: "Double-checking every claim",
    activity: "Downgrading anything that doesn't hold up…",
    done: "Reviewed every claim",
  },
  bind: {
    title: "Linking claims to commits",
    activity: "Attaching a receipt to every sentence…",
    done: "Linked every claim to a commit",
  },
};

export const PHASE_ORDER: readonly PipelinePhase[] = [
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
];

/**
 * Humanize a sub-worker name when it appears inside the activity stream.
 * Keeps the chat pane approachable — "cross-repo" reads like bucket-case
 * detritus; "Looking across your repos for patterns" reads like a narrator.
 */
export const WORKER_COPY: Record<string, string> = {
  "cross-repo": "Looking across your repos for patterns",
  temporal: "Tracking how your output shifts over time",
  content: "Reading what your commit subjects actually say",
  signal: "Checking social proof — stars, forks, mentions",
  "deep-dive": "Going deep on the most interesting repo",
  reviews: "Reading how people reviewed your PRs",
};

export function humanizeWorker(name: string): string {
  return WORKER_COPY[name] ?? name;
}
