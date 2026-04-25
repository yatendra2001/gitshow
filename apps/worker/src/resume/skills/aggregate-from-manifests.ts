/**
 * Manifest-driven skills aggregator.
 *
 * Replaces the GitHub-topics-as-skills path that was emitting weird
 * chips like "flutter-test" and "code-signing". Walks every studied
 * repo's manifest dependencies (package.json deps, Cargo.toml,
 * pubspec.yaml, etc.), counts usage frequency, applies a slug-aware
 * canonicalisation pass, and emits HAS_SKILL TypedFacts with both
 * the count + a 0..100 strength score.
 *
 * The score is the field the renderer's UI bars use:
 *
 *   score = 100 * sigmoid(usage*1.6 + recencyBonus + sizeBonus)
 *
 * — meaning a skill seen in 1 stale repo lands ~25-35; a skill seen
 * in 8 active repos lands 90+. The exact curve is tuned for the
 * common case (5-30 owned repos); everything's bounded so a power
 * user with 200 repos doesn't max out the entire chart.
 */
import { makeSource, type TypedFact } from "@gitshow/shared/kg";
import type { RepoStudy, ManifestEcosystem } from "../../repo-study.js";

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
  studies: Record<string, RepoStudy>;
  /** Pushed-at by repo full name, used for the recency bonus. */
  pushedAtByRepo: Record<string, string | undefined>;
  /** URL we can attribute the source to ("github.com/<handle>"). */
  attributionUrl: string;
}): ManifestSkillAggregation {
  const { studies, pushedAtByRepo, attributionUrl } = args;
  const accum = new Map<string, SkillAccum>();

  for (const [fullName, study] of Object.entries(studies)) {
    const pushedAt = pushedAtByRepo[fullName];
    const isRecent = pushedAt ? NOW - Date.parse(pushedAt) < ONE_YEAR_MS : false;
    const userLines = study.userLines;
    for (const dep of study.manifestDeps) {
      const name = canonicaliseSkill(dep.name, dep.ecosystem);
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
      fetcher: "github-fetcher",
      method: "api",
      confidence: "high",
      url: attributionUrl,
      snippet: `manifest mentions in ${r.usageCount} repo(s)`,
    }),
  }));

  return { facts, ranked };
}
