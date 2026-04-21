/**
 * Single source of truth for known skill-icon slugs and the alias map
 * that normalises user / LLM input.
 *
 * The React components live in `apps/web/components/skill-icons.tsx` —
 * this file must stay React-free so the Fly worker can import the same
 * slug list for deterministic `guessSkillIconKey()` in the assemble step.
 *
 * IMPORTANT: keep this list in sync with the ICON_REGISTRY keys in
 * `apps/web/components/skill-icons.tsx`. If a slug exists here but not
 * there, the agent might assign it and the web page will fail to render
 * an icon for it. The web bundle doesn't need to import this file — it
 * duplicates the list inline — but keeping this here means the worker
 * + editor stay correct.
 */

export const SKILL_ICON_SLUGS: ReadonlyArray<string> = [
  "react",
  "nextjs",
  "typescript",
  "javascript",
  "nodejs",
  "bun",
  "deno",
  "python",
  "django",
  "flask",
  "fastapi",
  "numpy",
  "pandas",
  "pytorch",
  "tensorflow",
  "go",
  "golang",
  "rust",
  "ruby",
  "rails",
  "rubyonrails",
  "php",
  "laravel",
  "elixir",
  "erlang",
  "swift",
  "kotlin",
  "jetpackcompose",
  "flutter",
  "dart",
  "cpp",
  "cplusplus",
  "c",
  "csharp",
  "dotnet",
  "html",
  "css",
  "sass",
  "scss",
  "tailwind",
  "tailwindcss",
  "bootstrap",
  "vue",
  "vuejs",
  "nuxt",
  "svelte",
  "sveltekit",
  "angular",
  "solidjs",
  "astro",
  "remix",
  "gatsby",
  "vite",
  "webpack",
  "babel",
  "eslint",
  "prettier",
  "storybook",
  "jest",
  "cypress",
  "graphql",
  "apollo",
  "apollographql",
  "trpc",
  "prisma",
  "supabase",
  "firebase",
  "mongodb",
  "mongo",
  "mysql",
  "postgres",
  "postgresql",
  "sqlite",
  "redis",
  "elasticsearch",
  "docker",
  "kubernetes",
  "k8s",
  "helm",
  "terraform",
  "ansible",
  "nginx",
  "gcp",
  "googlecloud",
  "cloudflare",
  "digitalocean",
  "vercel",
  "netlify",
  "render",
  "railway",
  "fly",
  "flyio",
  "git",
  "github",
  "githubactions",
  "gitlab",
  "bitbucket",
  "jenkins",
  "circleci",
  "linux",
  "ubuntu",
  "debian",
  "redhat",
  "apple",
  "macos",
  "ios",
  "android",
  "notion",
  "figma",
  "sketch",
  "stripe",
  "shopify",
  "anthropic",
  "huggingface",
  "langchain",
  "zod",
  "redux",
  "mobx",
  "expo",
  "reactnative",
  "gradle",
  "maven",
  "apachemaven",
  "spring",
  "springboot",
  "hibernate",
  "discord",
  "telegram",
  "whatsapp",
  "googlemeet",
  "zoom",
  "twitch",
  "spotify",
] as const;

const SKILL_ICON_SLUG_SET: ReadonlySet<string> = new Set(SKILL_ICON_SLUGS);

/**
 * Forgiving alias map for common short-forms, punctuation, and .js suffixes.
 * Keys are normalised (lowercase alphanumeric) — applied AFTER `normalize`.
 */
const ALIASES: Record<string, string> = {
  reactjs: "react",
  nextdotjs: "nextjs",
  nodedotjs: "nodejs",
  node: "nodejs",
  ts: "typescript",
  js: "javascript",
  py: "python",
  vuedotjs: "vue",
  ror: "rails",
  cs: "csharp",
  cpp: "cpp",
  pgsql: "postgres",
  psql: "postgres",
  mongoose: "mongodb",
  k3s: "kubernetes",
  tf: "terraform",
  gh: "github",
  gha: "githubactions",
  ghactions: "githubactions",
  openaiapi: "openai",
  claude: "anthropic",
  hf: "huggingface",
};

function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Deterministic best-effort iconKey for a skill pill.
 *
 * Used by the worker's skills-agent as a post-submit backfill — the LLM
 * picks from our allow-list, but we normalise both what it returned and
 * the raw display name so a "Tailwind CSS" without iconKey still comes
 * out with `iconKey: "tailwindcss"`.
 *
 * Returns `undefined` when nothing matches; the renderer handles that
 * by rendering a text-only pill.
 */
export function guessSkillIconKey(
  name: string,
  explicitKey?: string | null,
): string | undefined {
  if (explicitKey) {
    const n = normalize(explicitKey);
    const aliased = ALIASES[n] ?? n;
    if (SKILL_ICON_SLUG_SET.has(aliased)) return aliased;
  }
  const n = normalize(name);
  const aliased = ALIASES[n] ?? n;
  if (SKILL_ICON_SLUG_SET.has(aliased)) return aliased;
  return undefined;
}
