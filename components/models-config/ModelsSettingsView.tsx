/**
 * Models settings page: single-column provider cards (settings grammar);
 * drilling into a row swaps the list for that provider/model detail with a
 * back strip, same as the other settings sections.
 */

"use client";

import { ChevronLeft, ChevronRight, Cpu } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { getFreeProvider } from "@/lib/free-providers";
import { Icon } from "../Icon";
import { SettingsGroup, SettingsPageHeading, SettingsRow } from "../settings/settings-ui";
import { ProviderIcon } from "./provider-icons";
import type { ModelsJson, ProviderModelRow, Selection } from "./models-config-types";

type BuiltinNav = { id: string; label: string; type: "oauth" | "apikey" };

function RowChevron() {
  return <Icon icon={ChevronRight} size={14} style={{ color: "var(--text-dim)", flexShrink: 0 }} />;
}

export function ModelsSettingsView({
  loading,
  saveError,
  selection,
  setSelection,
  detailContent,
  activeBuiltinProviders,
  builtinModelsByProvider,
  providers,
  onAddProvider,
}: {
  loading: boolean;
  saveError: string | null;
  selection: Selection | null;
  setSelection: (next: Selection | null) => void;
  detailContent: React.ReactNode;
  activeBuiltinProviders: BuiltinNav[];
  builtinModelsByProvider: Record<string, ProviderModelRow[]>;
  providers: Array<[string, NonNullable<ModelsJson["providers"]>[string]]>;
  onAddProvider: () => void;
}) {
  const { t } = useLocale();

  if (selection) {
    // Back target: model edits return to their provider, providers to the list.
    let backTarget: Selection | null = null;
    let detailTitle = "";
    if (selection.type === "model") {
      backTarget = { type: "provider", name: selection.providerName };
      const provider = providers.find(([name]) => name === selection.providerName)?.[1];
      const model = provider?.models?.[selection.index];
      detailTitle = model?.id || t("models.newModel");
    } else if (selection.type === "builtin-model") {
      const owner = activeBuiltinProviders.find((p) => p.id === selection.providerId);
      backTarget = owner ? { type: owner.type, providerId: owner.id } : null;
      detailTitle = selection.modelId;
    } else if (selection.type === "oauth" || selection.type === "apikey") {
      detailTitle = activeBuiltinProviders.find(
        (p) => p.id === selection.providerId && p.type === selection.type,
      )?.label ?? selection.providerId;
    } else {
      const provider = providers.find(([name]) => name === selection.name)?.[1];
      const freeDef = getFreeProvider(typeof provider?.managed === "string" ? provider.managed : undefined);
      detailTitle = freeDef?.displayName ?? selection.name;
    }

    return (
      <div className="settings-page-general">
        <div className="models-detail-head">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSelection(backTarget)}
            aria-label={t("common.back")}
            title={t("common.back")}
          >
            <Icon icon={ChevronLeft} size={15} />
          </button>
          <span className="models-detail-head-title">{detailTitle}</span>
        </div>
        {saveError && (
          <div className="settings-row-desc" style={{ color: "var(--destructive)", margin: "0 0 10px" }}>
            {saveError}
          </div>
        )}
        {detailContent}
      </div>
    );
  }

  return (
    <div className="settings-page-general">
      <SettingsPageHeading
        title={t("settings.models")}
        action={(
          <button type="button" className="btn-ghost btn-compact" onClick={onAddProvider}>
            {t("modal.addProvider")}
          </button>
        )}
      />
      {saveError && (
        <div className="settings-row-desc" style={{ color: "var(--destructive)", margin: "0 0 10px" }}>
          {saveError}
        </div>
      )}

      {activeBuiltinProviders.length > 0 && (
        <SettingsGroup title={t("models.subscriptions")}>
          {activeBuiltinProviders.map((p) => {
            const models = builtinModelsByProvider[p.id];
            const enabledCount = (models ?? []).filter((m) => !m.disabled).length;
            const status = p.type === "oauth" ? t("models.statusConnected") : t("models.statusConfigured");
            const counts = models
              ? `${models.length} ${t("models.freeModelCount")} · ${enabledCount} ${t("models.enabledCount")}`
              : t("modal.loading");
            return (
              <SettingsRow
                key={p.id}
                onClick={() => setSelection({ type: p.type, providerId: p.id })}
                title={(
                  <>
                    <ProviderIcon id={p.id} size={16} />
                    <span>{p.label}</span>
                  </>
                )}
                description={`${status} · ${counts}`}
                action={<RowChevron />}
              />
            );
          })}
        </SettingsGroup>
      )}

      <SettingsGroup title={t("models.custom")}>
        {loading ? (
          <div className="settings-card-empty">{t("modal.loading")}</div>
        ) : providers.length === 0 ? (
          <div className="settings-card-empty">{t("models.noCustomProviders")}</div>
        ) : (
          providers.map(([pName, pData]) => {
            const models = pData.models ?? [];
            const freeDef = getFreeProvider(typeof pData.managed === "string" ? pData.managed : undefined);
            const managed = Boolean(freeDef);
            const providerLabel = freeDef?.displayName ?? pName;
            return (
              <SettingsRow
                key={pName}
                onClick={() => setSelection({ type: "provider", name: pName })}
                title={(
                  <>
                    {managed && freeDef ? (
                      <ProviderIcon id={freeDef.iconId} size={16} />
                    ) : (
                      <Icon icon={Cpu} size={13} strokeWidth={1.8} />
                    )}
                    <span className={managed ? undefined : "input-mono"} style={{ fontSize: 13 }}>{providerLabel}</span>
                    {managed && <span className="settings-badge">{t("models.free")}</span>}
                  </>
                )}
                description={`${models.length} ${t("models.freeModelCount")}`}
                action={<RowChevron />}
              />
            );
          })
        )}
      </SettingsGroup>
    </div>
  );
}
