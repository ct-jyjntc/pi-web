// Renders the chat composer thinking-budget choices for one settings model.
"use client";

import { useLocale } from "@/hooks/useLocale";
import type { ThinkingLevelPref } from "@/lib/web-settings";
import type { WebSettingsModelOption } from "@/lib/web-settings-store";
import { THINKING_LEVELS, THINKING_LEVEL_KEYS } from "../chat-input/chat-input-shared";

function findModel(models: WebSettingsModelOption[], value: string): WebSettingsModelOption | undefined {
  const slash = value.indexOf("/");
  if (slash <= 0) return undefined;
  const provider = value.slice(0, slash);
  const modelId = value.slice(slash + 1);
  return models.find((model) => model.provider === provider && model.modelId === modelId);
}

export function ModelThinkingControl({
  modelRef,
  models,
  level,
  disabled,
  onChange,
}: {
  modelRef: string;
  models: WebSettingsModelOption[];
  level: ThinkingLevelPref | null;
  disabled: boolean;
  onChange: (level: ThinkingLevelPref | null) => void;
}) {
  const { t } = useLocale();
  const model = findModel(models, modelRef);
  const supported = model?.thinkingLevels ?? [];
  const canThink = model?.supportsThinking === true && supported.some((value) => value !== "off");
  const options = canThink
    ? THINKING_LEVELS.filter((value) => value === "auto" || supported.includes(value))
    : ["off" as const];
  const selected: ThinkingLevelPref = canThink
    ? level && (level === "auto" || supported.includes(level)) ? level : "auto"
    : "off";
  const label = t(THINKING_LEVEL_KEYS[selected]);

  return (
    <select
      className="input-base input-mono"
      value={selected}
      disabled={disabled || !canThink}
      aria-label={t("settings.thinkingLevel")}
      title={canThink
        ? t("chat.changeReasoning", { level: label })
        : t("settings.thinkingUnsupported")}
      onChange={(event) => onChange(event.target.value as ThinkingLevelPref)}
      style={{ width: 116, height: 32, padding: "0 7px", fontSize: 11, flexShrink: 0 }}
    >
      {options.map((value) => (
        <option key={value} value={value}>{t(THINKING_LEVEL_KEYS[value])}</option>
      ))}
    </select>
  );
}
