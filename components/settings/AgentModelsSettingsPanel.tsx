"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/hooks/useLocale";
import type { ThinkingLevelPref } from "@/lib/web-settings";
import type { AgentModelRole } from "@/hooks/use-agent-model-thinking-settings";
import type { WebSettingsModelOption } from "@/lib/web-settings-store";
import { ModelSelect, SettingsGroup, SettingsRow } from "./settings-ui";
import { ModelThinkingControl } from "./ModelThinkingControl";

export type AgentModelsSettingsPanelProps = {
  models: WebSettingsModelOption[];
  loadingModels: boolean;
  savingKey: string | null;
  roleDefaultRef: string;
  roleSmolRef: string;
  rolePlanRef: string;
  roleDefaultThinking: ThinkingLevelPref | null;
  roleSmolThinking: ThinkingLevelPref | null;
  rolePlanThinking: ThinkingLevelPref | null;
  titleModelRef: string;
  commitModelRef: string;
  titleModelThinking: ThinkingLevelPref | null;
  commitModelThinking: ThinkingLevelPref | null;
  saveModelPref: (key: "titleModel" | "commitModel", value: string) => void | Promise<void>;
  saveModelThinking: (key: "titleModel" | "commitModel", level: ThinkingLevelPref | null) => void | Promise<void>;
  saveRoleModel: (role: AgentModelRole, value: string) => void | Promise<void>;
  saveRoleThinking: (role: AgentModelRole, level: ThinkingLevelPref | null) => void | Promise<void>;
  saveErrorBlock: ReactNode;
};

export function AgentModelsSettingsPanel({
  models,
  loadingModels,
  savingKey,
  roleDefaultRef,
  roleSmolRef,
  rolePlanRef,
  roleDefaultThinking,
  roleSmolThinking,
  rolePlanThinking,
  titleModelRef,
  commitModelRef,
  titleModelThinking,
  commitModelThinking,
  saveModelPref,
  saveModelThinking,
  saveRoleModel,
  saveRoleThinking,
  saveErrorBlock,
}: AgentModelsSettingsPanelProps) {
  const { t } = useLocale();
  return (
    <>
      <SettingsGroup title={t("settings.modelRoles")}>
        <SettingsRow
          stacked
          title={t("settings.roleDefault")}
          description={t("settings.roleDefaultDesc")}
          action={
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <ModelSelect
                  value={roleDefaultRef}
                  models={models}
                  loading={loadingModels}
                  disabled={savingKey === "roleDefault"}
                  placeholder={loadingModels ? t("common.loading") : t("settings.roleDefaultFallback")}
                  ariaLabel={t("settings.roleDefault")}
                  unavailableLabel={t("settings.modelUnavailable")}
                  onChange={(value) => void saveRoleModel("default", value)}
                />
              </div>
              <ModelThinkingControl
                modelRef={roleDefaultRef}
                models={models}
                level={roleDefaultThinking}
                disabled={savingKey === "roleDefault"}
                onChange={(level) => void saveRoleThinking("default", level)}
              />
            </div>
          }
        />
        <SettingsRow
          stacked
          title={t("settings.roleSmol")}
          description={t("settings.roleSmolDesc")}
          action={
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <ModelSelect
                  value={roleSmolRef}
                  models={models}
                  loading={loadingModels}
                  disabled={savingKey === "roleSmol"}
                  placeholder={loadingModels ? t("common.loading") : t("settings.roleSmolFallback")}
                  ariaLabel={t("settings.roleSmol")}
                  unavailableLabel={t("settings.modelUnavailable")}
                  onChange={(value) => void saveRoleModel("smol", value)}
                />
              </div>
              <ModelThinkingControl
                modelRef={roleSmolRef}
                models={models}
                level={roleSmolThinking}
                disabled={savingKey === "roleSmol"}
                onChange={(level) => void saveRoleThinking("smol", level)}
              />
            </div>
          }
        />
        <SettingsRow
          stacked
          title={t("settings.rolePlan")}
          description={t("settings.rolePlanDesc")}
          action={
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <ModelSelect
                  value={rolePlanRef}
                  models={models}
                  loading={loadingModels}
                  disabled={savingKey === "rolePlan"}
                  placeholder={loadingModels ? t("common.loading") : t("settings.rolePlanFallback")}
                  ariaLabel={t("settings.rolePlan")}
                  unavailableLabel={t("settings.modelUnavailable")}
                  onChange={(value) => void saveRoleModel("plan", value)}
                />
              </div>
              <ModelThinkingControl
                modelRef={rolePlanRef}
                models={models}
                level={rolePlanThinking}
                disabled={savingKey === "rolePlan"}
                onChange={(level) => void saveRoleThinking("plan", level)}
              />
            </div>
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.utilityModels")}>
        <SettingsRow
          stacked
          title={t("settings.titleModel")}
          description={t("settings.titleModelDesc")}
          action={
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <ModelSelect
                  value={titleModelRef}
                  models={models}
                  loading={loadingModels}
                  disabled={savingKey === "titleModel"}
                  placeholder={loadingModels ? t("common.loading") : t("settings.titleModelDefault")}
                  ariaLabel={t("settings.titleModel")}
                  unavailableLabel={t("settings.modelUnavailable")}
                  onChange={(value) => void saveModelPref("titleModel", value)}
                />
              </div>
              <ModelThinkingControl
                modelRef={titleModelRef}
                models={models}
                level={titleModelThinking}
                disabled={savingKey === "titleModel"}
                onChange={(level) => void saveModelThinking("titleModel", level)}
              />
            </div>
          }
        />
        <SettingsRow
          stacked
          title={t("settings.commitModel")}
          description={t("settings.commitModelDesc")}
          action={
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <ModelSelect
                  value={commitModelRef}
                  models={models}
                  loading={loadingModels}
                  disabled={savingKey === "commitModel"}
                  placeholder={loadingModels ? t("common.loading") : t("settings.commitModelDefault")}
                  ariaLabel={t("settings.commitModel")}
                  unavailableLabel={t("settings.modelUnavailable")}
                  onChange={(value) => void saveModelPref("commitModel", value)}
                />
              </div>
              <ModelThinkingControl
                modelRef={commitModelRef}
                models={models}
                level={commitModelThinking}
                disabled={savingKey === "commitModel"}
                onChange={(level) => void saveModelThinking("commitModel", level)}
              />
            </div>
          }
        />
      </SettingsGroup>

      {saveErrorBlock}
    </>
  );
}
