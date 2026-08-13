import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export type MarkdownRehypePlugins = NonNullable<ReactMarkdownOptions["rehypePlugins"]>;
export type MarkdownRehypePlugin = MarkdownRehypePlugins[number];
type MarkdownRemarkPlugins = NonNullable<ReactMarkdownOptions["remarkPlugins"]>;

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};

/**
 * Normalize display-math fences so remark-math can parse them: split single-line
 * `$$…$$` / `\[…\]`, unglue multi-line openers/closers, re-indent list-nested
 * content, and bound unmatched scans so sibling list items are never used as
 * closing fences.
 */
export function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const normalized: string[] = [];
  let fence: { marker: string; size: number } | null = null;
  let inlineCodeMarkerSize = 0;
  let rawCodeTag: string | null = null;
  const unmatchedDisplayMathUntil = new Map<string, number>();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (rawCodeTag) {
      normalized.push(line);
      if (new RegExp(`</${rawCodeTag}\\s*>`, "i").test(line)) rawCodeTag = null;
      continue;
    }

    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const size = fenceMatch[1].length;
      if (!fence) fence = { marker, size };
      else if (marker === fence.marker && size >= fence.size) fence = null;
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (fence) {
      normalized.push(line);
      continue;
    }

    const rawCodeOpen = line.match(/<(code|pre|script|style)\b/i);
    if (rawCodeOpen) {
      const tag = rawCodeOpen[1].toLowerCase();
      const remainder = line.slice((rawCodeOpen.index ?? 0) + rawCodeOpen[0].length);
      if (!new RegExp(`</${tag}\\s*>`, "i").test(remainder)) rawCodeTag = tag;
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (/^(?: {4}|\t)/.test(line) || line.trim() === "") {
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (inlineCodeMarkerSize || line.includes("`")) {
      inlineCodeMarkerSize = updateInlineCodeMarker(line, inlineCodeMarkerSize);
      normalized.push(line);
      continue;
    }

    const bracketDisplayOneLine = line.match(/^([ ]{0,3})\\\[[ \t]*(.+?)[ \t]*\\\][ \t]*$/);
    if (bracketDisplayOneLine) {
      const math = bracketDisplayOneLine[2].trim();
      if (math) {
        // Keep content indented with the fence so list-nested formulas don't become lazy continuations.
        normalized.push(
          `${bracketDisplayOneLine[1]}$$`,
          `${bracketDisplayOneLine[1]}${math}`,
          `${bracketDisplayOneLine[1]}$$`,
        );
        continue;
      }
    }

    const bracketDisplayStart = line.match(/^([ ]{0,3})\\\[[ \t]*$/);
    if (bracketDisplayStart) {
      const closingIndex = findBracketDisplayClose(lines, index + 1);
      if (closingIndex !== -1) {
        normalized.push(
          `${bracketDisplayStart[1]}$$`,
          ...lines.slice(index + 1, closingIndex).map((mathLine) =>
            indentDisplayMathContent(mathLine, bracketDisplayStart[1]),
          ),
          `${bracketDisplayStart[1]}$$`,
        );
        index = closingIndex;
        continue;
      }
    }

    const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
    if (displayMathMatch) {
      const math = displayMathMatch[2].trim();
      if (math) {
        normalized.push(
          `${displayMathMatch[1]}$$`,
          `${displayMathMatch[1]}${math}`,
          `${displayMathMatch[1]}$$`,
        );
        continue;
      }
    }

    // Multi-line with glued opener (`$$x = 1` …) and/or glued closer (`y = 2$$`).
    const displayMathMultiLine = line.match(/^([ \t]{0,3})\$\$(.+)$/);
    if (displayMathMultiLine) {
      const indent = displayMathMultiLine[1];
      const firstLine = displayMathMultiLine[2].trimEnd();
      // Mid-line second `$$` (e.g. `$$x$$ and text`) stays inline math.
      if (firstLine && !firstLine.includes("$$")) {
        const closing = findDisplayMathClose(
          lines,
          index + 1,
          indent,
          unmatchedDisplayMathUntil,
        );
        if (closing) {
          normalized.push(`${indent}$$`, `${indent}${firstLine}`);
          for (let j = index + 1; j < closing.index; j++) {
            normalized.push(indentDisplayMathContent(lines[j], indent));
          }
          if (closing.content) normalized.push(`${indent}${closing.content}`);
          normalized.push(`${indent}$$`);
          index = closing.index;
          continue;
        }
      }
    }

    // Bare `$$` opener (optionally indented in a list item).
    const displayMathBareOpen = line.match(/^([ \t]{0,3})\$\$\s*$/);
    if (displayMathBareOpen) {
      const indent = displayMathBareOpen[1];
      const closing = findDisplayMathClose(
        lines,
        index + 1,
        indent,
        unmatchedDisplayMathUntil,
      );
      if (closing && (closing.glued || indent !== "")) {
        normalized.push(`${indent}$$`);
        for (let j = index + 1; j < closing.index; j++) {
          normalized.push(indentDisplayMathContent(lines[j], indent));
        }
        if (closing.content) normalized.push(`${indent}${closing.content}`);
        normalized.push(`${indent}$$`);
        index = closing.index;
        continue;
      }
    }

    normalized.push(normalizeInlineLatexMath(line));
  }

  return normalized.join(lineBreak);
}

interface DisplayMathClose {
  index: number;
  content: string;
  glued: boolean;
}

function findDisplayMathClose(
  lines: string[],
  startIndex: number,
  indent: string,
  unmatchedUntil: Map<string, number>,
): DisplayMathClose | null {
  const knownUnmatchedUntil = unmatchedUntil.get(indent);
  if (knownUnmatchedUntil !== undefined && startIndex < knownUnmatchedUntil) return null;

  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (isDisplayMathFence(line, indent)) return { index, content: "", glued: false };

    // Do not let a later sibling list item close this block.
    if (isDisplayMathBlockBoundary(line) || isDisplayMathOpeningLine(line)) {
      unmatchedUntil.set(indent, index);
      return null;
    }

    const content = getDisplayMathGluedCloseContent(line, indent);
    if (content !== null) return { index, content, glued: true };
  }

  unmatchedUntil.set(indent, lines.length);
  return null;
}

