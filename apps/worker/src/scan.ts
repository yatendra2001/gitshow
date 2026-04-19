#!/usr/bin/env bun
/**
 * GitShow CLI — interactive developer profile scanner.
 *
 * UX stack: @clack/prompts (prompts) + ora (spinners) + chalk (colors).
 * Entry point: `bun src/scan.ts` or `bun run profile`.
 *
 * Flow:
 *   1) Prompt for handle + optional socials + optional context notes.
 *   2) Resolve (or create) a ScanSession; session.id is OpenRouter session_id.
 *   3) Print session box with the dashboard link.
 *   4) Run the pipeline, showing per-stage + per-worker status live.
 *   5) Print a complete-summary box: profile path, claim count, cost, elapsed.
 */

import "dotenv/config";
import chalk from "chalk";
import {
  intro,
  outro,
  text,
  select,
  confirm,
  isCancel,
  cancel,
  note,
  log as clackLog,
} from "@clack/prompts";
import ora, { type Ora } from "ora";
import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { resolveSession } from "./session.js";
import { join } from "node:path";

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error(chalk.red("\nOPENROUTER_API_KEY is not set. Copy .env.example to .env and fill it in.\n"));
    process.exit(1);
  }

  console.log();
  intro(chalk.cyanBright("GitShow") + chalk.dim("  ·  Developer Profile Scanner"));

  const handle = await text({
    message: "GitHub username",
    placeholder: "octocat",
    validate: (v) => (!v || v.length < 1 ? "Required" : undefined),
  });
  if (isCancel(handle)) return cancel("Cancelled.");

  const twitter = await text({
    message: "Twitter handle (optional)",
    placeholder: "press enter to skip",
  });
  if (isCancel(twitter)) return cancel("Cancelled.");

  const linkedin = await text({
    message: "LinkedIn URL (optional)",
    placeholder: "https://linkedin.com/in/...",
  });
  if (isCancel(linkedin)) return cancel("Cancelled.");

  const website = await text({
    message: "Personal site (optional)",
    placeholder: "https://yoursite.com",
  });
  if (isCancel(website)) return cancel("Cancelled.");

  const contextNotes = await text({
    message: "Context notes (optional) — hackathons, orgs, anything worth knowing",
    placeholder: "press enter to skip",
  });
  if (isCancel(contextNotes)) return cancel("Cancelled.");

  const model = await select({
    message: "Model",
    initialValue: "anthropic/claude-sonnet-4.6",
    options: [
      { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6 (recommended)" },
      { value: "anthropic/claude-opus-4.6",   label: "Claude Opus 4.6 (higher quality, slower, more $)" },
      { value: "anthropic/claude-haiku-4.6",  label: "Claude Haiku 4.6 (faster, cheaper, lower quality)" },
    ],
  });
  if (isCancel(model)) return cancel("Cancelled.");

  const { session, resumed } = await resolveSession({
    handle: String(handle).trim(),
    socials: {
      twitter: sanitizeOptional(twitter),
      linkedin: sanitizeOptional(linkedin),
      website: sanitizeOptional(website),
    },
    context_notes: sanitizeOptional(contextNotes),
    model: String(model),
  });

  if (resumed) {
    const resumeChoice = await confirm({
      message: `Found an existing session for @${session.handle}. Resume from last checkpoint?`,
      initialValue: true,
    });
    if (isCancel(resumeChoice)) return cancel("Cancelled.");
    if (!resumeChoice) {
      // User wants a fresh scan — start a new session
      const fresh = await resolveSession({
        handle: session.handle,
        socials: session.socials,
        context_notes: session.context_notes,
        model: session.model,
        forceNew: true,
      });
      Object.assign(session, fresh.session);
    }
  }

  note(
    [
      `${chalk.bold("session id:")}  ${chalk.cyan(session.id)}`,
      `${chalk.bold("dashboard:")}   ${chalk.cyan(session.dashboard_url)}`,
      `${chalk.bold("model:")}       ${session.model}`,
    ].join("\n"),
    "OpenRouter session",
  );

  // ── Run pipeline with live status ────────────────────────
  const t0 = Date.now();
  let currentSpinner: Ora | null = null;
  const workerStates = new Map<string, { status: string; detail?: string }>();

  const onEvent = (ev: PipelineEvent) => {
    switch (ev.kind) {
      case "stage-start": {
        // Close previous spinner if any
        if (currentSpinner) currentSpinner.stop();
        const label = `${chalk.cyan(ev.stage)}${ev.detail ? chalk.dim(` · ${ev.detail}`) : ""}`;
        currentSpinner = ora({ text: label, spinner: "dots" }).start();
        break;
      }
      case "stage-end": {
        if (currentSpinner) {
          const sec = (ev.duration_ms / 1000).toFixed(1);
          currentSpinner.succeed(
            `${chalk.cyan(ev.stage)} ${chalk.dim(`· ${sec}s${ev.detail ? ` · ${ev.detail}` : ""}`)}`,
          );
          currentSpinner = null;
        }
        break;
      }
      case "stage-warn": {
        clackLog.warn(`${ev.stage}: ${ev.message}`);
        break;
      }
      case "worker-update": {
        workerStates.set(ev.worker, { status: ev.status, detail: ev.detail });
        if (currentSpinner) {
          const running = [...workerStates.entries()]
            .filter(([, s]) => s.status === "running")
            .map(([w]) => w);
          const done = [...workerStates.entries()].filter(([, s]) => s.status === "done").length;
          const failed = [...workerStates.entries()].filter(([, s]) => s.status === "failed").length;
          const runningLabel = running.length ? ` running: ${running.join(", ")}` : "";
          currentSpinner.text = `${chalk.cyan("workers")} ${chalk.dim(`· ${done} done, ${failed} failed${runningLabel}`)}`;
        }
        break;
      }
      case "stream": {
        // Full verbose stream only with DEBUG.
        if (process.env.GITSHOW_DEBUG) {
          process.stderr.write(ev.text);
        }
        // But always surface retry / error signals in the spinner
        // subtext so the user can see they're not stuck.
        const t = ev.text;
        if (/Transient error|Retrying|WARNING|ERROR|\[agent\].*retry/i.test(t)) {
          if (currentSpinner) {
            const short = t.replace(/\n+/g, " ").trim().slice(0, 120);
            currentSpinner.text = `${currentSpinner.text.split(" · ")[0]} ${chalk.yellow(`· ${short}`)}`;
          }
        }
        break;
      }
    }
  };

  try {
    const profile = await runPipeline({
      session,
      onEvent,
    });
    if (currentSpinner) (currentSpinner as Ora).stop();

    const elapsedSec = Math.round((Date.now() - t0) / 1000);
    const outPath = join("profiles", session.handle, "13-profile.json");
    const cost = profile.meta.estimated_cost_usd.toFixed(3);
    const llmCalls = profile.meta.llm_calls;
    const webCalls = profile.meta.web_calls;
    const evidenceBound = profile.claims.filter((c) => c.evidence_ids.length > 0).length;

    // Stability + hiring-manager verdicts live on card.meta — load for summary
    let stabilityLine: string | null = null;
    let hiringLine: string | null = null;
    let topFixes: Array<{ axis: string; fix: string }> = [];
    try {
      const cardPath = join("profiles", session.handle, "14-card.json");
      const { readFile } = await import("node:fs/promises");
      const cardRaw = await readFile(cardPath, "utf-8");
      const cardJson = JSON.parse(cardRaw) as {
        meta: {
          stability?: { verdict: string; hook_similarity: number };
          hiring_review?: {
            verdict: "PASS" | "REVISE" | "BLOCK";
            overall_score: number;
            would_forward: boolean;
            top_fixes: Array<{ axis: string; fix: string }>;
          };
        };
      };
      const s = cardJson.meta.stability;
      if (s) {
        const col = s.verdict === "stable" ? chalk.green : s.verdict === "mixed" ? chalk.yellow : s.verdict === "unstable" ? chalk.red : chalk.dim;
        stabilityLine = `${chalk.bold("stability:")} ${col(s.verdict)} ${chalk.dim(`(hook sim=${s.hook_similarity})`)}`;
      }
      const hr = cardJson.meta.hiring_review;
      if (hr) {
        const col = hr.verdict === "PASS" ? chalk.green : hr.verdict === "REVISE" ? chalk.yellow : chalk.red;
        const fwd = hr.would_forward ? chalk.green("↗ forward") : chalk.red("✗ hold");
        hiringLine = `${chalk.bold("hiring mgr:")} ${col(hr.verdict)} ${chalk.dim(`(${hr.overall_score}/100)`)}  ${fwd}`;
        topFixes = hr.top_fixes.slice(0, 3);
      }
    } catch {
      /* optional — omit line if unavailable */
    }

    note(
      [
        `${chalk.bold("profile:")}   ${outPath}`,
        `${chalk.bold("claims:")}    ${profile.claims.length} (${evidenceBound} with evidence)`,
        `${chalk.bold("artifacts:")} ${Object.keys(profile.artifacts).length}`,
        `${chalk.bold("llm calls:")} ${llmCalls}` + (webCalls ? `  ${chalk.dim(`web: ${webCalls}`)}` : ""),
        `${chalk.bold("cost:")}      $${cost}`,
        ...(hiringLine ? [hiringLine] : []),
        ...(stabilityLine ? [stabilityLine] : []),
        `${chalk.bold("session:")}   ${chalk.cyan(session.dashboard_url)}`,
        `${chalk.bold("elapsed:")}   ${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`,
      ].join("\n"),
      "Complete",
    );

    // If the hiring manager suggests fixes, list them below the summary box.
    if (topFixes.length > 0) {
      clackLog.info(
        [
          chalk.bold("Hiring manager suggests:"),
          ...topFixes.map((f, i) => `  ${i + 1}. ${chalk.cyan(`[${f.axis}]`)} ${f.fix}`),
        ].join("\n"),
      );
    }

    if (profile.meta.errors.length > 0) {
      clackLog.warn(`${profile.meta.errors.length} non-fatal errors recorded in meta.errors`);
    }

    outro(chalk.green("Done."));
  } catch (err) {
    if (currentSpinner) (currentSpinner as Ora).fail();
    const msg = err instanceof Error ? err.message : String(err);
    clackLog.error(msg);
    // Always show the stack — these are rare-enough failures that the
    // user (or we) need the file:line context to fix. Dim it so it reads
    // as a secondary detail, not the headline.
    if (err instanceof Error && err.stack) {
      process.stderr.write(chalk.dim(err.stack + "\n"));
    }
    outro(chalk.red("Scan failed. Fix the issue and re-run — the pipeline resumes from the last checkpoint."));
    process.exit(1);
  }
}

function sanitizeOptional(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
