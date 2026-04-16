export interface CliArgs {
  repoPath: string;
  handle: string;
  out?: string;
  model: string;
}

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

const USAGE = `GitShow Scanner — analyze a local git clone and produce structured signals.

Usage:
  bun run scan -- --repo <path> --handle <handle> [--model <id>] [--out <file>]

Arguments:
  --repo, -r     Path to a local git clone (required)
  --handle, -u   GitHub handle or git author name of the user to analyze (required)
  --model, -m    OpenRouter model ID (default: ${DEFAULT_MODEL})
  --out, -o      Write JSON result to this file instead of stdout (optional)
  --help, -h     Show this message

All flags also accept the --flag=value form.

The scanner uses OpenRouter for LLM inference. Get your API key at
https://openrouter.ai/keys and put it in .env as OPENROUTER_API_KEY.

Examples (copy as a single line — do NOT use backslash line continuation):
  # Default: Claude Sonnet 4.6 via OpenRouter (recommended)
  bun run scan -- --repo ~/code/my-project --handle yatendra --out scans/my-scan.json

  # Override the model
  bun run scan -- --repo ~/code/my-project --handle yatendra --model google/gemini-2.5-flash --out scans/test.json

Scan outputs go in scans/ (gitignored). To skip writing to disk, omit --out.
`;

/**
 * Normalize a raw argv entry so we can parse it regardless of shell-quoting
 * mistakes. Handles three forms:
 *
 *   1. Standard: \`--flag\` alone (next argv entry is the value)
 *   2. Equals:   \`--flag=value\` (value inline, no next entry consumed)
 *   3. Glued:    \`--flag value\` squished into one argv entry because the user
 *                pasted a multi-line command with \`\\\` continuation and the
 *                shell escaped the space instead of ending the line
 *
 * Also strips leading/trailing whitespace from each arg.
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

export function parseArgs(argv: string[]): CliArgs {
  let repoPath: string | undefined;
  let handle: string | undefined;
  let out: string | undefined;
  let model: string = DEFAULT_MODEL;

  const nextValue = (
    i: { cur: number },
    inlineValue: string | undefined
  ): string | undefined => {
    if (inlineValue !== undefined) return inlineValue;
    i.cur += 1;
    return argv[i.cur];
  };

  const iRef = { cur: 0 };
  for (iRef.cur = 0; iRef.cur < argv.length; iRef.cur++) {
    const { flag, inlineValue } = normalizeArg(argv[iRef.cur]);
    if (!flag) continue;

    switch (flag) {
      case "--repo":
      case "-r":
        repoPath = nextValue(iRef, inlineValue);
        break;
      case "--handle":
      case "-u":
        handle = nextValue(iRef, inlineValue);
        break;
      case "--out":
      case "-o":
        out = nextValue(iRef, inlineValue);
        break;
      case "--model":
      case "-m": {
        const v = nextValue(iRef, inlineValue);
        if (v) model = v;
        break;
      }
      case "--help":
      case "-h":
        process.stdout.write(USAGE);
        process.exit(0);
      default:
        process.stderr.write(
          `Unknown argument: ${argv[iRef.cur]}\n\n${USAGE}`
        );
        process.exit(1);
    }
  }

  if (!repoPath || !handle) {
    process.stderr.write(`Error: --repo and --handle are required\n\n${USAGE}`);
    process.exit(1);
  }

  return { repoPath, handle, out, model };
}
