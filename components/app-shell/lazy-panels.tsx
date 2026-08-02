"use client";

/**
 * Dynamic imports for heavy workspace panels. SessionSidebar stays eager.
 */
import dynamic from "next/dynamic";
import type { CSSProperties } from "react";

const LAZY_PANEL_FALLBACK_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  height: "100%",
  background: "var(--bg)",
};

/** Fills exactly the box the real panel will occupy, so no layout shift. */
function LazyPanelFallback() {
  return <div style={LAZY_PANEL_FALLBACK_STYLE} aria-hidden />;
}

export const ChatWindow = dynamic(() => import("../ChatWindow").then((m) => m.ChatWindow), {
  ssr: false,
  loading: LazyPanelFallback,
});

export const FileViewer = dynamic(() => import("../FileViewer").then((m) => m.FileViewer), {
  ssr: false,
  loading: LazyPanelFallback,
});

export const GitPanel = dynamic(() => import("../GitPanel").then((m) => m.GitPanel), {
  ssr: false,
  loading: LazyPanelFallback,
});

export const DebugPanel = dynamic(() => import("../DebugPanel").then((m) => m.DebugPanel), {
  ssr: false,
  loading: LazyPanelFallback,
});

export const ContextPanel = dynamic(() => import("../ContextPanel").then((m) => m.ContextPanel), {
  ssr: false,
  loading: LazyPanelFallback,
});

export const TerminalPanel = dynamic(() => import("../TerminalPanel").then((m) => m.TerminalPanel), {
  ssr: false,
  loading: LazyPanelFallback,
});

export const SettingsPage = dynamic(() => import("../SettingsPage").then((m) => m.SettingsPage), {
  ssr: false,
  // Blank fallback: AppShell warm-mounts SettingsPage hidden on idle, so a
  // visible white/blank overlay while the chunk loads would be wrong — with a
  // cold chunk the page simply appears a beat late instead of flashing.
  loading: () => null,
});
