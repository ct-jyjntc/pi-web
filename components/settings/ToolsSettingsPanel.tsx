"use client";

import type { Dispatch, SetStateAction } from "react";
import { useLocale } from "@/hooks/useLocale";
import { sectionTitle, type LspServerRow } from "./settings-ui";

export type ToolsSettingsPanelProps = {
  lspServers: LspServerRow[] | null;
  lspMeta: { availableCount: number; total: number; builtinNote?: string } | null;
  lspLoading: boolean;
  lspError: string | null;
  lspCopiedId: string | null;
  loadLspHealth: () => void | Promise<void>;
  setLspCopiedId: Dispatch<SetStateAction<string | null>>;
};

export function ToolsSettingsPanel({
  lspServers,
  lspMeta,
  lspLoading,
  lspError,
  lspCopiedId,
  loadLspHealth,
  setLspCopiedId,
}: ToolsSettingsPanelProps) {
  const { t } = useLocale();
  return (
    <div className="settings-page-general">
      {sectionTitle(t("settings.lsp"))}
      <div className="settings-row-desc" style={{ marginBottom: 12 }}>
        {t("settings.lspDesc")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {lspMeta
            ? t("settings.lspAvailable", { count: lspMeta.availableCount, total: lspMeta.total })
            : lspLoading
              ? "…"
              : "—"}
        </span>
        <button type="button" className="btn-ghost btn-compact" disabled={lspLoading} onClick={() => void loadLspHealth()}>
          {t("settings.lspRefresh")}
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
        {t("settings.lspBuiltin")}
      </div>
      {lspError && (
        <div style={{ color: "var(--destructive)", fontSize: 12, marginBottom: 12 }}>{lspError}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(lspServers ?? []).map((s) => (
          <div
            key={s.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "10px 12px",
              background: "var(--bg-panel)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "var(--radius-pill)",
                  background: s.available ? "var(--success)" : "var(--text-dim)",
                  flexShrink: 0,
                }}
              />
              <strong style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</strong>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>{s.id}</span>
              {!s.available && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("settings.lspMissing")}</span>
              )}
            </div>
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginTop: 6, wordBreak: "break-all" }}>
              {s.available ? (s.resolvedPath ?? s.command) : s.command}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
              {s.languages.join(", ")}
            </div>
            {!s.available && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <code
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      background: "var(--bg-subtle)",
                      padding: "4px 8px",
                      borderRadius: "var(--radius-xs)",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      maxWidth: "100%",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {s.install}
                  </code>
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    onClick={async () => {
                      // Always copy the platform-resolved primary command (never force brew on Windows).
                      const text = s.install;
                      try {
                        await navigator.clipboard.writeText(text);
                        setLspCopiedId(s.id);
                        window.setTimeout(() => setLspCopiedId((id) => (id === s.id ? null : id)), 1500);
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    {lspCopiedId === s.id ? t("settings.lspCopied") : t("settings.lspCopyInstall")}
                  </button>
                </div>
                {s.installTip && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
                    {s.installTip}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {!lspLoading && lspServers && lspServers.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>—</div>
        )}
      </div>
    </div>

  );
}
