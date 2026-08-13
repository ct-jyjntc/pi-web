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
  SettingsGroup,
  SettingsPageHeading,
  SettingsRow,
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
  const previewCode = `export function greet(name: string) {
  return \`hello, \${name}\`;
}`;
  return (
    <div className="settings-page-general">
      <SettingsPageHeading title={t("settings.appearance")} />
      <SettingsGroup title={t("settings.appearanceUi")}>

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

      </SettingsGroup>

      <SettingsGroup title={t("settings.appearanceCode")}>

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

      </SettingsGroup>

      <h3 className="settings-group-title">{t("settings.codePreview")}</h3>
      <p className="settings-row-desc" style={{ margin: "-4px 0 12px" }}>
        {t("settings.codePreviewDesc")}
      </p>
      <div className="code-preview-grid" style={{ gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
        {([
          { id: appearance.codeThemeLight, file: t("settings.previewLight"), dark: false },
          { id: appearance.codeThemeDark, file: t("settings.previewDark"), dark: true },
        ] as const).map((preview) => {
          const active = isDark === preview.dark;
          const themeStyle = getCodeThemeStyle(preview.id, preview.dark);
          const themeName = CODE_THEME_OPTIONS.find((o) => o.id === preview.id)?.label;
          const themeBg =
            (themeStyle["pre[class*=\"language-\"]"] as { backgroundColor?: string } | undefined)?.backgroundColor
            || (themeStyle.pre as { backgroundColor?: string } | undefined)?.backgroundColor
            || "var(--preview-code-bg)";
          return (
            <article
              key={String(preview.dark)}
              className={`code-preview ${preview.dark ? "is-dark" : "is-light"}`}
              aria-label={`${preview.file}${active ? ` · ${t("settings.previewActive")}` : ""}`}
            >
              <header className="code-preview-bar">
                <span className="code-preview-dots" aria-hidden>
                  <i /><i /><i />
                </span>
                <span className="code-preview-file">{preview.file}</span>
                <span className="code-preview-meta">
                  {active ? <span className="code-preview-live" title={t("settings.previewActive")} /> : null}
                  {themeName}
                </span>
              </header>
              <div className="code-preview-body" style={{ background: themeBg }}>
                <SyntaxHighlighter
                  language="typescript"
                  style={themeStyle}
                  showLineNumbers={appearance.showCodeLineNumbers}
                  wrapLongLines={appearance.wrapCodeLines}
                  customStyle={{
                    margin: 0,
                    padding: 0,
                    fontSize: appearance.codeFontSize,
                    background: "transparent",
                    border: "none",
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
            </article>
          );
        })}
      </div>
    </div>

  );
}
