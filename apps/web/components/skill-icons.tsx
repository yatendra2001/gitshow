/**
 * Skill-icon resolver.
 *
 * The Skills section pills look naked without brand marks. We cover the
 * long tail via `@icons-pack/react-simple-icons` — a tree-shaken wrapper
 * around the ~2,400 simple-icons brand set — and keep a curated alias
 * map in front so the LLM / user can write natural names ("Next.js",
 * "tailwind", "Postgres") and still get the right glyph.
 *
 * Resolution order:
 *   1. Direct alias hit (normalised key matches ALIASES entry)
 *   2. Normalised key lookup in ICON_REGISTRY
 *   3. Fallback to a generic code mark (lucide Code2)
 *
 * iconKey strings are stored in Resume.skills[].iconKey. They stay
 * deliberately user-authorable — anything that resolves here renders.
 */

import type { ComponentType, SVGProps } from "react";
import { Code2 } from "lucide-react";
import {
  SiReact,
  SiNextdotjs,
  SiTypescript,
  SiJavascript,
  SiNodedotjs,
  SiBun,
  SiDeno,
  SiPython,
  SiDjango,
  SiFlask,
  SiFastapi,
  SiNumpy,
  SiPandas,
  SiPytorch,
  SiTensorflow,
  SiGo,
  SiRust,
  SiRuby,
  SiRubyonrails,
  SiPhp,
  SiLaravel,
  SiElixir,
  SiErlang,
  SiSwift,
  SiKotlin,
  SiJetpackcompose,
  SiFlutter,
  SiDart,
  SiCplusplus,
  SiC,
  SiSharp,
  SiDotnet,
  SiHtml5,
  SiCss,
  SiSass,
  SiTailwindcss,
  SiBootstrap,
  SiVuedotjs,
  SiNuxt,
  SiSvelte,
  SiAngular,
  SiSolid,
  SiAstro,
  SiRemix,
  SiGatsby,
  SiVite,
  SiWebpack,
  SiBabel,
  SiEslint,
  SiPrettier,
  SiStorybook,
  SiJest,
  SiCypress,
  SiGraphql,
  SiApollographql,
  SiTrpc,
  SiPrisma,
  SiSupabase,
  SiFirebase,
  SiMongodb,
  SiMysql,
  SiPostgresql,
  SiSqlite,
  SiRedis,
  SiElasticsearch,
  SiDocker,
  SiKubernetes,
  SiHelm,
  SiTerraform,
  SiAnsible,
  SiNginx,
  SiGooglecloud,
  SiCloudflare,
  SiDigitalocean,
  SiVercel,
  SiNetlify,
  SiRender,
  SiRailway,
  SiFlydotio,
  SiGit,
  SiGithub,
  SiGithubactions,
  SiGitlab,
  SiBitbucket,
  SiJenkins,
  SiCircleci,
  SiLinux,
  SiUbuntu,
  SiDebian,
  SiRedhat,
  SiApple,
  SiAndroid,
  SiNotion,
  SiFigma,
  SiSketch,
  SiStripe,
  SiShopify,
  SiAnthropic,
  SiHuggingface,
  SiLangchain,
  SiZod,
  SiRedux,
  SiMobx,
  SiExpo,
  SiGradle,
  SiApachemaven,
  SiSpringboot,
  SiHibernate,
  SiDiscord,
  SiTelegram,
  SiWhatsapp,
  SiGooglemeet,
  SiZoom,
  SiTwitch,
  SiSpotify,
} from "@icons-pack/react-simple-icons";

export type SkillIconComp = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * The canonical registry — key must be a normalised, lowercase slug with no
 * dots, spaces, or punctuation. Resolution `normalize()` turns any user
 * input into this shape.
 */
