/**
 * Kimi-judgment-driven skills aggregator.
 *
 * The original implementation walked manifest deps (package.json,
 * pubspec.yaml, Cargo.toml etc.) and scored skills by how often they
 * appeared. That worked for "Tailwind / Next.js / TypeScript" but
 * MISSED the things that actually distinguish a portfolio:
 *   - LLM/AI usage (Gemini / Claude / Whisper aren't packages)
 *   - Cloud + protocol surfaces (Solana / Web3 / WebRTC / RAG)
 *   - Anything used over raw HTTP without a vendored SDK
 * It also drowned the chip list in UI-helper noise (Cupertino Icons,
 * Class Variance Authority, Tailwind Merge, Postcss).
 *
 * Kimi's per-repo judgment already produces a curated
 * `judgment.technologies: string[]` list — the model picked the 5-10
 * most distinctive techs per repo from the README + manifest + source
 * samples. We aggregate those across all judged repos, count usage
 * frequency, and emit HAS_SKILL TypedFacts with a 0..100 strength
 * score (manifest-deps path retired entirely per yatendra's call —
 * "rely on kimi analysis rather than packages at all").
 *
 * The score is the field the renderer's UI bars use:
 *
 *   score = 100 * sigmoid(usage*1.6 + recencyBonus + sizeBonus)
 *
 * — meaning a skill seen in 1 stale repo lands ~25-35; a skill seen
 * in 8 active repos lands 90+. Bounded so a power user with 200 repos
 * doesn't max out the entire chart.
 */
import { makeSource, type TypedFact } from "@gitshow/shared/kg";
import type { RepoStudy, ManifestEcosystem } from "../../repo-study.js";
import type { RepoJudgeOutput } from "../judge/repo-judge.js";

export interface ManifestSkillAggregation {
  facts: TypedFact[];
  /** Diagnostic — sorted by score desc for trace logs. */
  ranked: Array<{ name: string; usageCount: number; score: number }>;
}

interface SkillAccum {
  /** Display name (post-canonicalisation). */
  name: string;
  /** Count of distinct repos that declared this dep. */
  repos: Set<string>;
  /** Number of those repos pushed in the last 365 days. */
  recentRepos: number;
  /** Sum of user lines across the repos that declared this dep. */
  userLinesSum: number;
}

const NOW = Date.now();
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Collapse near-duplicate dep names into a single skill chip.
 * "@types/react" → "React"; "react-dom" → "React"; "next" / "next.js"
 * → "Next.js"; "@trpc/server" → "tRPC". Only handles the obvious
 * collapses where the meaning is unambiguous — anything else passes
 * through with light cleanup.
 */
function canonicaliseSkill(name: string, eco: ManifestEcosystem): string | null {
  const lower = name.toLowerCase().trim();
  if (!lower) return null;
  if (lower.startsWith("@types/")) {
    return canonicaliseSkill(lower.slice("@types/".length), eco);
  }
  // Drop obvious test/build noise — these aren't skills users want to flaunt.
  const NOISE = [
    "typescript",
    "tslib",
    "eslint",
    "prettier",
    "husky",
    "lint-staged",
    "rimraf",
    "cross-env",
    "dotenv",
    "ts-node",
    "tsx",
    "@types/node",
    "@types/bun",
    "vite",
    "vitest",
    "jest",
    "mocha",
    "chai",
    "ava",
    "babel",
    "@babel/core",
    "webpack",
    "rollup",
    "esbuild",
  ];
  if (NOISE.includes(lower)) {
    // We DO want TypeScript as a skill — promote it.
    if (lower === "typescript") return "TypeScript";
    return null;
  }

  // Tight aliases — display name on the right.
  const ALIASES: Record<string, string> = {
    "react-dom": "React",
    "react-native": "React Native",
    "next": "Next.js",
    "next.js": "Next.js",
    "nuxt": "Nuxt",
    "vue": "Vue",
    "svelte": "Svelte",
    "@sveltejs/kit": "SvelteKit",
    "@solidjs/router": "Solid",
    "solid-js": "Solid",
    "@trpc/server": "tRPC",
    "@trpc/client": "tRPC",
    "drizzle-orm": "Drizzle",
    "@prisma/client": "Prisma",
    "prisma": "Prisma",
    "mongoose": "MongoDB",
    "pg": "PostgreSQL",
    "postgres": "PostgreSQL",
    "redis": "Redis",
    "ioredis": "Redis",
    "express": "Express",
    "fastify": "Fastify",
    "hono": "Hono",
    "koa": "Koa",
    "@nestjs/core": "NestJS",
    "tailwindcss": "Tailwind CSS",
    "framer-motion": "Framer Motion",
    "@radix-ui/react-dialog": "Radix UI",
    "shadcn-ui": "shadcn/ui",
    "lucide-react": "Lucide",
    "@aws-sdk/client-s3": "AWS S3",
    "@aws-sdk/client-dynamodb": "AWS DynamoDB",
    "firebase": "Firebase",
    "firebase_core": "Firebase",
    "firebase_auth": "Firebase Auth",
    "supabase": "Supabase",
    "@supabase/supabase-js": "Supabase",
    "stripe": "Stripe",
    "openai": "OpenAI",
    "@anthropic-ai/sdk": "Anthropic",
    "@google/generative-ai": "Google AI",
    "axios": "Axios",
    "fastapi": "FastAPI",
    "django": "Django",
    "flask": "Flask",
    "tokio": "Tokio",
    "axum": "Axum",
    "actix-web": "Actix",
    "actix": "Actix",
    "rocket": "Rocket",
    "serde": "Serde",
    "tonic": "gRPC (Tonic)",
    // Flutter/Dart
    "flutter_bloc": "BLoC",
    "bloc": "BLoC",
    "provider": "Provider",
    "go_router": "go_router",
    "dio": "Dio",
    "riverpod": "Riverpod",
    "flutter_riverpod": "Riverpod",
    // Go
    "github.com/gin-gonic/gin": "Gin",
    "github.com/labstack/echo/v4": "Echo",
    "github.com/spf13/cobra": "Cobra",
  };
  if (ALIASES[lower]) return ALIASES[lower]!;

  // npm scope cleanup: "@foo/bar-baz" → "Foo Bar Baz"
  if (lower.startsWith("@")) {
    const slash = lower.indexOf("/");
    const tail = slash >= 0 ? lower.slice(slash + 1) : lower.slice(1);
    return prettify(tail);
  }
  // Go module: take last path segment.
  if (eco === "go") {
    const last = lower.split("/").pop() ?? lower;
    return prettify(last);
  }
  return prettify(lower);
}

