/**
 * CLI argument parsing for profile mode.
 *
 * Usage:
 *   bun run profile -- --handle <github_handle> [--out file] [--model model] [--concurrency N] [--feedback]
 */

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const DEFAULT_CONCURRENCY = 3;

export interface ProfileArgs {
  handle: string;
  model: string;
  concurrency: number;
  outPath?: string;
  feedback: boolean;
}

const USAGE = `GitShow — AI-generated engineering portfolios.

Usage:
  bun run profile -- --handle <github_handle> [--out file] [--model model] [--concurrency N] [--feedback]

Arguments:
  --handle, -u     GitHub username (required)
  --model, -m      OpenRouter model ID (default: ${DEFAULT_MODEL})
  --out, -o        Write JSON result to this file (optional)
  --concurrency    Max parallel repo analyses (default: ${DEFAULT_CONCURRENCY})
  --feedback       Enable feedback loop for quality improvement
  --help, -h       Show this message

The pipeline uses OpenRouter for LLM inference. Set OPENROUTER_API_KEY in .env.
GitHub data is fetched via \`gh\` CLI (must be authenticated: \`gh auth login\`).
`;

/**
 * Normalize a raw argv entry. Handles:
 *   --flag=value, --flag value, -f value, and glued forms.
 */
function normalizeArg(raw: string | undefined): {
  flag: string;
  inlineValue: string | undefined;
} {
  if (raw === undefined) return { flag: "", inlineValue: undefined };
  const trimmed = raw.trim();
  if (!trimmed.startsWith("-")) {
    return { flag: trimmed, inlineValue: undefined };
  }

  const eqIdx = trimmed.indexOf("=");
  if (eqIdx > 0) {
    return {
      flag: trimmed.slice(0, eqIdx),
      inlineValue: trimmed.slice(eqIdx + 1),
    };
  }

  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx > 0) {
    return {
      flag: trimmed.slice(0, spaceIdx),
      inlineValue: trimmed.slice(spaceIdx + 1).trim(),
    };
  }

  return { flag: trimmed, inlineValue: undefined };
}

export function parseArgs(argv: string[]): ProfileArgs {
  // Filter out bare "profile" token if present (from npm script)
  const filteredArgv = argv.filter((a) => a.trim() !== "profile");

  let handle: string | undefined;
  let outPath: string | undefined;
  let model: string = DEFAULT_MODEL;
  let concurrency: number = DEFAULT_CONCURRENCY;
  let feedback = false;

  const iRef = { cur: 0 };
  const nextValue = (
    inlineValue: string | undefined
  ): string | undefined => {
    if (inlineValue !== undefined) return inlineValue;
    iRef.cur += 1;
    return filteredArgv[iRef.cur];
  };

  for (iRef.cur = 0; iRef.cur < filteredArgv.length; iRef.cur++) {
    const { flag, inlineValue } = normalizeArg(filteredArgv[iRef.cur]);
    if (!flag) continue;

    switch (flag) {
      case "--handle":
      case "-u":
        handle = nextValue(inlineValue);
        break;
      case "--out":
      case "-o":
        outPath = nextValue(inlineValue);
        break;
      case "--model":
      case "-m": {
        const v = nextValue(inlineValue);
        if (v) model = v;
        break;
      }
      case "--concurrency": {
        const v = nextValue(inlineValue);
        if (v) {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) concurrency = n;
        }
        break;
      }
      case "--feedback":
        feedback = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(USAGE);
        process.exit(0);
      default:
        // Don't error on unknown args — be lenient
        break;
    }
  }

  if (!handle) {
    process.stderr.write(
      `Error: --handle is required\n\n${USAGE}`
    );
    process.exit(1);
  }

  return {
    handle,
    model,
    concurrency,
    outPath,
    feedback,
  };
}