const ICON_REGISTRY: Record<string, SkillIconComp> = {
  react: SiReact,
  nextjs: SiNextdotjs,
  typescript: SiTypescript,
  javascript: SiJavascript,
  nodejs: SiNodedotjs,
  bun: SiBun,
  deno: SiDeno,
  python: SiPython,
  django: SiDjango,
  flask: SiFlask,
  fastapi: SiFastapi,
  numpy: SiNumpy,
  pandas: SiPandas,
  pytorch: SiPytorch,
  tensorflow: SiTensorflow,
  go: SiGo,
  golang: SiGo,
  rust: SiRust,
  ruby: SiRuby,
  rails: SiRubyonrails,
  rubyonrails: SiRubyonrails,
  php: SiPhp,
  laravel: SiLaravel,
  elixir: SiElixir,
  erlang: SiErlang,
  swift: SiSwift,
  kotlin: SiKotlin,
  jetpackcompose: SiJetpackcompose,
  flutter: SiFlutter,
  dart: SiDart,
  cpp: SiCplusplus,
  cplusplus: SiCplusplus,
  c: SiC,
  csharp: SiSharp,
  dotnet: SiDotnet,
  html: SiHtml5,
  css: SiCss,
  sass: SiSass,
  scss: SiSass,
  tailwind: SiTailwindcss,
  tailwindcss: SiTailwindcss,
  bootstrap: SiBootstrap,
  vue: SiVuedotjs,
  vuejs: SiVuedotjs,
  nuxt: SiNuxt,
  svelte: SiSvelte,
  sveltekit: SiSvelte,
  angular: SiAngular,
  solidjs: SiSolid,
  astro: SiAstro,
  remix: SiRemix,
  gatsby: SiGatsby,
  vite: SiVite,
  webpack: SiWebpack,
  babel: SiBabel,
  eslint: SiEslint,
  prettier: SiPrettier,
  storybook: SiStorybook,
  jest: SiJest,
  cypress: SiCypress,
  graphql: SiGraphql,
  apollo: SiApollographql,
  apollographql: SiApollographql,
  trpc: SiTrpc,
  prisma: SiPrisma,
  supabase: SiSupabase,
  firebase: SiFirebase,
  mongodb: SiMongodb,
  mongo: SiMongodb,
  mysql: SiMysql,
  postgres: SiPostgresql,
  postgresql: SiPostgresql,
  sqlite: SiSqlite,
  redis: SiRedis,
  elasticsearch: SiElasticsearch,
  docker: SiDocker,
  kubernetes: SiKubernetes,
  k8s: SiKubernetes,
  helm: SiHelm,
  terraform: SiTerraform,
  ansible: SiAnsible,
  nginx: SiNginx,
  gcp: SiGooglecloud,
  googlecloud: SiGooglecloud,
  cloudflare: SiCloudflare,
  digitalocean: SiDigitalocean,
  vercel: SiVercel,
  netlify: SiNetlify,
  render: SiRender,
  railway: SiRailway,
  fly: SiFlydotio,
  flyio: SiFlydotio,
  git: SiGit,
  github: SiGithub,
  githubactions: SiGithubactions,
  gitlab: SiGitlab,
  bitbucket: SiBitbucket,
  jenkins: SiJenkins,
  circleci: SiCircleci,
  linux: SiLinux,
  ubuntu: SiUbuntu,
  debian: SiDebian,
  redhat: SiRedhat,
  apple: SiApple,
  macos: SiApple,
  ios: SiApple,
  android: SiAndroid,
  notion: SiNotion,
  figma: SiFigma,
  sketch: SiSketch,
  stripe: SiStripe,
  shopify: SiShopify,
  anthropic: SiAnthropic,
  huggingface: SiHuggingface,
  langchain: SiLangchain,
  zod: SiZod,
  redux: SiRedux,
  mobx: SiMobx,
  expo: SiExpo,
  reactnative: SiReact,
  gradle: SiGradle,
  maven: SiApachemaven,
  apachemaven: SiApachemaven,
  spring: SiSpringboot,
  springboot: SiSpringboot,
  hibernate: SiHibernate,
  discord: SiDiscord,
  telegram: SiTelegram,
  whatsapp: SiWhatsapp,
  googlemeet: SiGooglemeet,
  zoom: SiZoom,
  twitch: SiTwitch,
  spotify: SiSpotify,
};

/**
 * Common-name aliases → canonical keys. Applied after `normalize()` so the
 * left side is already lowercase + alphanumeric. Keeps user-authored
 * iconKey strings forgiving without expanding the main registry.
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
  ror5: "rails",
  cs: "csharp",
  "c++": "cpp",
  "c#": "csharp",
  "f#": "dotnet",
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

/**
 * Normalise a user / LLM iconKey or skill name into a registry lookup key.
 * Lowercases, strips everything that's not a letter or digit.
 */
function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve an iconKey or skill name to an icon component. Returns undefined
 * when nothing matches so the caller can omit the icon rather than show a
 * wrong one.
 */
export function resolveSkillIcon(
  keyOrName: string | undefined,
): SkillIconComp | undefined {
  if (!keyOrName) return undefined;
  const n = normalize(keyOrName);
  if (!n) return undefined;
  const aliased = ALIASES[n] ?? n;
  return ICON_REGISTRY[aliased];
}

/**
 * Same as `resolveSkillIcon` but falls back to a generic code mark instead
 * of undefined. Use in rendering surfaces where you always want to show
 * something — prefer `resolveSkillIcon` for "only render when we actually
 * have a match" flows.
 */
export function resolveSkillIconOrDefault(
  keyOrName: string | undefined,
): SkillIconComp {
  return resolveSkillIcon(keyOrName) ?? (Code2 as SkillIconComp);
}

/**
 * Try hard to produce an iconKey for a given skill name — combining any
 * explicit key with the deterministic name fallback. Intended for the
 * worker's assemble step, which fills `skills[].iconKey` before write so
 * the frontend doesn't have to guess at render time.
 *
 * Returns a lowercase slug when we can resolve, `undefined` otherwise.
 */
export function guessSkillIconKey(
  name: string,
  explicitKey?: string,
): string | undefined {
  // Try explicit first.
  if (explicitKey) {
    const n = normalize(explicitKey);
    const aliased = ALIASES[n] ?? n;
    if (ICON_REGISTRY[aliased]) return aliased;
  }
  // Fall back to the name itself.
  const n = normalize(name);
  const aliased = ALIASES[n] ?? n;
  if (ICON_REGISTRY[aliased]) return aliased;
  return undefined;
}

/**
 * Keys the pipeline / editor can safely suggest. Kept exported so the
 * skills agent's system prompt can reference a canonical list without
 * duplicating it.
 */
export const KNOWN_SKILL_ICON_KEYS = Object.keys(ICON_REGISTRY).sort();
