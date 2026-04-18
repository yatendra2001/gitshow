/**
 * Run the pipeline using a saved session file — for non-interactive re-runs.
 *
 * Usage: bun scripts/run-from-session.ts <handle>
 * Example: bun scripts/run-from-session.ts <gh-handle>
 */
import "dotenv/config";
import { loadSession } from "../src/session.js";
import { runPipeline, type PipelineEvent } from "../src/pipeline.js";

async function main() {
  const handle = process.argv[2];
  if (!handle) {
    console.error("Usage: bun scripts/run-from-session.ts <handle>");
    process.exit(1);
  }
  const session = await loadSession(handle);
  if (!session) {
    console.error(`No saved session for @${handle}. Run \`bun run profile\` first.`);
    process.exit(1);
  }
  // Infinity survives Number.POSITIVE_INFINITY but JSON stringifies it as null.
  if (!Number.isFinite(session.cost_cap_usd) || session.cost_cap_usd === null) {
    session.cost_cap_usd = Number.POSITIVE_INFINITY;
  }
  const t0 = Date.now();
  const onEvent = (ev: PipelineEvent) => {
    switch (ev.kind) {
      case "stage-start":
        process.stderr.write(`\n▶ ${ev.stage}${ev.detail ? ` · ${ev.detail}` : ""}\n`);
        break;
      case "stage-end":
        process.stderr.write(`✔ ${ev.stage} · ${(ev.durationMs / 1000).toFixed(1)}s${ev.detail ? ` · ${ev.detail}` : ""}\n`);
        break;
      case "worker-update":
        process.stderr.write(`  [${ev.worker}] ${ev.status}${ev.detail ? ` · ${ev.detail}` : ""}\n`);
        break;
      case "stream":
        if (process.env.GITSHOW_DEBUG) process.stderr.write(ev.text);
        else if (/retry|WARNING|ERROR/i.test(ev.text)) process.stderr.write(ev.text);
        break;
    }
  };
  try {
    const profile = await runPipeline({ session, onEvent });
    const sec = Math.round((Date.now() - t0) / 1000);
    process.stderr.write(`\n✔ Done in ${Math.floor(sec / 60)}m ${sec % 60}s\n`);
    process.stderr.write(`  profile: profiles/${handle}/13-profile.json\n`);
    process.stderr.write(`  claims:  ${profile.claims.length}\n`);
    process.stderr.write(`  cost:    $${profile.meta.estimated_cost_usd.toFixed(3)}\n`);
    process.stderr.write(`  session: ${session.dashboard_url}\n`);
  } catch (err) {
    process.stderr.write(`\n✖ FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof Error && err.stack) process.stderr.write(err.stack + "\n");
    process.exit(1);
  }
}

main();
