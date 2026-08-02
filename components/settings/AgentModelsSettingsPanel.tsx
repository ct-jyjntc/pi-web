"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/hooks/useLocale";
import type { WebSettingsModelOption } from "@/lib/web-settings-store";
import { ModelSelect, SettingsRow, sectionTitle } from "./settings-ui";

export type AgentModelsSettingsPanelProps = {
  models: WebSettingsModelOption[];
  loadingModels: boolean;
  savingKey: string | null;
  roleDefaultRef: string;
  roleSmolRef: string;
  rolePlanRef: string;
  titleModelRef: string;
  commitModelRef: string;
  saveModelPref: (key: "titleModel" | "commitModel", value: string) => void | Promise<void>;
  saveRoleModel: (role: "default" | "smol" | "plan", value: string) => void | Promise<void>;
  setSection: (section: "models") => void;
  saveErrorBlock: ReactNode;
};

export function AgentModelsSettingsPanel({
  models,
  loadingModels,
  savingKey,
  roleDefaultRef,
  roleSmolRef,
  rolePlanRef,
  titleModelRef,
  commitModelRef,
  saveModelPref,
  saveRoleModel,
  setSection,
  saveErrorBlock,
}: AgentModelsSettingsPanelProps) {
  const { t } = useLocale();
  return (
    <>
      {sectionTitle(t("settings.modelRoles"))}

      <SettingsRow
        stacked
        title={t("settings.roleDefault")}
        description={t("settings.roleDefaultDesc")}
        action={
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
        }
      />

      <SettingsRow
        stacked
        title={t("settings.roleSmol")}
        description={t("settings.roleSmolDesc")}
        action={
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
        }
      />

      <SettingsRow
        stacked
        title={t("settings.rolePlan")}
        description={t("settings.rolePlanDesc")}
        action={
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
        }
      />

      <div style={{ margin: "4px 0 14px" }}>
        <button
          type="button"
          className="btn-ghost btn-compact"
          onClick={() => setSection("models")}
        >
          {t("settings.manageProviders")}
        </button>
      </div>

      {sectionTitle(t("settings.utilityModels"))}

      <SettingsRow
        stacked
        title={t("settings.titleModel")}
        description={t("settings.titleModelDesc")}
        action={
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
        }
      />

      <SettingsRow
        stacked
        title={t("settings.commitModel")}
        description={t("settings.commitModelDesc")}
        action={
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
        }
      />

      {saveErrorBlock}
    </>

  );
}