/**
 * Lightweight cleanup for Kimi-supplied technology names. Kimi already
 * gave us curated, brand-correct strings (e.g. "Gemini", "Solana",
 * "WalletConnect", "Whisper", "RAG"), so we only:
 *  - trim + bound length
 *  - drop obviously useless entries (single chars, punctuation-only)
 *  - normalise a handful of common spellings to a canonical display
 *    form so e.g. "next.js" / "Next.js" / "nextjs" all merge
 * No ecosystem-specific package mapping (that lived in the old
 * manifest path); Kimi is the source of truth for naming now.
 */
function canonicaliseJudgmentTech(raw: string): string | null {
  const s = raw.trim();
  if (s.length === 0 || s.length > 60) return null;
  if (!/[A-Za-z]/.test(s)) return null;
  const lower = s.toLowerCase();

  // Hard merges: same skill, different surface forms.
  const ALIAS: Record<string, string> = {
    "next.js": "Next.js",
    nextjs: "Next.js",
    "node.js": "Node.js",
    nodejs: "Node.js",
    typescript: "TypeScript",
    javascript: "JavaScript",
    react: "React",
    "react native": "React Native",
    "react-native": "React Native",
    flutter: "Flutter",
    dart: "Dart",
    swift: "Swift",
    swiftui: "SwiftUI",
    rust: "Rust",
    python: "Python",
    golang: "Go",
    "go (golang)": "Go",
    tailwind: "Tailwind CSS",
    "tailwind css": "Tailwind CSS",
    tailwindcss: "Tailwind CSS",
    bloc: "BLoC",
    "bloc pattern": "BLoC",
    cubit: "Cubit",
    riverpod: "Riverpod",
    provider: "Provider",
    firebase: "Firebase",
    "firebase auth": "Firebase",
    firestore: "Firestore",
    "cloud firestore": "Firestore",
    supabase: "Supabase",
    postgres: "PostgreSQL",
    postgresql: "PostgreSQL",
    sqlite: "SQLite",
    mongodb: "MongoDB",
    redis: "Redis",
    docker: "Docker",
    kubernetes: "Kubernetes",
    aws: "AWS",
    gcp: "GCP",
    "google cloud": "GCP",
    cloudflare: "Cloudflare",
    "cloudflare workers": "Cloudflare Workers",
    vercel: "Vercel",
    fly: "Fly.io",
    "fly.io": "Fly.io",
    // AI / LLM surface area — these were the headline gap before this
    // refactor: none of them are package names so the manifest-based
    // aggregator never saw them.
    gemini: "Gemini",
    "gemini api": "Gemini",
    "google gemini": "Gemini",
    claude: "Claude",
    anthropic: "Claude",
    "openai api": "OpenAI",
    openai: "OpenAI",
    chatgpt: "OpenAI",
    "gpt-4": "OpenAI",
    whisper: "Whisper",
    ollama: "Ollama",
    langchain: "LangChain",
    llamaindex: "LlamaIndex",
    rag: "RAG",
    "vector db": "Vector DB",
    pinecone: "Pinecone",
    pgvector: "pgvector",
    "vertex ai": "Vertex AI",
    "google generative ai": "Gemini",
    // Web3
    solana: "Solana",
    ethereum: "Ethereum",
    walletconnect: "WalletConnect",
    web3: "Web3",
    rainbowkit: "RainbowKit",
    wagmi: "wagmi",
    viem: "viem",
    // Mobile
    "google sign-in": "Google Sign-In",
    "google sign in": "Google Sign-In",
    "google oauth": "Google OAuth",
    "apple sign-in": "Apple Sign-In",
    "apple sign in": "Apple Sign-In",
  };
  if (ALIAS[lower]) return ALIAS[lower];

  // Light prettify for everything else: collapse whitespace, drop a
  // trailing period, capitalise first letter of each word UNLESS the
  // input is already mixed-case (preserve "iOS", "tRPC" style).
  const hasMixedCase = /[A-Z]/.test(s) && /[a-z]/.test(s);
  if (hasMixedCase) return s.replace(/\s+/g, " ");
  return prettify(lower);
}

