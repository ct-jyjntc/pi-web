 "use client";
 
 import { Fragment, useState, useEffect, useRef, type ReactNode } from "react";
 import { createPortal } from "react-dom";
 import type { ExtensionUiRequest } from "@/lib/types";
 import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
 import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
 import { formatPermissionPreview } from "@/lib/permission-preview";
 import { useLocale } from "@/hooks/useLocale";
 import { CenteredDialog } from "../CenteredDialog";
 
 export type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
 
 /** Split jammed permission titles like "Permission Required Current agent..." into heading + body. */
 export function splitExtensionCopy(title: string, message?: string): { heading: string; body: string } {
   const full = [title, message].filter((part) => Boolean(part && part.trim())).join("\n\n").trim();
   const headingMatch = full.match(/^(Permission Required|权限请求|需要权限|批准请求|Allow|Deny)(?:\s+([a-zA-Z][\w-]+))?(?:[?!.：:\s-]*)/i);
   if (headingMatch) {
     const verb = headingMatch[1]!.replace(/\b\w/g, (c) => c.toUpperCase());
     const tool = headingMatch[2];
     const heading = tool ? `${verb} ${tool}` : verb;
     const body = full.slice(headingMatch[0].length).trim();
     return { heading: heading || title, body: body || message || "" };
   }
  if (title.length > 72) {
    const chip = /^\[([^\]]{1,16})\]\s*/.exec(title);
    return {
      heading: chip?.[1] ?? `${title.slice(0, 48).trim()}…`,
      body: `${chip ? title.slice(chip[0].length) : title}${message ? `\n\n${message}` : ""}`.trim(),
    };
  }
  return { heading: title, body: (message ?? "").trim() };
}
 
export function ExtensionDialog({
  request,
  onRespond,
  onAbort,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
  onAbort?: () => void;
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
     /permission|allow|deny|policy|批准|权限|允许|拒绝|bash|tool|命令|工具/i.test(`${request.title}\n${rawMessage}`)
     || request.method === "select";
   const split = splitExtensionCopy(request.title, rawMessage || undefined);
   const preview = formatPermissionPreview(split.body || rawMessage || request.title);
   const heading = preview.title && /^allow$/i.test(split.heading)
     ? `Allow ${preview.title}`
     : split.heading;
   const bodyLines = preview.lines.length > 0 ? preview.lines : (split.body ? [split.body] : []);
 
   return (
    <CenteredDialog
      width={isPermissionLike ? 440 : 380}
      label={heading}
      onClose={() => onRespond(request, { cancelled: true })}
    >
      <div className="ext-dialog-scroll">
        <div style={{ padding: "14px 14px 8px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}>
            {heading}
          </div>
          {bodyLines.length > 0 ? (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {bodyLines.map((line) => (
                <div
                  key={line.slice(0, 48)}
                  style={{
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: "var(--text-muted)",
                    overflowWrap: "anywhere",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {request.method === "select" && (
          <>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div style={{ padding: 4 }}>
              {request.options.map((option) => {
                const isDeny = /^(no|deny|拒绝|否)/i.test(option.trim());
                return (
                  <button
                    key={option}
                    type="button"
                    className="menu-row ext-dialog-option"
                    onClick={() => onRespond(request, { value: option })}
                    style={isDeny ? { color: "var(--destructive)" } : undefined}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {request.method === "input" && (
          <div style={{ padding: "0 14px 10px" }}>
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
          </div>
        )}

        {request.method === "editor" && (
          <div style={{ padding: "0 14px 10px" }}>
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
                minHeight: 160,
                resize: "vertical",
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>
        )}
      </div>

      <div className="ext-dialog-footer">
        <div style={{ height: 1, background: "var(--border)" }} />
        <div style={{ padding: 4 }}>
          {request.method === "confirm" ? (
            <>
              <button type="button" className="menu-row" onClick={submitValue}>
                {isPermissionLike ? t("ext.allow") : t("window.confirm")}
              </button>
              {isPermissionLike && (
                <button
                  type="button"
                  className="menu-row"
                  onClick={() => onRespond(request, { confirmed: false })}
                  style={{ color: "var(--destructive)" }}
                >
                  {t("ext.deny")}
                </button>
              )}
            </>
          ) : request.method !== "select" ? (
            <button type="button" className="menu-row" onClick={submitValue}>
              {t("window.submit")}
            </button>
          ) : null}
          <button
            type="button"
            className="menu-row"
            onClick={() => onRespond(request, { cancelled: true })}
          >
            {t("common.cancel")}
          </button>
          {onAbort && (
            <button
              type="button"
              className="menu-row"
              onClick={onAbort}
              style={{ color: "var(--destructive)" }}
            >
              {t("chat.stopAgent")}
            </button>
          )}
        </div>
      </div>
    </CenteredDialog>
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

   if (typeof document === "undefined") return null;
   return createPortal(
     <div
       className="modal-backdrop"
       style={{ zIndex: 95 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="menu-card"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        style={{
          position: "relative",
          width: "min(720px, 100%)",
          maxHeight: "min(720px, calc(100vh - 40px))",
          outline: "none",
          borderRadius: "var(--radius-md)",
          padding: 0,
          overflow: "hidden",
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
        <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, letterSpacing: "-0.02em" }}>
            {t("window.extensionPanel")}
          </span>
          <button type="button" className="menu-row" style={{ width: "auto" }} onClick={() => onInput(request, "\x03")}>
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
     </div>,
     document.body,
   );
}
