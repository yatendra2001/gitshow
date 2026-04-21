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

import { createElement, type ComponentType, type SVGProps } from "react";
import { Code2 } from "lucide-react";
import type { IconType } from "@icons-pack/react-simple-icons";
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
 * Wrap a simple-icons component so it defaults to the brand hex rather
 * than `currentColor`. Callers can still pass an explicit `color` /
 * `fill` prop to override. We need this indirection because the
 * underlying components default `color = "currentColor"`; monochrome
 * skill chips feel off next to a colourful portfolio.
 */
function colored(Icon: IconType): SkillIconComp {
  const Wrapped = (props: SVGProps<SVGSVGElement>) =>
    createElement(Icon, {
      color: "default",
      ...(props as Record<string, unknown>),
    });
  Wrapped.displayName = `ColoredSkillIcon`;
  return Wrapped as SkillIconComp;
}

/**
 * The canonical registry — key must be a normalised, lowercase slug with no
 * dots, spaces, or punctuation. Resolution `normalize()` turns any user
 * input into this shape.
 */
const ICON_REGISTRY: Record<string, SkillIconComp> = {
  react: colored(SiReact),
  nextjs: colored(SiNextdotjs),
  typescript: colored(SiTypescript),
  javascript: colored(SiJavascript),
  nodejs: colored(SiNodedotjs),
  bun: colored(SiBun),
  deno: colored(SiDeno),
  python: colored(SiPython),
  django: colored(SiDjango),
  flask: colored(SiFlask),
  fastapi: colored(SiFastapi),
  numpy: colored(SiNumpy),
  pandas: colored(SiPandas),
  pytorch: colored(SiPytorch),
  tensorflow: colored(SiTensorflow),
  go: colored(SiGo),
  golang: colored(SiGo),
  rust: colored(SiRust),
  ruby: colored(SiRuby),
  rails: colored(SiRubyonrails),
  rubyonrails: colored(SiRubyonrails),
  php: colored(SiPhp),
  laravel: colored(SiLaravel),
  elixir: colored(SiElixir),
  erlang: colored(SiErlang),
  swift: colored(SiSwift),
  kotlin: colored(SiKotlin),
  jetpackcompose: colored(SiJetpackcompose),
  flutter: colored(SiFlutter),
  dart: colored(SiDart),
  cpp: colored(SiCplusplus),
  cplusplus: colored(SiCplusplus),
  c: colored(SiC),
  csharp: colored(SiSharp),
  dotnet: colored(SiDotnet),
  html: colored(SiHtml5),
  css: colored(SiCss),
  sass: colored(SiSass),
  scss: colored(SiSass),
  tailwind: colored(SiTailwindcss),
  tailwindcss: colored(SiTailwindcss),
  bootstrap: colored(SiBootstrap),
  vue: colored(SiVuedotjs),
  vuejs: colored(SiVuedotjs),
  nuxt: colored(SiNuxt),
  svelte: colored(SiSvelte),
  sveltekit: colored(SiSvelte),
  angular: colored(SiAngular),
  solidjs: colored(SiSolid),
  astro: colored(SiAstro),
  remix: colored(SiRemix),
  gatsby: colored(SiGatsby),
  vite: colored(SiVite),
  webpack: colored(SiWebpack),
  babel: colored(SiBabel),
  eslint: colored(SiEslint),
  prettier: colored(SiPrettier),
  storybook: colored(SiStorybook),
  jest: colored(SiJest),
  cypress: colored(SiCypress),
  graphql: colored(SiGraphql),
  apollo: colored(SiApollographql),
  apollographql: colored(SiApollographql),
  trpc: colored(SiTrpc),
  prisma: colored(SiPrisma),
  supabase: colored(SiSupabase),
  firebase: colored(SiFirebase),
  mongodb: colored(SiMongodb),
  mongo: colored(SiMongodb),
  mysql: colored(SiMysql),
  postgres: colored(SiPostgresql),
  postgresql: colored(SiPostgresql),
  sqlite: colored(SiSqlite),
  redis: colored(SiRedis),
  elasticsearch: colored(SiElasticsearch),
  docker: colored(SiDocker),
  kubernetes: colored(SiKubernetes),
  k8s: colored(SiKubernetes),
  helm: colored(SiHelm),
  terraform: colored(SiTerraform),
  ansible: colored(SiAnsible),
  nginx: colored(SiNginx),
  gcp: colored(SiGooglecloud),
  googlecloud: colored(SiGooglecloud),
  cloudflare: colored(SiCloudflare),
  digitalocean: colored(SiDigitalocean),
  vercel: colored(SiVercel),
  netlify: colored(SiNetlify),
  render: colored(SiRender),
  railway: colored(SiRailway),
  fly: colored(SiFlydotio),
  flyio: colored(SiFlydotio),
  git: colored(SiGit),
  github: colored(SiGithub),
  githubactions: colored(SiGithubactions),
  gitlab: colored(SiGitlab),
  bitbucket: colored(SiBitbucket),
  jenkins: colored(SiJenkins),
  circleci: colored(SiCircleci),
  linux: colored(SiLinux),
  ubuntu: colored(SiUbuntu),
  debian: colored(SiDebian),
  redhat: colored(SiRedhat),
  apple: colored(SiApple),
  macos: colored(SiApple),
  ios: colored(SiApple),
  android: colored(SiAndroid),
  notion: colored(SiNotion),
  figma: colored(SiFigma),
  sketch: colored(SiSketch),
  stripe: colored(SiStripe),
  shopify: colored(SiShopify),
  anthropic: colored(SiAnthropic),
  huggingface: colored(SiHuggingface),
  langchain: colored(SiLangchain),
  zod: colored(SiZod),
  redux: colored(SiRedux),
  mobx: colored(SiMobx),
  expo: colored(SiExpo),
  reactnative: colored(SiReact),
  gradle: colored(SiGradle),
  maven: colored(SiApachemaven),
  apachemaven: colored(SiApachemaven),
  spring: colored(SiSpringboot),
  springboot: colored(SiSpringboot),
  hibernate: colored(SiHibernate),
  discord: colored(SiDiscord),
  telegram: colored(SiTelegram),
  whatsapp: colored(SiWhatsapp),
  googlemeet: colored(SiGooglemeet),
  zoom: colored(SiZoom),
  twitch: colored(SiTwitch),
  spotify: colored(SiSpotify),
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
