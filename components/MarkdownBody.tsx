"use client";

import { useLocale } from "@/hooks/useLocale";

import { useEffect, useMemo, useState, memo, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { getCodeThemeStyle, SyntaxHighlighter } from "@/lib/syntax-highlighter";
import { useTheme } from "@/hooks/useTheme";
import { useAppearance } from "@/lib/appearance-store";
import { copyText } from "@/lib/clipboard";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins } from "@/lib/markdown";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

export const MarkdownBody = memo(function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);

  // Stable components map — recreating this every render forces ReactMarkdown to
  // drop internal memoization and re-walk the whole AST on every token.
  const components = useMemo(() => ({
          code({ className, children, ...props }: { className?: string; children?: ReactNode; node?: unknown }) {
            const lang = className?.replace("language-", "").toLowerCase() ?? "";
            const raw = String(children);
            const isBlock = className?.includes("language-") || raw.includes("\n");
            if (isBlock) {
              if (lang === "mermaid") {
                return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
              }
              return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
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
              <MarkdownImage
                src={imageSrc}
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

  // While streaming, split the document at the last "safe" paragraph boundary
  // and render the stable prefix as a memoized segment. Each 100ms stream tick
  // then only re-runs the remark/rehype pipeline over the short tail being
  // typed, instead of the whole (growing) message.
  const { stable, tail } = useMemo(
    () => (isStreaming ? splitStreamingMarkdown(normalizedMarkdown) : { stable: normalizedMarkdown, tail: "" }),
    [isStreaming, normalizedMarkdown],
  );

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <MarkdownSegment text={stable} components={components} />
      {tail && <MarkdownSegment text={tail} components={components} />}
    </div>
  );
});

type MarkdownComponents = NonNullable<Parameters<typeof ReactMarkdown>[0]["components"]>;

const MarkdownSegment = memo(function MarkdownSegment({ text, components }: { text: string; components: MarkdownComponents }) {
  return (
    <ReactMarkdown
      remarkPlugins={markdownRemarkPlugins}
      rehypePlugins={markdownRehypePlugins}
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

/**
 * Split markdown at the last safe paragraph boundary outside code fences.
 * `stable` only changes when a new paragraph completes, so a memoized segment
 * rendering it is a cache hit on almost every streaming tick.
 */
function splitStreamingMarkdown(markdown: string): { stable: string; tail: string } {
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; size: number } | null = null;
  let splitLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const size = fenceMatch[1].length;
      if (!fence) fence = { marker, size };
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

  if (splitLine <= 0) return { stable: markdown, tail: "" };
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  return {
    stable: lines.slice(0, splitLine).join(lineBreak),
    tail: lines.slice(splitLine).join(lineBreak),
  };
}

function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; size: number } | null = null;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        const size = fenceMatch[1].length;
        if (!fence) fence = { marker, size };
        else if (marker === fence.marker && size >= fence.size) fence = null;
        return line;
      }

      if (fence) return line;

      const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
      if (!displayMathMatch) return line;

      const math = displayMathMatch[2].trim();
      if (!math) return line;

      return `${displayMathMatch[1]}$$${lineBreak}${math}${lineBreak}${displayMathMatch[1]}$$`;
    })
    .join(lineBreak);
}

function MarkdownImage({
  src,
  alt,
  ...props
}: {
  src?: string;
  alt?: string;
  [key: string]: unknown;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!src) return null;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        onClick={() => setOpen(true)}
        {...props}
      />
      {open && (
        <div
          className="markdown-image-preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={alt || "Image preview"}
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt ?? ""}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </>
  );
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
const CodeBlock = memo(function CodeBlock({ code, lang, headerAction }: { code: string; lang: string; headerAction?: ReactNode }) {
  const { isDark } = useTheme();
  const appearance = useAppearance();
  const [copied, setCopied] = useState(false);
  const themeStyle = getCodeThemeStyle(
    isDark ? appearance.codeThemeDark : appearance.codeThemeLight,
    isDark,
  );

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
        language={lang || "text"}
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
          backgroundColor: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
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
