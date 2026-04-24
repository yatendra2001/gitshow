/**
 * Discover — the first LLM stage.
 *
 * Reads a compact summary of everything we know about the developer and
 * writes a free-form paragraph describing what makes them distinctive.
 * Also produces 3-10 "investigation angles" — concrete threads workers
 * should pull on — and a one-line `primary_shape` hint.
 *
 * Deliberately under-structured. This is where the model gets to notice.
 * Workers downstream will be narrower.
 */

import { runAgentWithSubmit, type AgentEventEmit } from "./base.js";
import { toolLabel } from "@gitshow/shared/phase-copy";
import { modelForRole } from "@gitshow/shared/models";
import {
  DiscoverOutputSchema,
  type DiscoverOutput,
  type Artifact,
  type ScanSession,
} from "../schemas.js";
import type { SessionUsage } from "../session.js";
import type { ArtifactIndexes } from "../normalize.js";
import type { GitHubData } from "../types.js";

export interface DiscoverInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  artifacts: Record<string, Artifact>;
  indexes: ArtifactIndexes;
  onProgress?: (text: string) => void;
  /** Structured event emitter (reasoning-delta, tool-start/end, source-added). */
  emit?: AgentEventEmit;
  /** Scan's message_id. Attached to every emitted event. */
  messageId?: string;
}

/**
 * Discover has no tools today (one-shot reasoning call that submits a
 * structured output). The submit tool gets a dedicated label; anything
 * else falls back to the shared TOOL_COPY resolver so added tools
 * show up with sane copy immediately.
 */
const DISCOVER_TOOL_LABELS = (name: string, input?: unknown): string => {
  if (name === "submit_discover") return "Finalizing distinctive paragraph";
  return toolLabel(name, input);
};

const DISCOVER_PROMPT = `You are a perceptive developer profiler. Your job is to notice what makes one engineer different from another.

You'll receive a compact summary of a developer's GitHub history (owned repos, PRs, reviews, languages, activity) plus any social handles and context notes the user provided.

Write a short paragraph — 4-8 sentences — that captures what's distinctive about this specific person. Behavioral over categorical. Specific over general. Avoid filler like "passionate about technology" or "full-stack developer." If two developers could swap your paragraph without anyone noticing, rewrite it.

Then list 3-10 investigation angles for downstream workers to pull on. These are concrete threads specific to THIS developer, like:
  - "check if the 14 merged PRs to <some-org> show a sustained pattern or are one-off"
  - "look at what happened in 2024-Q3 when commit cadence spiked 3x on <some-repo>"
  - "verify whether the <bio mention> corresponds to a specific shipped project"
Use the developer's actual repos, orgs, numbers, dates — never a generic example.

Finally, provide a short \`primary_shape\` — one line, in your own words, like "solo AI-app shipper" or "OSS maintainer of a charting library". This is a hint, not a category.

RULES
- Do NOT reach for "fixed categories" (durability, adaptability, ownership). Those words are banned here.
- Do NOT include scores. No numbers out of 100.
- Do NOT make claims you can't back with the data given.
- Do NOT repeat the same fact in paragraph and angles.
- DO address employment context when a "team repo" signal is present — name the product, the likely employer, and the tenure window in plain language. If multiple team repos exist, identify the PRIMARY one. This is one of the highest-value things you can notice.
- If you don't know yet WHO is behind the team repo (who the company is, who founded it, what the product does in the world), include an investigation angle that tells downstream workers to confirm it via LinkedIn / personal site / product domain. Workers that get that angle will verify via browse_web and cite web evidence. Your paragraph can hint at the company when the team-repo name + internal doc mentions strongly suggest it, but never state an employer name as confirmed fact in the paragraph.

CONTEXT NOTES (user-provided, below) — how to use them:
- Treat them as LEADS, not as verified facts.
- Never state a context-note claim as if confirmed. Instead, turn it into an investigation angle so a downstream worker can verify it.
  - Bad: "self-reports a $250k+ package"  ← unsupported assertion leaks into the paragraph
  - Good: angle: "verify the $250k+ package claim — does it appear on the personal site, LinkedIn tagline, or a public source?"
- If context notes contradict the data, prefer the data.

When you're done thinking, call the submit_discover tool. Do not write anything after the tool call.`;

export async function runDiscover(input: DiscoverInput): Promise<DiscoverOutput> {
  const userMessage = buildDiscoverInput(input);

  const { result } = await runAgentWithSubmit({
    model: modelForRole("orchestrator"),
    systemPrompt: DISCOVER_PROMPT,
    input: userMessage,
    submitToolName: "submit_discover",
    submitToolDescription:
      "Submit the distinctive paragraph, investigation angles, and primary_shape hint. Call exactly once.",
    submitSchema: DiscoverOutputSchema,
    reasoning: { effort: "high" },
    session: input.session,
    usage: input.usage,
    label: "discover",
    onProgress: input.onProgress,
    emit: input.emit,
    toolLabels: DISCOVER_TOOL_LABELS,
    messageId: input.messageId,
  });

  return result;
}

