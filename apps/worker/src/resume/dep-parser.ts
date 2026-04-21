/**
 * Dependency-file parser — reads the manifest files inside a cloned repo
 * and extracts a clean, de-duplicated list of technologies used.
 *
 * Supports (in priority order):
 *   - package.json           → dependencies + devDependencies
 *   - go.mod                 → require blocks
 *   - pyproject.toml         → [project.dependencies] + [tool.poetry.dependencies]
 *   - requirements.txt       → one-line-per-package
 *   - Cargo.toml             → [dependencies] + [dev-dependencies]
 *   - Gemfile / Gemfile.lock → gem entries
 *   - composer.json          → require + require-dev
 *
 * The goal is accuracy: the projects-agent should never guess a tech
 * stack from a README when an authoritative manifest is one file read
 * away. Output is a string[] of canonicalised names ordered by a simple
 * "more popular / more specific" heuristic.
 *
 * Intentionally NOT: version extraction, semver resolution, transitive
 * deps. Those add noise without improving card quality.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DepParseResult {
  /** Canonical display names ready for the projects-agent to cite. */
  technologies: string[];
  /** Which manifest files produced this list, for debug/trace. */
  sources: string[];
}

/**
 * Parse every manifest we can find in `repoPath` and merge results.
 * Missing files are skipped silently — a project without any manifest
 * just returns empty; the agent falls back to the GitHub language list.
 */
export async function parseDependencies(repoPath: string): Promise<DepParseResult> {
  const technologies = new Set<string>();
  const sources: string[] = [];

  const parsers: Array<[string, (p: string) => Promise<string[]>]> = [
    ["package.json", parsePackageJson],
    ["go.mod", parseGoMod],
    ["pyproject.toml", parsePyproject],
    ["requirements.txt", parseRequirements],
    ["Cargo.toml", parseCargoToml],
    ["Gemfile", parseGemfile],
    ["composer.json", parseComposerJson],
  ];

  for (const [fileName, parser] of parsers) {
    const full = join(repoPath, fileName);
    if (!existsSync(full)) continue;
    try {
      const names = await parser(full);
      if (names.length === 0) continue;
      sources.push(fileName);
      for (const n of names) technologies.add(canonicalize(n));
    } catch {
      // Malformed manifest — skip, don't fail the whole project.
    }
  }

  return {
    technologies: rank(Array.from(technologies)),
    sources,
  };
}

// ──────────────────────────────────────────────────────────────
// Per-format parsers
// ──────────────────────────────────────────────────────────────

async function parsePackageJson(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf-8");
  const json = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const keys = [
    ...Object.keys(json.dependencies ?? {}),
    ...Object.keys(json.devDependencies ?? {}),
    ...Object.keys(json.peerDependencies ?? {}),
  ];
  return keys
    .map((k) => {
      // @scope/package → package name without scope for display
      if (k.startsWith("@")) {
        const [, name] = k.split("/");
        return name || k;
      }
      return k;
    })
    .filter((n) => n.length > 0);
}

async function parseGoMod(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf-8");
  const names: string[] = [];
  // Match both single-require and grouped require blocks.
  const pattern = /^\s*(?:require\s+)?([\w.\-/]+)\s+v[\d.]+/gm;
  for (const m of raw.matchAll(pattern)) {
    // Take the last path segment as display name
    const segments = m[1].split("/");
    names.push(segments[segments.length - 1]);
  }
  return names;
}

