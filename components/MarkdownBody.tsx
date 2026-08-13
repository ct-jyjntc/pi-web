"use client";

import { useLocale } from "@/hooks/useLocale";

import { useEffect, useMemo, useRef, useState, memo, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { getCodeThemeStyle, SyntaxHighlighter } from "@/lib/syntax-highlighter";
import { useTheme } from "@/hooks/useTheme";
import { useAppearance } from "@/lib/appearance-store";
import { copyText } from "@/lib/clipboard";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { PreviewableImage } from "./PreviewableImage";
import {
  getLoadedKatexRehypePlugin,
  loadKatexRehypePlugin,
  markdownRehypePlugins,
  markdownRemarkPlugins,
  MARKDOWN_MATH_PATTERN,
  normalizeDisplayMath,
  type MarkdownRehypePlugin,
  type MarkdownRehypePlugins,
} from "@/lib/markdown";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

const MAX_MARKDOWN_CHARS = 100_000;

export const MarkdownBody = memo(function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  const { t } = useLocale();
  const oversized = children.length > MAX_MARKDOWN_CHARS;
  const renderSource = oversized ? `${children.slice(0, MAX_MARKDOWN_CHARS)}\n\n…` : children;
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(renderSource), [renderSource]);

  // While streaming, split the document at the last "safe" paragraph boundary
  // and render the stable prefix as a memoized segment. Each 100ms stream tick
  // then only re-runs the remark/rehype pipeline over the short tail being
  // typed, instead of the whole (growing) message.
  const { stable, tail, streamingCode } = useMemo(
    () =>
      isStreaming
        ? splitStreamingMarkdown(normalizedMarkdown)
        : { stable: normalizedMarkdown, tail: "", streamingCode: null },
    [isStreaming, normalizedMarkdown],
  );

  // Read through a ref instead of a `components` dependency: a new components
  // map busts MarkdownSegment's memo, which would re-parse the stable prefix on
  // every tick — exactly what the split above exists to avoid.
  const streamingCodeRef = useRef<string | null>(null);
  streamingCodeRef.current = streamingCode;

  // KaTeX is a 264KB / 76KB gzip download, so it only arrives once a message
  // actually contains math. `normalizedMarkdown` grows during streaming, so a
  // formula appearing in a later token flips this and triggers the load then.
  const [katexPlugin, setKatexPlugin] = useState<MarkdownRehypePlugin | null>(getLoadedKatexRehypePlugin);
  const needsMath = useMemo(() => MARKDOWN_MATH_PATTERN.test(normalizedMarkdown), [normalizedMarkdown]);

  useEffect(() => {
    if (!needsMath || katexPlugin) return;
    let live = true;
    loadKatexRehypePlugin().then(
      (plugin) => {
        if (live) setKatexPlugin(() => plugin);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [needsMath, katexPlugin]);

  const rehypePlugins = useMemo<MarkdownRehypePlugins>(
    () => (katexPlugin ? [...markdownRehypePlugins, katexPlugin] : markdownRehypePlugins),
    [katexPlugin],
  );

  // Stable components map — recreating this every render forces ReactMarkdown to
  // drop internal memoization and re-walk the whole AST on every token.
  const components = useMemo(() => ({
          code({ className, children, ...props }: { className?: string; children?: ReactNode; node?: unknown }) {
            // remark-math emits `<code class="language-math math-inline|math-display">`
            // and rehype-katex replaces those nodes once it has loaded. Until
            // then render the TeX source as plain text rather than dropping it
            // into code-block chrome.
            if (className?.includes("math-inline") || className?.includes("math-display")) {
              return <>{children}</>;
            }
            const lang = className?.replace("language-", "").toLowerCase() ?? "";
            const raw = String(children);
            const isBlock = className?.includes("language-") || raw.includes("\n");
            if (isBlock) {
              const code = raw.replace(/\n$/, "");
              if (lang === "mermaid") {
                return <MermaidBlock code={code} isStreaming={isStreaming} />;
              }
              return <CodeBlock code={code} lang={lang} plain={code === streamingCodeRef.current} />;
            }
            return (
              <code
                className="markdown-inline-code"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }: { children?: ReactNode }) {
            return <>{children}</>;
          },
          a({ href, children, ...props }: { href?: string; children?: ReactNode; node?: unknown }) {
            // `node` is react-markdown metadata, not a DOM attribute.
            delete props.node;
            const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
            const openFile = onOpenFile;
            if (!filePath || !openFile) {
              return (
                <a href={href} {...props} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            }

            const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
              if (event.defaultPrevented || event.button !== 0) return;
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              const target = event.currentTarget.getAttribute("target");
              if (target && target !== "_self") return;
              event.preventDefault();
              openFile(filePath);
            };

            return (
              <a href={href} {...props} onClick={handleClick}>
                {children}
              </a>
            );
          },
          img({ src, alt, ...props }: { src?: string | Blob; alt?: string; node?: unknown }) {
            delete props.node;
            const srcString = typeof src === "string" ? src : undefined;
            const filePath = srcString ? resolveLocalFileHref(srcString, cwd) : null;
            const imageSrc = filePath
              ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
              : srcString;
            return (
              <PreviewableImage
                src={imageSrc ?? ""}
                alt={alt ?? ""}
                {...props}
              />
            );
          },
          table({ children }: { children?: ReactNode }) {
            return (
              <div className="markdown-table-wrap">
                <table>{children}</table>
              </div>
            );
          },
  }), [cwd, isStreaming, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      {oversized && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          {t("md.truncated")}
        </div>
      )}
      <MarkdownSegment text={stable} components={components} rehypePlugins={rehypePlugins} />
      {tail && <MarkdownSegment text={tail} components={components} rehypePlugins={rehypePlugins} />}
    </div>
  );
});

type MarkdownComponents = NonNullable<Parameters<typeof ReactMarkdown>[0]["components"]>;

const MarkdownSegment = memo(function MarkdownSegment({
  text,
  components,
  rehypePlugins,
}: {
  text: string;
  components: MarkdownComponents;
  rehypePlugins: MarkdownRehypePlugins;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={markdownRemarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});

// A blank-line boundary is only safe to split at when the content after it
// cannot continue a construct from before it: list items (loose lists share
// numbering/markers across blank lines), indented continuations, and tables.
const UNSAFE_BLOCK_START = /^(\s|[-*+]\s|\d+[.)]\s|\||\$\$)/;

interface StreamingSplit {
  stable: string;
  tail: string;
  /**
   * Body of the trailing unclosed fence, i.e. the code block the model is still
   * typing, or null when the document does not end inside a fence.
   */
  streamingCode: string | null;
}

/**
 * Split markdown at the last safe paragraph boundary outside code fences.
 * `stable` only changes when a new paragraph completes, so a memoized segment
 * rendering it is a cache hit on almost every streaming tick.
 */
function splitStreamingMarkdown(markdown: string): StreamingSplit {
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; size: number; line: number } | null = null;
  let splitLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const size = fenceMatch[1].length;
      if (!fence) fence = { marker, size, line: i };
      else if (marker === fence.marker && size >= fence.size) fence = null;
      continue;
    }
    if (fence || line.trim() !== "") continue;

    // Blank line outside a fence: safe iff the next non-blank line starts a
    // fresh top-level block.
    let next = i + 1;
    while (next < lines.length && lines[next].trim() === "") next++;
    if (next < lines.length && !UNSAFE_BLOCK_START.test(lines[next])) {
      splitLine = next;
    }
  }

  // An unclosed fence at EOF grows on every tick. Matching the string that
  // react-markdown hands to the `code` component (\r\n normalized, trailing
  // newline dropped) lets CodeBlock skip tokenizing it; on a mismatch we simply
  // fall back to highlighting.
  const streamingCode = fence
    ? lines.slice(fence.line + 1).join("\n").replace(/\n$/, "")
    : null;

  if (splitLine <= 0) return { stable: markdown, tail: "", streamingCode };
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  return {
    stable: lines.slice(0, splitLine).join(lineBreak),
    tail: lines.slice(splitLine).join(lineBreak),
    streamingCode,
  };
}


