"use client";

import { useCallback, useEffect, useRef, useState, memo } from "react";
import {
  ChevronDown,
  EllipsisVertical,
  GitBranch,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { SessionInfo } from "@/lib/types";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";
import { RunningSessionIndicator, UnreadSessionIndicator } from "./SessionIndicators";

export const SessionItem = memo(function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
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
  onDeleted?: (id: string) => void;
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
  const menuRef = useRef<HTMLDivElement>(null);

  const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);
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
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
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
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDeleted]);

  const handleGenerateTitle = useCallback(async () => {
    if (!canGenerateTitle || naming) return;
    setNaming(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/auto-name`, {
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

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const btn = menuBtnRef.current;
    if (!btn) {
      setMenuOpen((v) => !v);
      return;
    }
    const rect = btn.getBoundingClientRect();
    // Open to the right of the ⋯ button (more natural for a trailing control).
    const width = 168;
    const height = 120;
    let left = rect.right + 4;
    if (left + width > window.innerWidth - 8) {
      // Not enough room on the right — flip to the left of the button.
      left = Math.max(8, rect.left - width - 4);
    }
    let top = rect.top;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - height - 8);
    }
    setMenuPos({ top, left });
    setMenuOpen((v) => !v);
  }, []);

  // Close the ⋯ menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || menuBtnRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Fixed-height single-line row — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 32;
  // Indent under time-group labels; forks go one step further.
  const padLeft = depth > 0 ? 22 + depth * 12 : 22;

  return (
    <div
      className={`sidebar-session-item${isSelected ? " is-active" : ""}${hovered ? " is-hover" : ""}`}
      onClick={renaming ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: padLeft,
        paddingRight: 6,
        cursor: renaming ? "default" : "pointer",
        background: isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        transition: "background 0.1s, color 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          className="input-base"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
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
        /* ── Normal view: single-line title row ── */
        <>
          {/* Fork indicator for child sessions */}
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

          {/* Collapse toggle — always visible when has children */}
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

          {/* ⋮ icon-only menu — rename / generate title / delete */}
          {(hovered || menuOpen) && (
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0, position: "relative" }}>
              <button
                ref={menuBtnRef}
                type="button"
                className="icon-btn"
                onClick={openMenu}
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
              {menuOpen && menuPos && (
                <div
                  ref={menuRef}
                  className="menu-card"
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "fixed",
                    top: menuPos.top,
                    left: menuPos.left,
                    width: 168,
                    zIndex: 80,
                    padding: 4,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="sidebar-menu-item"
                    onClick={startRename}
                  >
                    <Icon icon={Pencil} size={13} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                    {t("common.rename")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="sidebar-menu-item"
                    disabled={!canGenerateTitle || naming}
                    onClick={() => void handleGenerateTitle()}
                    title={
                      !canGenerateTitle
                        ? t("shell.titleNeedMessage")
                        : t("shell.titleGenerate")
                    }
                  >
                    {naming ? (
                      <Icon icon={Loader2} size={13} strokeWidth={2} className="animate-spin" style={{ flexShrink: 0 }} />
                    ) : (
                      <Icon icon={Sparkles} size={13} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                    )}
                    {naming ? t("shell.generating") : t("shell.generateTitle")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="sidebar-menu-item"
                    onClick={() => void performDelete()}
                    style={{ color: "var(--destructive)" }}
                  >
                    <Icon icon={Trash2} size={13} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                    {t("common.delete")}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});

