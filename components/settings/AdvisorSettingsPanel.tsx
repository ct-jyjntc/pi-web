/**
 * Settings → Agent → Advisor + Lean Mode groups.
 */

"use client";

import type { Dispatch, SetStateAction } from "react";
import { useLocale } from "@/hooks/useLocale";
import type { AgentModelSaveKey } from "@/hooks/use-agent-model-thinking-settings";
import type { LeanModeSettings } from "@/lib/lean-mode-settings";
import type { ThinkingLevelPref } from "@/lib/web-settings";
import type { WebSettingsModelOption } from "@/lib/web-settings-store";
import { SettingsToggle } from "../SettingsToggle";
import { LeanModeSettingsSection } from "./LeanModeSettingsSection";
import { ModelThinkingControl } from "./ModelThinkingControl";
import { ModelSelect, SettingsGroup, SettingsRow } from "./settings-ui";

export function AdvisorSettingsPanel({
  advisorEnabled,
  advisorModelRef,
  advisorModelThinking,
  models,
  loadingModels,
  savingKey,
  setAdvisorEnabled,
  setAdvisorModelRef,
  setSavingKey,
  patchPref,
  saveModelThinking,
  leanMode,
  onLeanPatch,
}: {
  advisorEnabled: boolean;
  advisorModelRef: string;
  advisorModelThinking: ThinkingLevelPref | null;
  models: WebSettingsModelOption[];
  loadingModels: boolean;
  savingKey: string | null;
  setAdvisorEnabled: (next: boolean) => void;
  setAdvisorModelRef: (value: string) => void;
  setSavingKey: Dispatch<SetStateAction<AgentModelSaveKey | null>>;
  patchPref: (patch: Record<string, unknown>) => Promise<void> | void;
  saveModelThinking: (key: "advisorModel", level: ThinkingLevelPref | null) => void | Promise<void>;
  leanMode: LeanModeSettings;
  onLeanPatch: (partial: Partial<LeanModeSettings>) => void;
}) {
  const { t } = useLocale();

  return (
    <>
      <SettingsGroup title={t("settings.advisorSection")}>
        <SettingsRow
          title={t("settings.advisor")}
          description={t("settings.advisorDesc")}
          action={
            <SettingsToggle
              enabled={advisorEnabled}
              onChange={(next) => {
                setAdvisorEnabled(next);
                void patchPref({ advisorEnabled: next });
              }}
            />
          }
        />
        <SettingsRow
          stacked
          title={t("settings.advisorModel")}
          description={t("settings.advisorModelDesc")}
          action={
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <ModelSelect
                  value={advisorModelRef}
                  models={models}
                  loading={loadingModels}
                  disabled={!advisorEnabled || savingKey === "advisorModel"}
                  placeholder={loadingModels ? t("common.loading") : t("settings.advisorModelDefault")}
                  ariaLabel={t("settings.advisorModel")}
                  unavailableLabel={t("settings.modelUnavailable")}
                  onChange={(value) => {
                    setAdvisorModelRef(value);
                    setSavingKey("advisorModel");
                    void Promise.resolve(patchPref({ advisorModel: value || null })).finally(() => setSavingKey(null));
                  }}
                />
              </div>
              <ModelThinkingControl
                modelRef={advisorModelRef}
                models={models}
                level={advisorModelThinking}
                disabled={!advisorEnabled || savingKey === "advisorModel"}
                onChange={(level) => void saveModelThinking("advisorModel", level)}
              />
            </div>
          }
        />
      </SettingsGroup>

      <LeanModeSettingsSection leanMode={leanMode} t={t} onPatch={onLeanPatch} />
    </>
  );
}