function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { t } = useLocale();
  const { isDark } = useTheme();
  const [showPreview, setShowPreview] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;

  useEffect(() => {
    if (!showPreview || isStreaming) return;

    let cancelled = false;
    setFailedKey(null);

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: isDark ? "dark" : "default",
      });

      const parsed = await mermaid.parse(code, { suppressErrors: true });
      if (!parsed) throw new Error(t("md.invalidMermaid"));

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await mermaid.render(id, code);
      if (!cancelled) {
        setSvg(result.svg);
        setRenderedKey(currentKey);
      }
    };

    render().catch(() => {
      if (!cancelled) setFailedKey(currentKey);
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, isStreaming, showPreview]);

  const previewButton = (
    <button
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={isStreaming ? "Preview available after streaming" : (showPreview ? "Show Mermaid source" : "Preview Mermaid diagram")}
      className={["markdown-code-action", showPreview ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {showPreview ? "Source" : "Preview"}
    </button>
  );

  if (!showPreview || isStreaming) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} />;
  }

  const body =
    failedKey === currentKey ? (
      <div className="mermaid-block mermaid-block-error">{t("md.invalidMermaid")}</div>
    ) : !svg || renderedKey !== currentKey ? (
      <div className="mermaid-block mermaid-block-loading" aria-label={t("md.renderingMermaid")} />
    ) : (
      <div
        className="mermaid-block"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">mermaid</span>
        {previewButton}
      </div>
      {body}
    </div>
  );
}

