"use client";

import { Fragment, useState, useEffect, useRef, type ReactNode } from "react";
import type { ExtensionUiRequest } from "@/lib/types";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import { useLocale } from "@/hooks/useLocale";

export type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;

/** Split jammed permission titles like "Permission Required Current agent..." into heading + body. */
export function splitExtensionCopy(title: string, message?: string): { heading: string; body: string } {
  const full = [title, message].filter((part) => Boolean(part && part.trim())).join("\n\n").trim();
  const headingMatch = full.match(/^(Permission Required|权限请求|需要权限|批准请求|Allow|Deny)([\s.:：-]*)/i);
  if (headingMatch) {
    const heading = headingMatch[1].replace(/\b\w/g, (c) => c.toUpperCase());
    const body = full.slice(headingMatch[0].length).trim();
    return { heading: heading || title, body: body || message || "" };
  }
  if (title.length > 72) {
    return { heading: `${title.slice(0, 48).trim()}…`, body: full };
  }
  return { heading: title, body: (message ?? "").trim() };
}

export function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  const rawMessage = request.method === "confirm" ? request.message : "";
  const isPermissionLike =
    /permission|allow|deny|policy|批准|权限|允许|拒绝|bash|tool|命令|工具/i.test(`${request.title}\n${rawMessage}`);
  const { heading, body } = splitExtensionCopy(request.title, rawMessage || undefined);
  const showBodyPanel = Boolean(body) || (request.method === "confirm" && Boolean(rawMessage));
  const bodyText = body || rawMessage;

  return (
    <div
      className="modal-backdrop modal-backdrop-local"
      style={{ position: "absolute", zIndex: 90, padding: 20 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="modal-shell"
        style={{
          width: isPermissionLike ? "min(640px, 100%)" : "min(520px, 100%)",
          maxHeight: "min(80vh, 720px)",
        }}
      >
        {/* Header — strip chrome */}
        <div className="modal-header" style={{ gap: 10, padding: "0 12px" }}>
          {isPermissionLike && (
            <span
              aria-hidden
              style={{
                width: 20,
                height: 20,
                borderRadius: "var(--radius-xs)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--border)",
                background: "var(--bg-subtle)",
                color: "var(--text-muted)",
                fontSize: 11,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              !
            </span>
          )}
          <div className="modal-title" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }} title={heading}>
            {heading}
          </div>
        </div>

        {/* Body */}
        <div className="modal-main" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {showBodyPanel && bodyText && (
            <div
              className={isPermissionLike ? "ext-dialog-code" : undefined}
              style={{
                color: "var(--text)",
                fontSize: isPermissionLike ? 12 : 13,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
                padding: isPermissionLike ? "10px 12px" : 0,
                borderRadius: isPermissionLike ? "var(--radius-xs)" : 0,
                background: isPermissionLike ? "var(--bg-panel)" : "transparent",
                border: isPermissionLike ? "1px solid var(--border)" : "none",
                fontFamily: isPermissionLike ? "var(--font-mono)" : "inherit",
                maxHeight: isPermissionLike ? "min(28vh, 220px)" : undefined,
                overflow: isPermissionLike ? "auto" : undefined,
              }}
            >
              {bodyText}
            </div>
          )}

          {request.method === "select" && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {request.options.map((option) => {
                const isDeny = /^(no|deny|拒绝|否)/i.test(option.trim());
                return (
                  <button
                    key={option}
                    type="button"
                    className={`modal-nav-item${isDeny ? " is-danger-text" : ""}`}
                    onClick={() => onRespond(request, { value: option })}
                    style={{
                      minHeight: 34,
                      borderBottom: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
                      color: isDeny ? "var(--destructive)" : undefined,
                    }}
                  >
                    <span className="modal-nav-label">{option}</span>
                  </button>
                );
              })}
            </div>
          )}

          {request.method === "input" && (
            <input
              autoFocus
              className="input-base"
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitValue();
                if (e.key === "Escape") onRespond(request, { cancelled: true });
              }}
            />
          )}

          {request.method === "editor" && (
            <textarea
              autoFocus
              className="input-base input-mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onRespond(request, { cancelled: true });
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitValue();
              }}
              style={{
                minHeight: 200,
                resize: "vertical",
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
        </div>

        {/* Footer strip */}
        <div className="modal-footer">
          <button
            type="button"
            className="chrome-btn"
            onClick={() => onRespond(request, { cancelled: true })}
          >
            {t("common.cancel")}
          </button>
          {request.method === "confirm" ? (
            <>
              {isPermissionLike && (
                <button
                  type="button"
                  className="chrome-btn is-danger"
                  onClick={() => onRespond(request, { confirmed: false })}
                >
                  {t("ext.deny")}
                </button>
              )}
              <button type="button" className="btn-primary" onClick={submitValue}>
                {isPermissionLike ? t("ext.allow") : t("window.confirm")}
              </button>
            </>
          ) : request.method !== "select" ? (
            <button type="button" className="btn-primary" onClick={submitValue}>
              {t("window.submit")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

export function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) => (
    Object.keys(segment.style).length > 0
      ? <span key={`${keyPrefix}-${index}`} style={segment.style}>{segment.text}</span>
      : segment.text
  ));
}

export function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const displayLines = normalizeCustomPanelLines(request.lines);

  useEffect(() => {
    inputRef.current?.focus();
  }, [request.id]);

  return (
    <div
      className="modal-backdrop modal-backdrop-local"
      style={{ position: "absolute", zIndex: 95, padding: 20 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="modal-shell"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        style={{
          position: "relative",
          width: "min(920px, 100%)",
          maxHeight: "min(760px, calc(100vh - 40px))",
          outline: "none",
        }}
      >
        <textarea
          ref={inputRef}
          aria-label={t("window.extensionInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        <div className="modal-header" style={{ padding: "0 10px 0 12px" }}>
          <span className="modal-title">{t("window.extensionPanel")}</span>
          <button
            type="button"
            className="chrome-btn"
            onClick={() => onInput(request, "\x03")}
          >
            {t("common.close")}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 12,
            maxHeight: "calc(min(760px, 100vh - 40px) - 40px)",
            overflow: "auto",
            background: "var(--bg)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}