function buildDiscoverInput(input: DiscoverInput): string {
  const { github, session, artifacts, indexes } = input;
  const lines: string[] = [];

  // Identity
  lines.push(`## Developer: @${session.handle}`);
  if (github.profile.name) lines.push(`Name: ${github.profile.name}`);
  if (github.profile.bio) lines.push(`Bio: ${github.profile.bio}`);
  if (github.profile.location) lines.push(`Location: ${github.profile.location}`);
  lines.push(`GitHub joined: ${github.profile.createdAt}`);
  lines.push(
    `Public repos: ${github.profile.publicRepos}, followers: ${github.profile.followers}, following: ${github.profile.following}`,
  );
  lines.push("");

  // Socials
  const s = session.socials;
  const socialsList: string[] = [];
  if (s.twitter) socialsList.push(`Twitter @${s.twitter}`);
  if (s.linkedin) socialsList.push(`LinkedIn ${s.linkedin}`);
  if (s.website) socialsList.push(`Site ${s.website}`);
  if (s.other && s.other.length > 0) socialsList.push(...s.other);
  if (socialsList.length > 0) {
    lines.push(`## Socials (user-provided)`);
    for (const x of socialsList) lines.push(`- ${x}`);
    lines.push("");
  }
  if (session.context_notes) {
    lines.push(`## Context notes (user-provided)`);
    lines.push(session.context_notes);
    lines.push("");
  }

  // Owned repos top ranked by user commit count.
  // IMPORTANT: we pull `user_commit_count` from the NORMALIZED repo artifact,
  // not from `github.ownedRepos.userCommitCount` — the latter is the stale
  // PR-based estimate from fetchRepos; the former is the git-log truth from
  // inventory. Using the wrong source is how the "679 vs 2,684" bug surfaces.
  lines.push(`## Owned repos (${indexes.ownedRepoIds.length}) — top by user commits`);
  const ownedRepoInfos = github.ownedRepos
    .filter((r) => !r.isArchived)
    .map((r) => {
      const art = artifacts[`repo:${r.fullName}`];
      const m = (art?.metadata ?? {}) as Record<string, unknown>;
      const commits = Number(m.user_commit_count ?? r.userCommitCount ?? 0);
      return { repo: r, commits };
    })
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 15);
  for (const { repo: r, commits } of ownedRepoInfos) {
    const langs = r.languages.slice(0, 3).join("/") || r.primaryLanguage || "?";
    const stars = r.stargazerCount ? ` · ★${r.stargazerCount}` : "";
    const desc = r.description ? ` — ${r.description.slice(0, 90)}` : "";
    // Also surface shipped-by-category so the agent frames contribution
    // as product output, not raw commit volume.
    const invArt = artifacts[`inventory:${r.fullName}`];
    const im = (invArt?.metadata ?? {}) as Record<string, unknown>;
    const feat = Number(im.features_shipped ?? 0);
    const bugs = Number(im.bugs_fixed ?? 0);
    const shippedTag = feat + bugs > 0 ? ` · shipped ${feat}ft/${bugs}bug` : "";
    lines.push(`- ${r.fullName} [${langs}${stars}] ${commits} commits${shippedTag}${desc}`);
  }
  lines.push("");

  // External contributions
  const extMap: Record<string, { count: number; merged: number }> = {};
  for (const pr of github.authoredPRs) {
    if (!pr.isExternal) continue;
    const cur = extMap[pr.repoFullName] ?? { count: 0, merged: 0 };
    cur.count += 1;
    if (pr.merged) cur.merged += 1;
    extMap[pr.repoFullName] = cur;
  }
  const extEntries = Object.entries(extMap).sort(
    (a, b) => b[1].count - a[1].count,
  );
  if (extEntries.length > 0) {
    lines.push(`## External contributions (${extEntries.length} repos)`);
    for (const [name, s] of extEntries.slice(0, 15)) {
      lines.push(`- ${name}: ${s.merged}/${s.count} merged`);
    }
    lines.push("");
  }

  // PR stats aggregate
  const internalPrs = github.authoredPRs.filter((p) => !p.isExternal);
  const internalMerged = internalPrs.filter((p) => p.merged).length;
  const externalTotal = github.authoredPRs.length - internalPrs.length;
  const externalMerged = github.authoredPRs.filter(
    (p) => p.isExternal && p.merged,
  ).length;
  lines.push(`## Pull requests`);
  lines.push(`- Authored: ${github.authoredPRs.length} (${internalMerged + externalMerged} merged)`);
  lines.push(`- Internal: ${internalPrs.length} on owned repos`);
  lines.push(`- External: ${externalTotal} on others' repos`);
  lines.push(`- Reviews submitted: ${github.submittedReviews.length}`);
  lines.push("");

  // Language / activity rollups from inventory artifacts
  const inventoryIds = (indexes.byRepo || {})
    ? Object.values(indexes.byRepo).flat().filter((id) => id.startsWith("inventory:"))
    : [];
  if (inventoryIds.length > 0) {
    const activity = aggregateActivity(inventoryIds, artifacts);
    lines.push(`## Activity signals (aggregated across deep-scanned repos)`);
    lines.push(
      `- Active days: ${activity.totalActiveDays}, longest streak: ${activity.longestStreak} days`,
    );
    lines.push(
      `- Survival: ${activity.survivingLoc.toLocaleString()} LOC surviving across ${activity.repoCount} repos`,
    );
    if (activity.topLangs.length > 0) {
      lines.push(
        `- Top languages (by insertions): ${activity.topLangs.map((l) => `${l.ext} (${l.ins.toLocaleString()})`).join(", ")}`,
      );
    }
    lines.push("");
  }

  // Team signal — repos that look like multi-person work. Strongest
  // employment clue available pre-investigation.
  const teamRepos: Array<{ id: string; a: Artifact }> = [];
  for (const id of inventoryIds) {
    const a = artifacts[id];
    if (!a) continue;
    if ((a.metadata as Record<string, unknown>).looks_like_team_repo) {
      teamRepos.push({ id, a });
    }
  }
  if (teamRepos.length > 0) {
    teamRepos.sort((x, y) => {
      const xc = Number((x.a.metadata as Record<string, unknown>).user_commits ?? 0);
      const yc = Number((y.a.metadata as Record<string, unknown>).user_commits ?? 0);
      return yc - xc;
    });
    lines.push(`## Team repos (multi-contributor, sustained) — STRONG EMPLOYMENT SIGNAL`);
    lines.push(
      `Primary-work repos = repos where the developer has worked alongside others for months. These are almost always where they are (or were) employed. Identify at least one if present.`,
    );
    for (const t of teamRepos.slice(0, 6)) {
      const m = t.a.metadata as Record<string, unknown>;
      const others = Array.isArray(m.other_top_contributors)
        ? (m.other_top_contributors as Array<{ name: string; email: string; commits: number }>).slice(0, 4)
        : [];
      lines.push(
        `- [${t.id}] ${m.repo}: ${m.user_commits} / ${m.total_commits} commits (rank #${m.user_rank_in_repo} of ${m.total_contributors}) · ${m.active_days}d · ${m.first_commit} → ${m.last_commit}`,
      );
      if (others.length > 0) {
        lines.push(
          `    teammates: ${others.map((c) => `${c.name} (${c.commits})`).join(", ")}`,
        );
      }
    }
    lines.push("");
  } else {
    lines.push(`## Team repos: (none detected — all analyzed repos appear solo)`);
    lines.push("");
  }

  // Recent activity window (last 90 days)
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recentPrs = github.authoredPRs.filter(
    (p) => Date.parse(p.createdAt) >= cutoff,
  );
  lines.push(`## Last 90 days`);
  lines.push(`- ${recentPrs.length} PRs authored`);
  lines.push(
    `- Active repos: ${new Set(recentPrs.map((p) => p.repoFullName)).size}`,
  );
  lines.push("");

  lines.push(`---`);
  lines.push(
    `Task: Write the distinctive paragraph + investigation angles + primary_shape. Then call submit_discover.`,
  );

  return lines.join("\n");
}

