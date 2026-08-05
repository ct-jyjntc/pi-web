"use client";
/**
 * Monaco code editor tab: read/edit a project file, save through the
 * allow-listed file API, with LSP hover/definition, diagnostics markers, and
 * git change-line gutters. Single owner for editor-side file mutation.
 */
import * as monaco from "monaco-editor";
import { Editor, loader } from "@monaco-editor/react";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RotateCw, Save, Sparkles } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { Icon } from "./Icon";
import type { editor } from "monaco-editor";
import { apiFetch } from "@/lib/api-transport";

// Static worker URLs (no template strings) so Vite/Rollup can resolve workers;
// Next/webpack also accept these relative import.meta.url forms.
if (typeof window !== "undefined") {
  (self as { MonacoEnvironment?: { getWorker: (moduleId: string, label: string) => Worker } }).MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
      if (label === "typescript" || label === "javascript") {
        return new Worker(
          new URL("../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
          { type: "module" },
        );
      }
      if (label === "json") {
        return new Worker(
          new URL("../node_modules/monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url),
          { type: "module" },
        );
      }
      if (label === "css" || label === "scss" || label === "less") {
        return new Worker(
          new URL("../node_modules/monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
          { type: "module" },
        );
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new Worker(
          new URL("../node_modules/monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
          { type: "module" },
        );
      }
      return new Worker(
        new URL("../node_modules/monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
        { type: "module" },
      );
    },
  };
  loader.config({ monaco });
}

/** Map pi-web file language ids to Monaco language ids. */
function monacoLanguageFor(language: string): string {
  const map: Record<string, string> = {
    typescript: "typescript",
    javascript: "javascript",
    python: "python",
    go: "go",
    rust: "rust",
    java: "java",
    json: "json",
    jsonl: "json",
    markdown: "markdown",
    html: "html",
    css: "css",
    bash: "shell",
    sql: "sql",
    yaml: "yaml",
    xml: "xml",
    csharp: "csharp",
    cpp: "cpp",
  };
  return map[language] ?? "plaintext";
}

interface Props {
  filePath: string;
  cwd?: string;
  initialContent: string;
  language: string;
  isDark: boolean;
  codeFontSize: number;
  wrapLines: boolean;
  /** Called after a successful save so the host can refresh preview/diff. */
  onSaved?: () => void;
}

type SaveStatus = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

export function FileEditor({ filePath, cwd, initialContent, language, isDark, codeFontSize, wrapLines, onSaved }: Props) {
  const { t } = useLocale();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<editor.ITextModel | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const fileApiUrl = encodeFilePathForApi(filePath);

  const applyDiagnostics = useCallback(async () => {
    const model = modelRef.current;
    if (!model || !cwd) return;
    try {
      const params = new URLSearchParams({ cwd, path: filePath });
      const res = await apiFetch(`/api/diagnostics?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json() as { items?: Array<{ line?: number; column?: number; severity?: string; message?: string; code?: string }> };
      const markers: editor.IMarkerData[] = (data.items ?? []).map((item) => ({
        severity:
          item.severity === "error"
            ? monaco.MarkerSeverity.Error
            : item.severity === "warning"
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
        startLineNumber: Math.max(1, Number(item.line) || 1),
        startColumn: Math.max(1, Number(item.column) || 1),
        endLineNumber: Math.max(1, Number(item.line) || 1),
        endColumn: Math.max(1, Number(item.column) || 1) + 1,
        message: `${item.code ? `[${item.code}] ` : ""}${item.message ?? ""}`.trim() || "Diagnostic",
      }));
      monaco.editor.setModelMarkers(model, "pi-web-diagnostics", markers);
    } catch {
      // Diagnostics are best-effort.
    }
  }, [cwd, filePath]);

  const save = useCallback(async () => {
    const model = modelRef.current;
    if (!model || !filePath) return;
    setStatus({ kind: "saving" });
    try {
      const res = await apiFetch(`/api/files/${fileApiUrl}?type=save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: model.getValue(), format: true }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; formatted?: boolean };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      model.setValue(model.getValue()); // normalize undo stack against disk state
      setStatus({ kind: "saved" });
      onSaved?.();
      void applyDiagnostics();
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [filePath, fileApiUrl, onSaved, applyDiagnostics]);

  const format = useCallback(async () => {
    const model = modelRef.current;
    if (!model || !filePath) return;
    try {
      const res = await apiFetch(`/api/files/${fileApiUrl}?type=format`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: model.getValue() }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; content?: string; error?: string };
      if (!res.ok || !data.ok || typeof data.content !== "string") {
        if (data.error) setStatus({ kind: "error", message: data.error });
        return;
      }
      const newText = data.content;
      const current = modelRef.current;
      if (!current) return;
      if (newText !== current.getValue()) {
        const selection = editorRef.current?.getSelection() ?? null;
        current.pushEditOperations([], [{ range: current.getFullModelRange(), text: newText }], () => (selection ? [selection] : null));
        setStatus({ kind: "saved" });
      } else {
        setStatus({ kind: "idle" });
      }
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [filePath, fileApiUrl]);

  // Editor mount: wire save keybind, LSP providers, git gutters, diagnostics.
  const handleMount = useCallback((editorInstance: editor.IStandaloneCodeEditor, monacoInstance: typeof monaco) => {
    editorRef.current = editorInstance;
    const model = editorInstance.getModel();
    if (model) modelRef.current = model;

    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      void save();
    });
    editorInstance.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyF,
      () => {
        void format();
      },
    );
    editorInstance.onDidChangeModelContent(() => {
      setStatus((prev) => (prev.kind === "saved" || prev.kind === "saving" ? prev : { kind: "idle" }));
    });

    if (!cwd) return;

    const languageId = monacoLanguageFor(language);
    const myUri = model?.uri.toString();

    // Hover: external LSP when available; silent no-op otherwise.
    monacoInstance.languages.registerHoverProvider(languageId, {
      provideHover: async (m, position) => {
        if (m.uri.toString() !== myUri) return null;
        try {
          const res = await apiFetch("/api/lsp/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cwd,
              path: filePath,
              action: "hover",
              line: position.lineNumber,
              character: position.column,
            }),
          });
          if (!res.ok) return null;
          const data = await res.json() as { hover?: string };
          if (!data.hover) return null;
          return {
            contents: [{ value: data.hover }],
            range: new monacoInstance.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          };
        } catch {
          return null;
        }
      },
    });

    // Definition: jump within the same file; cross-file opens via default provider.
    monacoInstance.languages.registerDefinitionProvider(languageId, {
      provideDefinition: async (m, position) => {
        if (m.uri.toString() !== myUri) return null;
        try {
          const res = await apiFetch("/api/lsp/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cwd,
              path: filePath,
              action: "definition",
              line: position.lineNumber,
              character: position.column,
            }),
          });
          if (!res.ok) return null;
          const data = await res.json() as {
            locations?: Array<{ path: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>;
          };
          if (!data.locations?.length) return null;
          return data.locations.map((loc) => ({
            uri: monacoInstance.Uri.file(loc.path),
            range: new monacoInstance.Range(
              loc.range.start.line + 1,
              loc.range.start.character + 1,
              loc.range.end.line + 1,
              loc.range.end.character + 1,
            ),
          }));
        } catch {
          return null;
        }
      },
    });

    // Git change-line gutters from the unified diff.
    void (async () => {
      const editorInstanceRef = editorInstance;
      try {
        const params = new URLSearchParams({ cwd, path: filePath });
        const res = await apiFetch(`/api/git/diff?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json() as { patch?: string };
        if (typeof data.patch !== "string" || !data.patch) return;
        const addedLines = new Set<number>();
        const modifiedLines = new Set<number>();
        let newLine = 0;
        const hunks = data.patch.split(/^@@[^@]*@@/m).slice(1);
        const headerMatches = [...data.patch.matchAll(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm)];
        for (let i = 0; i < hunks.length; i += 1) {
          const startNew = Number(headerMatches[i]?.[2] ?? 1) - 1;
          newLine = startNew;
          let removed = 0;
          const lines = hunks[i].split("\n");
          for (const raw of lines) {
            const prefix = raw[0];
            if (prefix === "+") {
              newLine += 1;
              if (removed > 0) {
                modifiedLines.add(newLine);
                removed -= 1;
              } else {
                addedLines.add(newLine);
              }
            } else if (prefix === "-") {
              removed += 1;
            } else if (prefix === " ") {
              newLine += 1;
            }
          }
        }
        const decorations = [
          ...[...addedLines].map((line) => ({
            range: new monacoInstance.Range(line, 1, line, 1),
            options: {
              isWholeLine: true,
              linesDecorationsClassName: "file-editor-gutter-added",
              className: "file-editor-line-added",
            },
          })),
          ...[...modifiedLines].map((line) => ({
            range: new monacoInstance.Range(line, 1, line, 1),
            options: {
              isWholeLine: true,
              linesDecorationsClassName: "file-editor-gutter-modified",
              className: "file-editor-line-modified",
            },
          })),
        ];
        if (decorations.length > 0) {
          const decorationCollection = editorInstanceRef.createDecorationsCollection();
          decorationCollection.set(decorations);
        }
      } catch {
        // Git gutter is best-effort.
      }
    })();

    void applyDiagnostics();
  }, [cwd, filePath, language, save, format, applyDiagnostics]);

  // Re-run diagnostics when the file changes on disk while not dirty.
  useEffect(() => {
    if (!cwd) return;
    const timer = setInterval(() => {
      if (status.kind !== "idle" && status.kind !== "saved") return;
      void applyDiagnostics();
    }, 8000);
    return () => clearInterval(timer);
  }, [cwd, status.kind, applyDiagnostics]);

  useEffect(() => () => {
    // Clear markers owned by this editor when the tab unmounts.
    const model = modelRef.current;
    if (model && !model.isDisposed()) {
      monaco.editor.setModelMarkers(model, "pi-web-diagnostics", []);
    }
  }, []);

  const statusLabel = status.kind === "saving"
    ? t("common.saving")
    : status.kind === "saved"
      ? t("common.saved")
      : status.kind === "error"
        ? status.message
        : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg-panel)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          className="chrome-btn"
          onClick={() => void save()}
          disabled={status.kind === "saving"}
          title="Save (⌘S)"
          style={{ height: 22, minHeight: 22, padding: "0 8px", fontSize: 11 }}
        >
          <Icon icon={Save} size={12} strokeWidth={2} />
          {t("common.save")}
        </button>
        <button
          type="button"
          className="chrome-btn"
          onClick={() => void format()}
          title="Format with project formatter (⌘⇧F)"
          style={{ height: 22, minHeight: 22, padding: "0 8px", fontSize: 11 }}
        >
          <Icon icon={Sparkles} size={12} strokeWidth={2} />
          {t("editor.format")}
        </button>
        {statusLabel && (
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 5,
              color: status.kind === "error" ? "var(--destructive)" : status.kind === "saved" ? "var(--success)" : "var(--text-dim)",
              maxWidth: "40%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {status.kind === "saved" ? <Icon icon={Check} size={11} strokeWidth={2.4} /> : status.kind === "saving" ? <Icon icon={RotateCw} size={11} strokeWidth={2} /> : null}
            {statusLabel}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          defaultLanguage={monacoLanguageFor(language)}
          defaultValue={initialContent}
          theme={isDark ? "vs-dark" : "vs"}
          loading={t("common.loading")}
          onMount={handleMount}
          options={{
            fontSize: codeFontSize,
            fontFamily: "var(--font-mono)",
            minimap: { enabled: false },
            wordWrap: wrapLines ? "on" : "off",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            renderLineHighlight: "gutter",
            smoothScrolling: true,
            padding: { top: 8, bottom: 8 },
            glyphMargin: true,
            guides: { indentation: true },
          }}
        />
      </div>
    </div>
  );
}
