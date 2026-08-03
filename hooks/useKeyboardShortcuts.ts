"use client";

import { useEffect } from "react";
import { hasPrimaryMod, isEditableKeyboardTarget } from "@/lib/keyboard";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

export type WorkspaceShortcutTab = "review" | "files" | "context" | "terminal" | "debug";

export interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl+Alt+N / ⌘⇧N is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
  onToggleRightPanel?: () => void;
  onOpenShortcutsHelp?: () => void;
  onFocusComposer?: () => void;
  onWorkspaceTab?: (tab: WorkspaceShortcutTab) => void;
  /** When true, Esc closes help/settings instead of aborting (parent owns). */
  suppressEscAbort?: boolean;
}

/**
 * Global keyboard shortcuts for the application shell.
 *
 *   Esc            – stop running agent (not inside inputs; dialogs handle own Esc)
 *   ⌘/Ctrl+B       – toggle left sidebar
 *   ⌘/Ctrl+,       – settings
 *   ⌘/Ctrl+\       – toggle right workspace panel
 *   ⌘/Ctrl+L       – focus composer
 *   ⌘/Ctrl+/       – shortcuts help
 *   ⌘/Ctrl+⇧N      – new session (also Ctrl+Alt+N)
 *   ⌘/Ctrl+1..4    – Review / Files / Context / Terminal workspace tabs
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const {
    onNewSession,
    activeCwd,
    onToggleSidebar,
    onOpenSettings,
    onToggleRightPanel,
    onOpenShortcutsHelp,
    onFocusComposer,
    onWorkspaceTab,
    suppressEscAbort,
  } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const primary = hasPrimaryMod(e);
      const editable = isEditableKeyboardTarget(e.target);

      // ---- Esc: stop agent (inputs / dialogs handle their own) ----
      if (key === "Escape") {
        if (suppressEscAbort) return;
        if (!globalAbortHandler) return;
        if (editable) return;
        e.preventDefault();
        globalAbortHandler();
        return;
      }

      // Always-available primary-mod shortcuts (even while typing).
      if (primary && !e.altKey) {
        // Shortcuts help
        if (key === "/" || key === "?") {
          if (!onOpenShortcutsHelp) return;
          e.preventDefault();
          onOpenShortcutsHelp();
          return;
        }
        // Settings (comma)
        if (key === "," && !e.shiftKey) {
          if (!onOpenSettings) return;
          e.preventDefault();
          onOpenSettings();
          return;
        }
      }

      // Remaining primary-mod shortcuts: skip when typing in a field
      // (except we already handled K , / above).
      if (editable && primary) {
        // Still allow focus-composer only when not already in composer? skip.
        return;
      }

      if (primary && !e.altKey) {
        if (key === "b" && !e.shiftKey) {
          if (!onToggleSidebar) return;
          e.preventDefault();
          onToggleSidebar();
          return;
        }
        if (key === "\\" && !e.shiftKey) {
          if (!onToggleRightPanel) return;
          e.preventDefault();
          onToggleRightPanel();
          return;
        }
        if (key === "l" && !e.shiftKey) {
          if (!onFocusComposer) return;
          e.preventDefault();
          onFocusComposer();
          return;
        }
        if (e.shiftKey && key === "n") {
          if (!activeCwd || !onNewSession) return;
          e.preventDefault();
          onNewSession(activeCwd);
          return;
        }
        // Workspace tabs 1–4
        if (!e.shiftKey && onWorkspaceTab) {
          if (key === "1") { e.preventDefault(); onWorkspaceTab("review"); return; }
          if (key === "2") { e.preventDefault(); onWorkspaceTab("files"); return; }
          if (key === "3") { e.preventDefault(); onWorkspaceTab("context"); return; }
          if (key === "4") { e.preventDefault(); onWorkspaceTab("terminal"); return; }
        }
      }

      // ---- Ctrl+Alt+N: new session (legacy) ----
      if (key === "n" && e.ctrlKey && e.altKey) {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeCwd,
    onNewSession,
    onToggleSidebar,
    onOpenSettings,
    onToggleRightPanel,
    onOpenShortcutsHelp,
    onFocusComposer,
    onWorkspaceTab,
    suppressEscAbort,
  ]);
}
