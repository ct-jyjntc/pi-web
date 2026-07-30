// Shared syntax highlighter with an on-demand language and theme set.
//
// The default `Prism` export of react-syntax-highlighter bundles
// `refractor/all` (~290 languages, ~600KB minified) into the first-load
// chunk. PrismLight with explicitly registered languages keeps only the
// languages the app realistically renders; unregistered languages fall
// back to plain text. Themes follow the same rule: only the two defaults are
// static, the rest are fetched when selected (see THEME_LOADERS).
import type { CSSProperties } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import vsRaw from "react-syntax-highlighter/dist/esm/styles/prism/vs";
import vscDarkPlusRaw from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";
import { setAppearanceSnapshot } from "@/lib/appearance-store";
import type { CodeThemeId } from "@/lib/web-settings";

import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import makefile from "react-syntax-highlighter/dist/esm/languages/prism/makefile";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import scss from "react-syntax-highlighter/dist/esm/languages/prism/scss";
import shellSession from "react-syntax-highlighter/dist/esm/languages/prism/shell-session";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

const languages = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  docker,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  jsx,
  kotlin,
  makefile,
  markdown,
  markup,
  php,
  python,
  ruby,
  rust,
  scss,
  "shell-session": shellSession,
  sql,
  swift,
  toml,
  tsx,
  typescript,
  yaml,
} as const;

const aliases: Record<string, unknown> = {
  sh: bash,
  shell: bash,
  zsh: bash,
  console: shellSession,
  js: javascript,
  mjs: javascript,
  cjs: javascript,
  ts: typescript,
  py: python,
  yml: yaml,
  html: markup,
  xml: markup,
  svg: markup,
  dockerfile: docker,
  md: markdown,
  golang: go,
  rb: ruby,
  kt: kotlin,
  "c++": cpp,
  cs: csharp,
  patch: diff,
};

for (const [name, lang] of Object.entries(languages)) {
  SyntaxHighlighter.registerLanguage(name, lang);
}
for (const [name, lang] of Object.entries(aliases)) {
  SyntaxHighlighter.registerLanguage(name, lang);
}

export { SyntaxHighlighter };
export { default as createSyntaxElement } from "react-syntax-highlighter/dist/esm/create-element";
export type { SyntaxHighlighterProps } from "react-syntax-highlighter";

/**
 * Prism themes disagree on background shorthand:
 * - `vs` uses `backgroundColor`
 * - `vsc-dark-plus` uses `background`
 * Switching themes re-renders <pre> and React warns if both exist across updates.
 * Normalize every style entry to `backgroundColor` only.
 */
function normalizePrismBackground(
  style: Record<string, CSSProperties>,
): Record<string, CSSProperties> {
  const next: Record<string, CSSProperties> = {};
  for (const [selector, rules] of Object.entries(style)) {
    if (!rules || typeof rules !== "object") {
      next[selector] = rules;
      continue;
    }
    const copy: CSSProperties = { ...rules };
    const bg = (copy as { background?: string }).background;
    if (typeof bg === "string" && bg && !copy.backgroundColor) {
      copy.backgroundColor = bg;
    }
    delete (copy as { background?: string }).background;
    next[selector] = copy;
  }
  return next;
}

export const vs = normalizePrismBackground(vsRaw as Record<string, CSSProperties>);
export const vscDarkPlus = normalizePrismBackground(vscDarkPlusRaw as Record<string, CSSProperties>);

/**
 * Only the two default themes ship in the first-load chunk. The other four are
 * ~29KB raw / ~4.7KB gzip of style objects that most users never select, so
 * they are fetched the first time they are actually asked for.
 */
const THEME_LOADERS: Partial<Record<CodeThemeId, () => Promise<{ default: Record<string, CSSProperties> }>>> = {
  oneLight: () => import("react-syntax-highlighter/dist/esm/styles/prism/one-light"),
  oneDark: () => import("react-syntax-highlighter/dist/esm/styles/prism/one-dark"),
  ghcolors: () => import("react-syntax-highlighter/dist/esm/styles/prism/ghcolors"),
  materialDark: () => import("react-syntax-highlighter/dist/esm/styles/prism/material-dark"),
};

const THEME_MAP: Partial<Record<CodeThemeId, Record<string, CSSProperties>>> = {
  vs,
  vscDarkPlus,
};

const loadingThemes = new Set<CodeThemeId>();

function loadTheme(id: CodeThemeId): void {
  // SSR only ever asks for the two defaults (useAppearance falls back to
  // DEFAULTS on the server), so keep module state request-independent.
  if (typeof window === "undefined") return;
  const loader = THEME_LOADERS[id];
  if (!loader || loadingThemes.has(id)) return;
  loadingThemes.add(id);
  void loader()
    .then((mod) => {
      THEME_MAP[id] = normalizePrismBackground(mod.default);
      // getCodeThemeStyle() has to stay synchronous — its callers read it
      // straight out of render. Every one of them also reads useAppearance(),
      // so re-emitting the (unchanged) snapshot is what repaints them with the
      // real theme once the chunk lands.
      setAppearanceSnapshot({});
    })
    .catch(() => {
      loadingThemes.delete(id);
    });
}

export const CODE_THEME_OPTIONS: Array<{ id: CodeThemeId; label: string; mode: "light" | "dark" }> = [
  { id: "vs", label: "VS Light", mode: "light" },
  { id: "ghcolors", label: "GitHub Light", mode: "light" },
  { id: "oneLight", label: "One Light", mode: "light" },
  { id: "vscDarkPlus", label: "VS Dark+", mode: "dark" },
  { id: "oneDark", label: "One Dark", mode: "dark" },
  { id: "materialDark", label: "Material Dark", mode: "dark" },
];

/**
 * Synchronous by contract. A theme that has not been fetched yet renders with
 * the matching default for one paint and upgrades in place.
 */
export function getCodeThemeStyle(id: CodeThemeId | undefined, isDark: boolean): Record<string, CSSProperties> {
  const fallback = isDark ? vscDarkPlus : vs;
  if (!id) return fallback;
  const loaded = THEME_MAP[id];
  if (loaded) return loaded;
  loadTheme(id);
  return fallback;
}