function aggregateActivity(
  inventoryIds: string[],
  artifacts: Record<string, Artifact>,
): {
  totalActiveDays: number;
  longestStreak: number;
  survivingLoc: number;
  repoCount: number;
  topLangs: Array<{ ext: string; ins: number }>;
} {
  let totalActiveDays = 0;
  let longestStreak = 0;
  let survivingLoc = 0;
  let repoCount = 0;
  const langMap: Record<string, number> = {};

  for (const id of inventoryIds) {
    const a = artifacts[id];
    if (!a) continue;
    const m = a.metadata as Record<string, unknown>;
    totalActiveDays += Number(m.active_days ?? 0);
    longestStreak = Math.max(longestStreak, Number(m.longest_streak_days ?? 0));
    survivingLoc += Number(m.surviving_loc ?? 0);
    repoCount += 1;
    const langs = Array.isArray(m.languages) ? (m.languages as Array<{ ext: string; insertions: number }>) : [];
    for (const l of langs) {
      langMap[l.ext] = (langMap[l.ext] ?? 0) + Number(l.insertions ?? 0);
    }
  }
  const topLangs = Object.entries(langMap)
    .map(([ext, ins]) => ({ ext, ins }))
    .sort((a, b) => b.ins - a.ins)
    .slice(0, 8);
  return { totalActiveDays, longestStreak, survivingLoc, repoCount, topLangs };
}
