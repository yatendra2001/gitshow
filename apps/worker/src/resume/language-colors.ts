/**
 * Canonical GitHub language → hex color map. Mirrors GitHub's own
 * Linguist palette so timeline dots match the "I like building things"
 * section visually. Kept in-tree instead of pulled from a package so the
 * worker has zero runtime dependency on the language list being fetchable.
 *
 * Source of truth: https://github.com/github-linguist/linguist/blob/main/lib/linguist/languages.yml
 * Only the languages our users are likely to ship are included — if a
 * project's primaryLanguage isn't here, `colorForLanguage` returns a
 * sensible neutral.
 */

const COLORS: Record<string, string> = {
  typescript: "#3178c6",
  javascript: "#f1e05a",
  python: "#3572A5",
  go: "#00ADD8",
  rust: "#dea584",
  java: "#b07219",
  kotlin: "#A97BFF",
  swift: "#F05138",
  "objective-c": "#438eff",
  ruby: "#701516",
  php: "#4F5D95",
  "c#": "#178600",
  "c++": "#f34b7d",
  c: "#555555",
  html: "#e34c26",
  css: "#563d7c",
  scss: "#c6538c",
  sass: "#a53b70",
  less: "#1d365d",
  vue: "#41b883",
  svelte: "#ff3e00",
  elixir: "#6e4a7e",
  haskell: "#5e5086",
  ocaml: "#3be133",
  clojure: "#db5855",
  scala: "#c22d40",
  dart: "#00B4AB",
  lua: "#000080",
  perl: "#0298c3",
  shell: "#89e051",
  powershell: "#012456",
  dockerfile: "#384d54",
  makefile: "#427819",
  cmake: "#DA3434",
  zig: "#ec915c",
  nim: "#ffc200",
  crystal: "#000100",
  erlang: "#B83998",
  "f#": "#b845fc",
  julia: "#a270ba",
  r: "#198CE7",
  matlab: "#e16737",
  hcl: "#844FBA",
  terraform: "#844FBA",
  solidity: "#AA6746",
  mdx: "#fcb32c",
  markdown: "#083fa1",
  tex: "#3D6117",
  jupyter: "#DA5B0B",
  "jupyter notebook": "#DA5B0B",
  assembly: "#6E4C13",
};

/** Neutral fallback for unknown/empty languages. */
const NEUTRAL = "#8a8a8a";

export function colorForLanguage(language: string | null | undefined): string {
  if (!language) return NEUTRAL;
  return COLORS[language.toLowerCase()] ?? NEUTRAL;
}
