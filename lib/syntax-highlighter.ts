// Shared syntax highlighter with an on-demand language set.
//
// The default `Prism` export of react-syntax-highlighter bundles
// `refractor/all` (~290 languages, ~600KB minified) into the first-load
// chunk. PrismLight with explicitly registered languages keeps only the
// languages the app realistically renders; unregistered languages fall
// back to plain text.
import type { CSSProperties } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import {
  vs as vsRaw,
  vscDarkPlus as vscDarkPlusRaw,
  oneLight as oneLightRaw,
  oneDark as oneDarkRaw,
  ghcolors as ghcolorsRaw,
  materialDark as materialDarkRaw,
} from "react-syntax-highlighter/dist/esm/styles/prism";
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
export const oneLight = normalizePrismBackground(oneLightRaw as Record<string, CSSProperties>);
export const oneDark = normalizePrismBackground(oneDarkRaw as Record<string, CSSProperties>);
export const ghcolors = normalizePrismBackground(ghcolorsRaw as Record<string, CSSProperties>);
export const materialDark = normalizePrismBackground(materialDarkRaw as Record<string, CSSProperties>);

const THEME_MAP: Record<CodeThemeId, Record<string, CSSProperties>> = {
  vs,
  ghcolors,
  oneLight,
  vscDarkPlus,
  oneDark,
  materialDark,
};

export const CODE_THEME_OPTIONS: Array<{ id: CodeThemeId; label: string; mode: "light" | "dark" }> = [
  { id: "vs", label: "VS Light", mode: "light" },
  { id: "ghcolors", label: "GitHub Light", mode: "light" },
  { id: "oneLight", label: "One Light", mode: "light" },
  { id: "vscDarkPlus", label: "VS Dark+", mode: "dark" },
  { id: "oneDark", label: "One Dark", mode: "dark" },
  { id: "materialDark", label: "Material Dark", mode: "dark" },
];

export function getCodeThemeStyle(id: CodeThemeId | undefined, isDark: boolean): Record<string, CSSProperties> {
  if (id && THEME_MAP[id]) return THEME_MAP[id];
  return isDark ? vscDarkPlus : vs;
}
