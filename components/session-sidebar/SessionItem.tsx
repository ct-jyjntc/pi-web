"use client";

/**
 * One session row in the sidebar list — click to open, ⋮ / right-click for actions.
 */
import { useCallback, useRef, useState, memo } from "react";
import {
  ChevronDown,
  EllipsisVertical,
  GitBranch,
} from "lucide-react";
import type { SessionInfo } from "@/lib/types";
import { copyText } from "@/lib/clipboard";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";
import { RunningSessionIndicator, UnreadSessionIndicator } from "./SessionIndicators";
import { SessionItemMenu, type SessionMenuAction } from "./SessionItemMenu";
import { apiFetch } from "@/lib/api-transport";
import { skillExpansionToCommand } from "@/lib/slash-display";

export const SessionItem = memo(function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  onDeleteSettled,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: (sessionId?: string, name?: string) => void;
  /** Optimistic start — parent removes the row and tracks pending id. */
  onDeleted?: (id: string) => void;
  /** After DELETE finishes — parent force-refreshes once (ok) or restores (fail). */
  onDeleteSettled?: (id: string, ok: boolean) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t } = useLocale();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const rawTitle = session.name || session.firstMessage || "";
  const compactTitle = skillExpansionToCommand(rawTitle) ?? rawTitle;
  const title = compactTitle.slice(0, 50) || session.id.slice(0, 12);
  const canGenerateTitle = session.messageCount > 0;

  const startRename = useCallback(() => {
    setMenuOpen(false);
    setRenameValue(session.name ?? "");
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await apiFetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.(session.id, name);
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const performDelete = useCallback(async () => {
    setMenuOpen(false);
    setDeleting(true);
    // Optimistic remove only — do NOT force-reload until DELETE finishes; mid-delete
    // disk scans re-insert the row (often at top by modified) until manual refresh.
    onDeleted?.(session.id);
    try {
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleteSettled?.(session.id, res.ok);
      if (!res.ok) setDeleting(false);
    } catch {
      onDeleteSettled?.(session.id, false);
      setDeleting(false);
    }
  }, [session.id, onDeleted, onDeleteSettled]);

  const handleGenerateTitle = useCallback(async () => {
    if (!canGenerateTitle || naming) return;
    setNaming(true);
    try {
      const response = await apiFetch(`/api/sessions/${encodeURIComponent(session.id)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const name = body.title.trim();
      setMenuOpen(false);
      onRenamed?.(session.id, name);
    } catch {
      // Keep menu open so the user can retry; no toast infrastructure here.
    } finally {
      setNaming(false);
    }
  }, [canGenerateTitle, naming, session.id, onRenamed]);

  const openMenuAt = useCallback((top: number, left: number) => {
    setMenuPos({ top, left });
    setMenuOpen(true);
  }, []);

  const openMenuFromButton = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const btn = menuBtnRef.current;
    if (!btn) {
      openMenuAt(e.clientY, e.clientX);
      return;
    }
    const rect = btn.getBoundingClientRect();
    const width = 196;
    let left = rect.right + 4;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, rect.left - width - 4);
    }
    openMenuAt(rect.top, left);
  }, [menuOpen, openMenuAt]);

  const openMenuFromContext = useCallback((e: React.MouseEvent) => {
    // Don't steal browser menu from interactive controls inside the row.
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, input, a, [role='menuitem']")) return;
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.clientY, e.clientX);
  }, [openMenuAt]);

  const handleMenuAction = useCallback((id: SessionMenuAction) => {
    switch (id) {
      case "rename":
        startRename();
        break;
      case "generateTitle":
        void handleGenerateTitle();
        break;
      case "copyTitle":
        setMenuOpen(false);
        void copyText(title);
        break;
      case "copyId":
        setMenuOpen(false);
        void copyText(session.id);
        break;
      case "copyPath":
        setMenuOpen(false);
        void copyText(session.path);
        break;
      case "copyCwd":
        setMenuOpen(false);
        void copyText(session.cwd);
        break;
      case "delete":
        void performDelete();
        break;
    }
  }, [startRename, handleGenerateTitle, title, session.id, session.path, session.cwd, performDelete]);

  // Fixed-height single-line row — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 32;
  // Indent under time-group labels; forks go one step further.
  const padLeft = depth > 0 ? 22 + depth * 12 : 22;

  return (
    <div
      className={`sidebar-session-item${isSelected ? " is-active" : ""}${hovered || menuOpen ? " is-hover" : ""}`}
      onClick={renaming ? undefined : onClick}
      onContextMenu={renaming ? undefined : openMenuFromContext}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: padLeft,
        paddingRight: 6,
        cursor: renaming ? "default" : "pointer",
        background: isSelected ? "var(--bg-selected)" : (hovered || menuOpen) ? "var(--bg-hover)" : "transparent",
        transition: "background 0.1s, color 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {renaming ? (
        <input
          ref={inputRef}
          className="input-base"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => { void commitRename(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            height: 28,
            padding: "0 8px",
            borderColor: "var(--accent)",
          }}
        />
      ) : (
        <>
          {depth > 0 && (
            <Icon icon={GitBranch} size={10} strokeWidth={1.8} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
          )}
          {isRunning ? (
            <RunningSessionIndicator />
          ) : isUnread ? (
            <UnreadSessionIndicator />
          ) : null}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: isSelected ? 600 : 400,
              lineHeight: 1.3,
              color: isSelected ? "var(--text)" : "var(--text-muted)",
            }}
            title={title}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              {title}
            </span>
            {session.worktreeBranch && (
              <span
                title={t("sidebar.worktree", { branch: session.worktreeBranch })}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  color: "var(--text-dim)",
                  fontSize: 11,
                  flexShrink: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  maxWidth: "40%",
                }}
              >
                <Icon icon={GitBranch} size={9} strokeWidth={2.4} style={{ flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.worktreeBranch}</span>
              </span>
            )}
          </div>

          {hasChildren && (
            <button
              className="icon-btn"
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={collapsed ? t("sidebar.expandForks") : t("sidebar.collapseForks")}
              style={{
                "--icon-btn-size": "20px",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 0.15s, background 0.15s, color 0.15s",
              } as React.CSSProperties}
            >
              <Icon icon={ChevronDown} size={10} strokeWidth={1.8} />
            </button>
          )}

          {(hovered || menuOpen) && (
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <button
                ref={menuBtnRef}
                type="button"
                className="icon-btn"
                onClick={openMenuFromButton}
                title={t("sidebar.moreActions")}
                aria-label={t("sidebar.moreActions")}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                style={{
                  ["--icon-btn-size" as string]: "22px",
                  color: menuOpen ? "var(--text)" : "var(--text-dim)",
                  background: menuOpen ? "var(--bg-hover)" : "transparent",
                  border: "none",
                  boxShadow: "none",
                }}
              >
                <Icon icon={EllipsisVertical} size={14} strokeWidth={2} />
              </button>
            </div>
          )}
        </>
      )}

      {menuOpen && menuPos && !renaming && (
        <SessionItemMenu
          x={menuPos.left}
          y={menuPos.top}
          canGenerateTitle={canGenerateTitle}
          naming={naming}
          onAction={handleMenuAction}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
});