// Memoized so that during streaming, already-complete code blocks skip
// re-tokenizing on every markdown re-parse (props are primitive strings).
const CodeBlock = memo(function CodeBlock({
  code,
  lang,
  headerAction,
  plain,
}: {
  code: string;
  lang: string;
  headerAction?: ReactNode;
  /**
   * Block is still being streamed. Refractor would re-tokenize the whole
   * (growing) body on every tick, which is O(n^2) over a long code block.
   */
  plain?: boolean;
}) {
  const { isDark } = useTheme();
  const appearance = useAppearance();
  const [copied, setCopied] = useState(false);
  const themeStyle = getCodeThemeStyle(
    isDark ? appearance.codeThemeDark : appearance.codeThemeLight,
    isDark,
  );

  // Highlight budget (mirrors hermes desktop): past a hard size cap refractor
  // tokenization costs more than the colors are worth — render as plain text,
  // which keeps the identical <pre>/<code> tree (same trick as `plain`).
  const overBudget = code.length > 150_000 || code.split("\n").length > 3000;

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || "text"}</span>
        <div className="markdown-code-actions">
          {headerAction}
          <button
            onClick={copy}
            className="markdown-code-action"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        // "text" is react-syntax-highlighter's documented no-op language: it
        // skips the refractor pass but keeps the exact same <pre>/<code>/line
        // number tree and styles, so closing the fence only paints token colors
        // in — no font, padding, gutter or line-height shift.
        language={plain || overBudget ? "text" : (lang || "text")}
        style={themeStyle}
        showLineNumbers={appearance.showCodeLineNumbers}
        wrapLongLines={appearance.wrapCodeLines}
        lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal", fontSize: appearance.codeFontSize }}
        customStyle={{
          margin: 0,
          padding: "11px 13px",
          fontSize: appearance.codeFontSize,
          lineHeight: 1.62,
          borderRadius: 0,
          // Prism themes (e.g. vs) ship their own pre border + fill — strip them
          // so only the outer .markdown-code-block chrome remains.
          backgroundColor: "transparent",
          border: "none",
          boxShadow: "none",
          whiteSpace: appearance.wrapCodeLines ? "pre-wrap" : "pre",
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--font-mono)",
            backgroundColor: "transparent",
            fontSize: appearance.codeFontSize,
            whiteSpace: appearance.wrapCodeLines ? "pre-wrap" : "pre",
          },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
});