async function parsePyproject(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf-8");
  // Crude TOML-to-string scraping for [project.dependencies] +
  // [tool.poetry.dependencies] blocks. A proper TOML parser would be
  // cleaner but we don't want the extra dependency here.
  const names: string[] = [];
  const inSection = (header: string): string | null => {
    const idx = raw.indexOf(`[${header}]`);
    if (idx === -1) return null;
    const next = raw.slice(idx + header.length + 2);
    const end = next.search(/^\[/m);
    return end === -1 ? next : next.slice(0, end);
  };

  const harvest = (block: string | null) => {
    if (!block) return;
    // `name = "..."` style (poetry) or `"name >= x.y"` style (PEP 631)
    const poetry = block.matchAll(/^\s*([A-Za-z0-9_.\-]+)\s*=/gm);
    for (const m of poetry) names.push(m[1]);
    const pep631 = block.matchAll(/"\s*([A-Za-z0-9_.\-]+)/g);
    for (const m of pep631) names.push(m[1]);
  };

  harvest(inSection("project.dependencies"));
  harvest(inSection("tool.poetry.dependencies"));
  harvest(inSection("project.optional-dependencies"));
  return names.filter((n) => n.toLowerCase() !== "python");
}

async function parseRequirements(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf-8");
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/[<=>!~[]/)[0].trim())
    .filter((n) => n && !n.startsWith("-"));
}

async function parseCargoToml(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf-8");
  const names: string[] = [];
  const depBlocks = ["dependencies", "dev-dependencies", "build-dependencies"];
  for (const header of depBlocks) {
    const idx = raw.indexOf(`[${header}]`);
    if (idx === -1) continue;
    const next = raw.slice(idx + header.length + 2);
    const end = next.search(/^\[/m);
    const block = end === -1 ? next : next.slice(0, end);
    for (const m of block.matchAll(/^\s*([A-Za-z0-9_\-]+)\s*=/gm)) {
      names.push(m[1]);
    }
  }
  return names;
}

async function parseGemfile(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf-8");
  const names: string[] = [];
  // gem 'rails', '~> 7.0' → capture 'rails'
  for (const m of raw.matchAll(/^\s*gem\s+['"]([\w\-]+)['"]/gm)) {
    names.push(m[1]);
  }
  return names;
}

async function parseComposerJson(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf-8");
  const json = JSON.parse(raw) as {
    require?: Record<string, string>;
    "require-dev"?: Record<string, string>;
  };
  const keys = [
    ...Object.keys(json.require ?? {}),
    ...Object.keys(json["require-dev"] ?? {}),
  ];
  return keys
    .filter((k) => k !== "php" && !k.startsWith("ext-"))
    .map((k) => (k.includes("/") ? k.split("/")[1] : k));
}

// ──────────────────────────────────────────────────────────────
// Canonicalisation + ranking
// ──────────────────────────────────────────────────────────────

/**
 * Normalise a package identifier into a display name a reader will
 * recognise. Handles common synonyms (`react-dom` → `React`,
 * `typescript` → `TypeScript`) so the projects-agent doesn't have to
 * dedupe semantically-equivalent names.
 */
function canonicalize(raw: string): string {
  const name = raw.toLowerCase();
  const map: Record<string, string> = {
    react: "React",
    "react-dom": "React",
    "next": "Next.js",
    "next.js": "Next.js",
    typescript: "TypeScript",
    typescript_: "TypeScript",
    tailwindcss: "Tailwind",
    "@tailwindcss/postcss": "Tailwind",
    express: "Express",
    fastify: "Fastify",
    vue: "Vue",
    svelte: "Svelte",
    nuxt: "Nuxt",
    prisma: "Prisma",
    drizzle: "Drizzle",
    "drizzle-orm": "Drizzle",
    zod: "Zod",
    trpc: "tRPC",
    "@trpc/server": "tRPC",
    openai: "OpenAI",
    anthropic: "Anthropic",
    "@anthropic-ai/sdk": "Anthropic",
    "ai-sdk": "AI SDK",
    stripe: "Stripe",
    "better-auth": "Better Auth",
    lucide: "Lucide",
    "lucide-react": "Lucide",
    hono: "Hono",
    remix: "Remix",
    flask: "Flask",
    fastapi: "FastAPI",
    django: "Django",
    pytorch: "PyTorch",
    torch: "PyTorch",
    tensorflow: "TensorFlow",
    numpy: "NumPy",
    pandas: "pandas",
    requests: "Requests",
    gin: "Gin",
    echo: "Echo",
    actix: "Actix",
    rocket: "Rocket",
    tokio: "Tokio",
    serde: "Serde",
    clap: "Clap",
    rails: "Rails",
    sinatra: "Sinatra",
    devise: "Devise",
    laravel: "Laravel",
    symfony: "Symfony",
  };
  return map[name] ?? raw.replace(/^[a-z]/, (c) => c.toUpperCase());
}

/**
 * Simple ranking — meta-frameworks and well-known platforms first, then
 * alphabetic. Keeps the projects-agent's tech-pill list reading
 * naturally without us having to track weights per-library.
 */
function rank(names: string[]): string[] {
  const priority: Record<string, number> = {
    "Next.js": 100,
    Nuxt: 95,
    Remix: 95,
    React: 90,
    Vue: 90,
    Svelte: 90,
    TypeScript: 85,
    Tailwind: 80,
    Prisma: 75,
    Drizzle: 75,
    Postgres: 74,
    tRPC: 72,
    Zod: 70,
    Stripe: 65,
    Anthropic: 60,
    OpenAI: 60,
    "AI SDK": 60,
    Hono: 58,
    Rails: 58,
    Django: 58,
    FastAPI: 58,
    Gin: 55,
    Flask: 55,
  };
  return names
    .slice()
    .sort((a, b) => {
      const pa = priority[a] ?? 0;
      const pb = priority[b] ?? 0;
      if (pa !== pb) return pb - pa;
      return a.localeCompare(b);
    });
}
