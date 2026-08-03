"use client";

/**
 * Settings UI for opt-in Lean Mode (anti-bloat policy prompt injection only).
 */
import { SettingsToggle } from "@/components/SettingsToggle";
import type { MessageKey } from "@/lib/i18n/messages";
import type { LeanIntensity, LeanModeSettings } from "@/lib/lean-mode-settings";

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
    <>
      <div className="settings-section-title">{t("settings.leanSection")}</div>

      <div className="settings-row">
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div className="settings-row-title">{t("settings.leanMode")}</div>
          <div className="settings-row-desc">{t("settings.leanModeDesc")}</div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <SettingsToggle
            enabled={leanMode.enabled}
            onChange={(next) => onPatch({ enabled: next })}
          />
        </div>
      </div>

      <div className="settings-row is-stacked">
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div className="settings-row-title">{t("settings.leanIntensity")}</div>
          <div className="settings-row-desc">{t("settings.leanIntensityDesc")}</div>
        </div>
        <div style={{ flexShrink: 0, width: "100%" }}>
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
        </div>
      </div>

      <div className="settings-row-desc" style={{ margin: "4px 0 12px", color: "var(--text-dim)" }}>
        {t("settings.leanSessionReloadNote")}
      </div>
    </>
  );
}