function isDisplayMathFence(line: string, indent: string): boolean {
  if (indent === "") return /^ {0,3}\$\$\s*$/.test(line);
  return line.startsWith(indent) && /^\$\$\s*$/.test(line.slice(indent.length));
}

function getDisplayMathGluedCloseContent(line: string, indent: string): string | null {
  if (!line.startsWith(indent)) return null;

  const match = line.slice(indent.length).match(/^(.+?)\$\$\s*$/);
  if (!match) return null;

  const content = match[1].trimEnd();
  return content && !content.includes("$$") ? content : null;
}

function isDisplayMathOpeningLine(line: string): boolean {
  return /^ {0,3}\$\$(?:\S|[ \t]+\S)/.test(line);
}

function isDisplayMathBlockBoundary(line: string): boolean {
  return (
    /^ {0,3}(`{3,}|~{3,})/.test(line)
    || /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.test(line)
    || /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line)
    || /^ {0,3}>/.test(line)
    || /<(code|pre|script|style)\b/i.test(line)
  );
}

function indentDisplayMathContent(line: string, indent: string): string {
  if (!indent || !line || line.startsWith("\t")) return line;

  const leadingSpaces = line.match(/^ */)?.[0].length ?? 0;
  if (leadingSpaces >= indent.length) return line;
  return `${indent.slice(leadingSpaces)}${line}`;
}

function findBracketDisplayClose(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (/^ {0,3}\\\][ \t]*$/.test(line)) return index;

    if (
      /^ {0,3}(`{3,}|~{3,})/.test(line)
      || /^ {0,3}\\\[[ \t]*$/.test(line)
      || /<(code|pre|script|style)\b/i.test(line)
    ) {
      return -1;
    }
  }

  return -1;
}