function prettify(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\.[^./\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length === 0 ? "" : w[0]?.toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Logistic-ish score: usage frequency dominates, with bonuses for
 * recency and code volume. Tuned so a single occurrence in a stale
 * repo lands ~30, three+ active occurrences land ~75+, and the
 * curve plateaus around 95 so chips stay legible.
 */
function scoreSkill(a: SkillAccum): number {
  const usage = a.repos.size;
  const recencyBonus = a.recentRepos > 0 ? 0.4 + Math.min(0.6, a.recentRepos * 0.2) : 0;
  const sizeBonus = a.userLinesSum > 5000 ? 0.4 : a.userLinesSum > 1000 ? 0.2 : 0;
  // Sigmoid in disguise — keeps the output in 0..100 with a smooth shape.
  const x = Math.log2(usage + 1) * 1.4 + recencyBonus + sizeBonus;
  const sig = 1 / (1 + Math.exp(-(x - 1.4)));
  return Math.round(sig * 100);
}

export function aggregateSkillsFromStudies(args: {
  /** Per-repo Kimi judgments — `judgment.technologies` is the source. */
  judgments: Record<string, RepoJudgeOutput>;
  /** Per-repo blame stats (used for the size bonus). */
  studies: Record<string, RepoStudy>;
  /** Pushed-at by repo full name, used for the recency bonus. */
  pushedAtByRepo: Record<string, string | undefined>;
  /** URL we can attribute the source to ("github.com/<handle>"). */
  attributionUrl: string;
}): ManifestSkillAggregation {
  const { judgments, studies, pushedAtByRepo, attributionUrl } = args;
  const accum = new Map<string, SkillAccum>();

  for (const [fullName, j] of Object.entries(judgments)) {
    const pushedAt = pushedAtByRepo[fullName];
    const isRecent = pushedAt ? NOW - Date.parse(pushedAt) < ONE_YEAR_MS : false;
    const userLines = studies[fullName]?.userLines ?? 0;
    const techs = j.judgment.technologies ?? [];
    for (const raw of techs) {
      const name = canonicaliseJudgmentTech(raw);
      if (!name) continue;
      const key = name.toLowerCase();
      const a = accum.get(key) ?? {
        name,
        repos: new Set<string>(),
        recentRepos: 0,
        userLinesSum: 0,
      };
      if (!a.repos.has(fullName)) {
        a.repos.add(fullName);
        if (isRecent) a.recentRepos += 1;
        a.userLinesSum += userLines;
      }
      accum.set(key, a);
    }
  }

  const ranked: Array<{ name: string; usageCount: number; score: number }> = [];
  for (const a of accum.values()) {
    ranked.push({
      name: a.name,
      usageCount: a.repos.size,
      score: scoreSkill(a),
    });
  }
  ranked.sort((a, b) => b.score - a.score || b.usageCount - a.usageCount);

  const facts: TypedFact[] = ranked.map((r) => ({
    kind: "HAS_SKILL",
    skill: {
      canonicalName: r.name,
      usageCount: r.usageCount,
      score: r.score,
    },
    attrs: {
      weight: r.score / 100,
    },
    source: makeSource({
      fetcher: "repo-judge",
      method: "llm-extraction",
      confidence: "high",
      url: attributionUrl,
      snippet: `judged-tech in ${r.usageCount} repo(s)`,
    }),
  }));

  return { facts, ranked };
}
