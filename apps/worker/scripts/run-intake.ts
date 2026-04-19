#!/usr/bin/env bun
/**
 * Fly entrypoint for the intake agent.
 *
 * Spawned per-user at first login (or when requesting a fresh scan).
 * Does a light GitHub fetch via `gh` CLI, generates 3-5 targeted
 * questions via one LLM call, writes them to intake_sessions, and
 * exits. The web app polls /api/intake/[id] until status = ready.
 *
 * Required env:
 *   INTAKE_ID, HANDLE, GH_TOKEN, OPENROUTER_API_KEY,
 *   CF_ACCOUNT_ID, D1_DATABASE_ID, CF_API_TOKEN,
 *   GITSHOW_CLOUD_MODE=1
 *
 * Optional env:
 *   MODEL (default: anthropic/claude-sonnet-4.6)
 */
import "dotenv/config";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { runIntake } from "../src/agents/intake.js";
import { D1Client } from "../src/cloud/d1.js";
import { SessionUsage } from "../src/session.js";
import { logger, requireEnv } from "../src/util.js";
import type { ScanSession } from "../src/schemas.js";

const execFile = promisify(execFileCb);
const intakeLog = logger.child({ src: "run-intake" });

async function ghJson<T>(args: string[]): Promise<T | null> {
  try {
    const { stdout } = await execFile("gh", args, {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    });
    return JSON.parse(stdout) as T;
  } catch (err) {
    intakeLog.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "gh.api.failed",
    );
    return null;
  }
}

async function main() {
  if (process.env.GITSHOW_CLOUD_MODE !== "1") {
    intakeLog.error("GITSHOW_CLOUD_MODE not set — refusing to run");
    process.exit(1);
  }

  const intakeId = requireEnv("INTAKE_ID");
  const handle = requireEnv("HANDLE");
  const model = process.env.MODEL || "anthropic/claude-sonnet-4.6";

  const d1 = D1Client.fromEnv({ logger });
  const log = intakeLog.child({ intake_id: intakeId, handle });

  const now = Date.now();
  await d1.query(
    `UPDATE intake_sessions SET status = 'running', updated_at = ? WHERE id = ?`,
    [now, intakeId],
  );

  try {
    log.info("light GitHub fetch starting");

    // Small, focused GitHub pulls — everything we need fits in ~2-3
    // API calls. Much lighter than the full github-fetcher.
    const profile = await ghJson<{
      login: string;
      name: string | null;
      bio: string | null;
      location: string | null;
      company: string | null;
      public_repos: number;
      followers: number;
      created_at: string;
    }>([
      "api",
      `users/${encodeURIComponent(handle)}`,
      "--jq",
      ".",
    ]);

    const topRepos = await ghJson<
      Array<{
        full_name: string;
        description: string | null;
        language: string | null;
        stargazers_count: number;
        pushed_at: string;
        fork: boolean;
        archived: boolean;
      }>
    >([
      "api",
      `users/${encodeURIComponent(handle)}/repos?sort=pushed&per_page=20`,
      "--jq",
      "[.[] | {full_name, description, language, stargazers_count, pushed_at, fork, archived}]",
    ]);

    const recentPrs = await ghJson<{ total_count: number }>([
      "api",
      `search/issues?q=${encodeURIComponent(`author:${handle} is:pr created:>${ninetyDaysAgo()}`)}`,
      "--jq",
      "{total_count}",
    ]);

    const summary = buildSummary({
      handle,
      profile,
      topRepos: (topRepos ?? []).filter((r) => !r.fork && !r.archived).slice(0, 8),
      recentPrCount: recentPrs?.total_count ?? 0,
    });

    log.info({ summary_length: summary.length }, "calling intake agent");

    const session: ScanSession = {
      id: intakeId,
      handle,
      socials: {},
      context_notes: undefined,
      started_at: new Date().toISOString(),
      dashboard_url: `https://openrouter.ai/sessions/${intakeId}`,
      model,
      cost_cap_usd: Number.POSITIVE_INFINITY,
    };
    const usage = new SessionUsage();

    const output = await runIntake({
      session,
      usage,
      profile_summary: summary,
      onProgress: (text) => {
        if (process.env.GITSHOW_DEBUG) process.stderr.write(text);
      },
    });

    await d1.query(
      `UPDATE intake_sessions
         SET status = 'ready',
             questions_json = ?,
             updated_at = ?,
             completed_at = ?
         WHERE id = ?`,
      [JSON.stringify(output), Date.now(), Date.now(), intakeId],
    );

    log.info(
      { question_count: output.questions.length, tokens: usage.totalTokens },
      "intake ready",
    );
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, "intake failed");
    await d1.query(
      `UPDATE intake_sessions SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
      [msg.slice(0, 2000), Date.now(), intakeId],
    );
    process.exit(1);
  }
}

function ninetyDaysAgo(): string {
  const d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

interface SummaryInput {
  handle: string;
  profile: {
    name: string | null;
    bio: string | null;
    location: string | null;
    company: string | null;
    public_repos: number;
    followers: number;
    created_at: string;
  } | null;
  topRepos: Array<{
    full_name: string;
    description: string | null;
    language: string | null;
    stargazers_count: number;
    pushed_at: string;
  }>;
  recentPrCount: number;
}

function buildSummary(x: SummaryInput): string {
  const lines: string[] = [];
  lines.push(`## Developer: @${x.handle}`);
  if (x.profile?.name) lines.push(`Name: ${x.profile.name}`);
  if (x.profile?.bio) lines.push(`Bio: ${x.profile.bio}`);
  if (x.profile?.location) lines.push(`Location: ${x.profile.location}`);
  if (x.profile?.company) lines.push(`Company: ${x.profile.company}`);
  if (x.profile) {
    lines.push(
      `Public repos: ${x.profile.public_repos}, followers: ${x.profile.followers}, joined: ${x.profile.created_at}`,
    );
  }
  lines.push("");
  lines.push(`## Recent activity (last 90 days)`);
  lines.push(`- ${x.recentPrCount} pull requests authored`);
  lines.push("");
  lines.push(`## Top active repos (sorted by most recent push)`);
  for (const r of x.topRepos) {
    const stars = r.stargazers_count ? ` · ★${r.stargazers_count}` : "";
    const desc = r.description ? ` — ${r.description.slice(0, 80)}` : "";
    lines.push(`- ${r.full_name} [${r.language ?? "?"}${stars}]${desc}`);
  }
  lines.push("");
  lines.push(`---`);
  lines.push(
    `Task: write 3-5 targeted questions for this developer that steer the 40-min scan. Then call submit_intake.`,
  );
  return lines.join("\n");
}

main().catch((err) => {
  intakeLog.error({ err }, "run-intake: unhandled");
  process.exit(1);
});
