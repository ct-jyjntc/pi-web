"use client";

/**
 * Settings UI for opt-in Lean Mode (anti-bloat policy prompt injection only).
 */
import { SettingsToggle } from "@/components/SettingsToggle";
import type { MessageKey } from "@/lib/i18n/messages";
import type { LeanIntensity, LeanModeSettings } from "@/lib/lean-mode-settings";
import { SettingsGroup, SettingsRow } from "./settings-ui";

type Translate = (key: MessageKey) => string;

export function LeanModeSettingsSection({
  leanMode,
  onPatch,
  t,
}: {
  leanMode: LeanModeSettings;
  onPatch: (next: Partial<LeanModeSettings>) => void;
  t: Translate;
}) {
  return (
    <SettingsGroup title={t("settings.leanSection")}>
      <SettingsRow
        title={t("settings.leanMode")}
        description={t("settings.leanModeDesc")}
        action={
          <SettingsToggle
            enabled={leanMode.enabled}
            onChange={(next) => onPatch({ enabled: next })}
          />
        }
      />
      <SettingsRow
        stacked
        title={t("settings.leanIntensity")}
        description={t("settings.leanIntensityDesc")}
        action={
          <select
            className="input-base"
            value={leanMode.intensity}
            disabled={!leanMode.enabled}
            aria-label={t("settings.leanIntensity")}
            onChange={(e) => onPatch({ intensity: e.target.value as LeanIntensity })}
            style={{ width: "100%", maxWidth: 280 }}
          >
            <option value="soft">{t("settings.leanIntensitySoft")}</option>
            <option value="review">{t("settings.leanIntensityReview")}</option>
            <option value="hard">{t("settings.leanIntensityHard")}</option>
          </select>
        }
      />
      <div className="settings-row-desc" style={{ padding: "0 14px 12px", color: "var(--text-dim)" }}>
        {t("settings.leanSessionReloadNote")}
      </div>
    </SettingsGroup>
  );
}
