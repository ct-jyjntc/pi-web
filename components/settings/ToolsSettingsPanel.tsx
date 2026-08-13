/**
 * Settings → Tools. One card per LSP server; install command stays a code row.
 */
"use client";

import type { Dispatch, SetStateAction } from "react";
import { useLocale } from "@/hooks/useLocale";
import { SettingsGroup, SettingsPageHeading, SettingsRow } from "./settings-ui";
import type { LspServerRow } from "./settings-ui";

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
  const countLabel = lspMeta
    ? t("settings.lspAvailable", { count: lspMeta.availableCount, total: lspMeta.total })
    : lspLoading
      ? t("common.loading")
      : "—";

  return (
    <div className="settings-page-general">
      <SettingsPageHeading
        title={t("settings.lsp")}
        description={t("settings.lspDesc")}
        action={
          <button type="button" className="btn-ghost btn-compact" disabled={lspLoading} onClick={() => void loadLspHealth()}>
            {t("settings.lspRefresh")}
          </button>
        }
      />

      <SettingsGroup title={countLabel}>
        {lspError && (
          <div className="settings-card-empty" style={{ color: "var(--destructive)" }}>{lspError}</div>
        )}
        {(lspServers ?? []).map((s) => (
          <SettingsRow
            key={s.id}
            stacked={!s.available}
            title={s.label}
            description={(
              <div className="settings-lsp-meta">
                <div className="settings-lsp-path">
                  {s.available ? (s.resolvedPath ?? s.command) : s.command}
                </div>
                {s.languages.length > 0 && (
                  <div>{s.languages.join(", ")}</div>
                )}
                {!s.available && (
                  <div className="settings-lsp-missing">{t("settings.lspMissing")}</div>
                )}
                {!s.available && (
                  <code className="settings-lsp-install">{s.install}</code>
                )}
                {!s.available && s.installTip && (
                  <div className="settings-lsp-tip">{s.installTip}</div>
                )}
              </div>
            )}
            action={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  className={`settings-status-dot${s.available ? " is-ok" : ""}`}
                  title={s.available ? s.id : t("settings.lspMissing")}
                />
                {!s.available && (
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(s.install);
                        setLspCopiedId(s.id);
                        window.setTimeout(() => setLspCopiedId((id) => (id === s.id ? null : id)), 1500);
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    {lspCopiedId === s.id ? t("settings.lspCopied") : t("settings.lspCopyInstall")}
                  </button>
                )}
              </div>
            }
          />
        ))}
        {!lspLoading && lspServers && lspServers.length === 0 && (
          <div className="settings-card-empty">—</div>
        )}
        <div className="settings-card-empty">
          {t("settings.lspBuiltin")}
        </div>
      </SettingsGroup>
    </div>
  );
}
