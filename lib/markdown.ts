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

// `remark-math` is the parser half (~14KB raw across mdast-util-math +
// micromark-extension-math) and stays static: it only turns `$…$` into
// `<code class="language-math …">` nodes. The renderer half — KaTeX — is the
// expensive one and loads on demand, see `loadKatexRehypePlugin`.
export const markdownRemarkPlugins: MarkdownRemarkPlugins = [remarkGfm, remarkMath];
export const markdownPreviewRemarkPlugins: MarkdownRemarkPlugins = [remarkGfm];

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