function updateInlineCodeMarker(line: string, initialMarkerSize: number): number {
  let markerSize = initialMarkerSize;
  for (let cursor = 0; cursor < line.length;) {
    if (line[cursor] !== "`") {
      cursor++;
      continue;
    }

    let end = cursor + 1;
    while (line[end] === "`") end++;
    const runSize = end - cursor;
    if (markerSize === 0) markerSize = runSize;
    else if (runSize === markerSize) markerSize = 0;
    cursor = end;
  }
  return markerSize;
}

function normalizeInlineLatexMath(line: string): string {
  if (
    /^\s{0,3}\[[^\]]+\]:/.test(line)
    || /]\s*\(/.test(line)
    || /<(?:!--|\/?[A-Za-z][^>]*>)/.test(line)
    || /\b(?:https?|file|mailto):/i.test(line)
    || /\b[A-Za-z]:\\/.test(line)
  ) {
    return line;
  }

  return line.replace(
    /(?<!\\)\\\(([^`\r\n$]+?)(?<!\\)\\\)/g,
    (match, math: string) => (math.trim() ? `$${math}$` : match),
  );
}

// `remark-math` is the parser half (~14KB raw across mdast-util-math +
// micromark-extension-math) and stays static: it only turns `$…$` into
// `<code class="language-math …">` nodes. The renderer half — KaTeX — is the
// expensive one and loads on demand, see `loadKatexRehypePlugin`.
// singleTilde:false — a lone `~` in CJK ranges (`5~7U`, `100~200倍`) must not become strikethrough.
const gfm: MarkdownRemarkPlugins[number] = [remarkGfm, { singleTilde: false }];
export const markdownRemarkPlugins: MarkdownRemarkPlugins = [gfm, remarkMath];
export const markdownPreviewRemarkPlugins: MarkdownRemarkPlugins = [gfm];

/**
 * Base rehype pipeline. KaTeX is deliberately absent: a static `rehype-katex`
 * import is the only client path to katex, and it drags a 264KB (76KB gzip)
 * chunk plus a 29.7KB stylesheet into the first load for every reader — even
 * the file preview below, which never renders math.
 */
export const markdownRehypePlugins: MarkdownRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
];

/** File preview intentionally renders math as literal text. */
export const markdownPreviewRehypePlugins: MarkdownRehypePlugins = markdownRehypePlugins;

/**
 * Conservative probe for "this document might contain math": a `$…$` pair,
 * `$$`, `\(` or `\[`. `[^$]+` deliberately spans newlines because micromark
 * allows inline math to wrap inside a paragraph.
 *
 * It over-matches on purpose (`$1 and $2`, `echo $A; echo $B`, `costs $5 or
 * $10`, a stray `\(` in a regex). A false positive only costs one async chunk
 * that the browser then caches; a false negative renders formulas as raw TeX.
 */
export const MARKDOWN_MATH_PATTERN = /\$\$|\\\(|\\\[|\$[^$]+\$/;

let katexPlugin: MarkdownRehypePlugin | null = null;
let katexPromise: Promise<MarkdownRehypePlugin> | null = null;

/** Already-resolved plugin, so remounts can seed state without a flash. */
export function getLoadedKatexRehypePlugin(): MarkdownRehypePlugin | null {
  return katexPlugin;
}

/**
 * Pulls rehype-katex and katex's stylesheet into one async chunk, shared by
 * every caller. The `.css` import has to sit inside this dynamic import — a
 * top-level one (it used to live in app/layout.tsx) becomes a render-blocking
 * first-load stylesheet. A stylesheet failure must not block math itself.
 */
export function loadKatexRehypePlugin(): Promise<MarkdownRehypePlugin> {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import("rehype-katex"),
      import("katex/dist/katex.min.css").catch(() => undefined),
    ])
      .then(([mod]): MarkdownRehypePlugin => {
        const plugin: MarkdownRehypePlugin = [mod.default, { throwOnError: false, strict: false }];
        katexPlugin = plugin;
        return plugin;
      })
      .catch((error: unknown): never => {
        // Allow a retry on the next message that needs math.
        katexPromise = null;
        throw error;
      });
  }
  return katexPromise;
}
