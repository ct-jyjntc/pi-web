/**
 * Settings → Agent → Agent behavior rows (thinking, todos, review, concurrency).
 */
"use client";

import { useLocale } from "@/hooks/useLocale";
import { SettingsToggle } from "../SettingsToggle";
import { SettingsGroup, SettingsRow } from "./settings-ui";

export function AgentBehaviorSettings({
  prefs,
  onLocal,
  patchPref,
}: {
  prefs: {
    defaultThinkingLevel: string;
    showThinking: boolean;
    showTodos: boolean;
    expandReviewDiffs: boolean;
    subagentConcurrencyEnabled: boolean;
    subagentConcurrencyMax: number;
  };
  onLocal: (patch: {
    subagentConcurrencyEnabled?: boolean;
    subagentConcurrencyMax?: number;
  }) => void;
  patchPref: (patch: Record<string, unknown>) => void | Promise<void>;
}) {
  const { t } = useLocale();
  return (
    <SettingsGroup title={t("settings.agentBehavior")}>
      <SettingsRow
        stacked
        title={t("settings.defaultThinking")}
        description={t("settings.defaultThinkingDesc")}
        action={
          <select
            className="input-base"
            value={prefs.defaultThinkingLevel}
            onChange={(e) => void patchPref({ defaultThinkingLevel: e.target.value })}
            style={{ width: "100%", maxWidth: 280 }}
          >
            {(["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        }
      />
      <SettingsRow
        title={t("settings.showThinking")}
        description={t("settings.showThinkingDesc")}
        action={
          <SettingsToggle
            enabled={prefs.showThinking}
            onChange={(next) => void patchPref({ showThinking: next })}
          />
        }
      />
      <SettingsRow
        title={t("settings.showTodos")}
        description={t("settings.showTodosDesc")}
        action={
          <SettingsToggle
            enabled={prefs.showTodos}
            onChange={(next) => void patchPref({ showTodos: next })}
          />
        }
      />
      <SettingsRow
        title={t("settings.expandReviewDiffs")}
        description={t("settings.expandReviewDiffsDesc")}
        action={
          <SettingsToggle
            enabled={prefs.expandReviewDiffs}
            onChange={(next) => void patchPref({ expandReviewDiffs: next })}
          />
        }
      />
      <SettingsRow
        title={t("settings.subagentConcurrency")}
        description={t("settings.subagentConcurrencyDesc")}
        action={
          <SettingsToggle
            enabled={prefs.subagentConcurrencyEnabled}
            onChange={(next) => {
              onLocal({ subagentConcurrencyEnabled: next });
              void patchPref({ subagentConcurrency: { enabled: next } });
            }}
          />
        }
      />
      <SettingsRow
        stacked
        title={t("settings.subagentConcurrencyMax")}
        description={t("settings.subagentConcurrencyMaxDesc")}
        action={
          <input
            className="input-base input-mono"
            type="number"
            min={1}
            max={16}
            value={prefs.subagentConcurrencyMax}
            disabled={!prefs.subagentConcurrencyEnabled}
            onChange={(e) => onLocal({
              subagentConcurrencyMax: Number(e.target.value) || 1,
            })}
            onBlur={() => void patchPref({
              subagentConcurrency: { max: prefs.subagentConcurrencyMax },
            })}
            style={{ width: 100 }}
          />
        }
      />
    </SettingsGroup>
  );
}
