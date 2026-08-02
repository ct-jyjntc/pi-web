"use client";

 
/* Prefs/report shapes are owned by SettingsPage; keep panel props loose. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useLocale } from "@/hooks/useLocale";
import { SettingsToggle } from "../SettingsToggle";
import { CODE_THEME_OPTIONS, getCodeThemeStyle, SyntaxHighlighter } from "@/lib/syntax-highlighter";
import { setAppearanceSnapshot } from "@/lib/appearance-store";
import type { CodeThemeId, ThemeMode } from "@/lib/web-settings";
import {
  SegmentedOption,
  SettingsRow,
  sectionTitle,
} from "./settings-ui";

export type AppearanceSettingsPanelProps = {
  themeMode: ThemeMode | undefined;
  setThemeMode: (mode: ThemeMode, origin?: { x: number; y: number }) => void;
  isDark: boolean;
  isMobile: boolean;
  appearance: any;
  patchPref: (patch: Record<string, unknown>) => void | Promise<void>;
};

export function AppearanceSettingsPanel({
  themeMode,
  setThemeMode,
  isDark,
  isMobile,
  appearance,
  patchPref,
}: AppearanceSettingsPanelProps) {
  const { t } = useLocale();
  const previewCode = `const themePreview = {
  surface: "sidebar",
  accent: "#339CFF",
  contrast: 45,
};`;
  return (
    <div className="settings-page-general">
      {sectionTitle(t("settings.appearanceUi"))}

      <SettingsRow
        title={t("settings.themeMode")}
        description={t("settings.themeModeDesc")}
        action={
          <div className="settings-segmented" style={{ minWidth: 220 }}>
            {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
              <SegmentedOption
                key={mode}
                active={(themeMode || appearance.themeMode) === mode}
                label={
                  mode === "light"
                    ? t("settings.themeLight")
                    : mode === "dark"
                      ? t("settings.themeDark")
                      : t("settings.themeSystem")
                }
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setThemeMode(mode, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                  void patchPref({ themeMode: mode });
                }}
              />
            ))}
          </div>
        }
      />

      <SettingsRow
        title={t("settings.uiFontSize")}
        description={t("settings.uiFontSizeDesc")}
        action={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              className="input-base input-mono"
              type="number"
              min={12}
              max={18}
              step={1}
              value={appearance.uiFontSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                const clamped = Math.min(18, Math.max(12, Math.round(n)));
                setAppearanceSnapshot({ uiFontSize: clamped });
                void patchPref({ uiFontSize: clamped });
              }}
              style={{ width: 72, textAlign: "right" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>px</span>
          </div>
        }
      />

      {sectionTitle(t("settings.appearanceCode"))}

      <SettingsRow
        stacked
        title={t("settings.codeThemeLight")}
        description={t("settings.codeThemeLightDesc")}
        action={
          <select
            className="input-base"
            value={appearance.codeThemeLight}
            onChange={(e) => void patchPref({ codeThemeLight: e.target.value as CodeThemeId })}
            style={{ width: "100%", maxWidth: 320 }}
          >
            {CODE_THEME_OPTIONS.filter((o) => o.mode === "light").map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        }
      />
      <SettingsRow
        stacked
        title={t("settings.codeThemeDark")}
        description={t("settings.codeThemeDarkDesc")}
        action={
          <select
            className="input-base"
            value={appearance.codeThemeDark}
            onChange={(e) => void patchPref({ codeThemeDark: e.target.value as CodeThemeId })}
            style={{ width: "100%", maxWidth: 320 }}
          >
            {CODE_THEME_OPTIONS.filter((o) => o.mode === "dark").map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        }
      />
      <SettingsRow
        title={t("settings.showLineNumbers")}
        description={t("settings.showLineNumbersDesc")}
        action={
          <SettingsToggle
            enabled={appearance.showCodeLineNumbers}
            onChange={(next) => void patchPref({ showCodeLineNumbers: next })}
          />
        }
      />
      <SettingsRow
        title={t("settings.wrapCodeLines")}
        description={t("settings.wrapCodeLinesDesc")}
        action={
          <SettingsToggle
            enabled={appearance.wrapCodeLines}
            onChange={(next) => void patchPref({ wrapCodeLines: next })}
          />
        }
      />
      <SettingsRow
        title={t("settings.codeFontSize")}
        description={t("settings.codeFontSizeDesc")}
        action={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              className="input-base input-mono"
              type="number"
              min={10}
              max={18}
              step={0.5}
              value={appearance.codeFontSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                const clamped = Math.min(18, Math.max(10, Math.round(n * 2) / 2));
                setAppearanceSnapshot({ codeFontSize: clamped });
                void patchPref({ codeFontSize: clamped });
              }}
              style={{ width: 72, textAlign: "right" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>px</span>
          </div>
        }
      />

      {sectionTitle(t("settings.codePreview"))}
      <div className="settings-row-desc" style={{ marginBottom: 10 }}>
        {t("settings.codePreviewDesc")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        {([
          {
            id: appearance.codeThemeLight,
            label: t("settings.previewLight"),
            dark: false,
          },
          {
            id: appearance.codeThemeDark,
            label: t("settings.previewDark"),
            dark: true,
            // Fixed light/dark preview chrome comes from .code-preview in globals.css.
          },
        ] as const).map((preview) => {
          const active = isDark === preview.dark;
          const themeStyle = getCodeThemeStyle(preview.id, preview.dark);
          const themeBg =
            (themeStyle["pre[class*=\"language-\"]"] as { backgroundColor?: string } | undefined)?.backgroundColor
            || (themeStyle.pre as { backgroundColor?: string } | undefined)?.backgroundColor
            || "var(--preview-code-bg)";
          return (
            <div
              key={String(preview.dark)}
              className={`code-preview ${preview.dark ? "is-dark" : "is-light"}`}
              style={{
                border: "1px solid var(--preview-chrome-border)",
                borderRadius: "var(--radius-sm)",
                background: "var(--preview-chrome-bg)",
                overflow: "hidden",
              }}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "8px 10px",
                borderBottom: "1px solid var(--preview-chrome-border)",
                fontSize: 11,
                color: "var(--preview-chrome-fg)",
                background: "var(--preview-chrome-bg)",
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: "var(--preview-title-fg)" }}>{preview.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                    {CODE_THEME_OPTIONS.find((o) => o.id === preview.id)?.label}
                  </span>
                </div>
                <span style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  {active && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        lineHeight: "18px",
                        height: 18,
                        padding: "0 7px",
                        borderRadius: "var(--radius-xs)",
                        border: "1px solid var(--preview-chrome-border)",
                        color: "var(--preview-title-fg)",
                        background: "var(--preview-active-bg)",
                      }}
                    >
                      {t("settings.previewActive")}
                    </span>
                  )}
                  {!active && (
                    <span
                      style={{
                        fontSize: 10,
                        lineHeight: "18px",
                        height: 18,
                        padding: "0 7px",
                        borderRadius: "var(--radius-xs)",
                        border: "1px solid var(--preview-chrome-border)",
                        color: "var(--preview-chrome-fg)",
                      }}
                    >
                      {preview.dark ? t("settings.themeDark") : t("settings.themeLight")}
                    </span>
                  )}
                </span>
              </div>
              <div style={{ padding: 10, background: themeBg }}>
                <SyntaxHighlighter
                  language="typescript"
                  style={themeStyle}
                  showLineNumbers={appearance.showCodeLineNumbers}
                  wrapLongLines={appearance.wrapCodeLines}
                  customStyle={{
                    margin: 0,
                    padding: "10px 12px",
                    fontSize: appearance.codeFontSize,
                    backgroundColor: themeBg,
                    borderRadius: "var(--radius-xs)",
                  }}
                  codeTagProps={{
                    style: {
                      fontFamily: "var(--font-mono)",
                      fontSize: appearance.codeFontSize,
                      backgroundColor: "transparent",
                    },
                  }}
                >
                  {previewCode}
                </SyntaxHighlighter>
              </div>
            </div>
          );
        })}
      </div>
    </div>

  );
}
