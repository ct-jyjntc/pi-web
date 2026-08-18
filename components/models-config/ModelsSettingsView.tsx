/**
 * Models settings chrome: page heading + compact provider tree + detail pane.
 */

"use client";

import { Cpu } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { getFreeProvider } from "@/lib/free-providers";
import { Icon } from "../Icon";
import { SettingsPageHeading } from "../settings/settings-ui";
import { ProviderIcon } from "./provider-icons";
import type { ModelsJson, ProviderModelRow, Selection } from "./models-config-types";

type BuiltinNav = { id: string; label: string; type: "oauth" | "apikey" };

function NavRow({
  selected,
  child,
  onClick,
  children,
}: {
  selected: boolean;
  child?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`models-nav-row${selected ? " is-active" : ""}${child ? " is-child" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
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
  onAddModel,
}: {
  loading: boolean;
  saveError: string | null;
  selection: Selection | null;
  setSelection: (next: Selection) => void;
  detailContent: React.ReactNode;
  activeBuiltinProviders: BuiltinNav[];
  builtinModelsByProvider: Record<string, ProviderModelRow[]>;
  providers: Array<[string, NonNullable<ModelsJson["providers"]>[string]]>;
  onAddProvider: () => void;
  onAddModel: (providerName: string) => void;
}) {
  const { t } = useLocale();

  return (
    <div className="models-settings">
      <SettingsPageHeading title={t("settings.models")} />
      {saveError && (
        <div className="settings-row-desc" style={{ color: "var(--destructive)", margin: "0 0 10px" }}>
          {saveError}
        </div>
      )}

      <div
        className="models-settings-split"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)",
          gap: 20,
          flex: 1,
          minHeight: 0,
        }}
      >
        <nav className="models-settings-nav" aria-label={t("settings.models")}>
          {activeBuiltinProviders.length > 0 && (
            <div className="models-nav-section">
              <div className="settings-group-title">{t("models.subscriptions")}</div>
              {activeBuiltinProviders.map((p) => {
                const isSelected = p.type === "oauth"
                  ? selection?.type === "oauth" && selection.providerId === p.id
                  : selection?.type === "apikey" && selection.providerId === p.id;
                const models = (builtinModelsByProvider[p.id] ?? []).filter((m) => !m.disabled);
                return (
                  <div key={p.id}>
                    <NavRow
                      selected={isSelected}
                      onClick={() => setSelection(p.type === "oauth"
                        ? { type: "oauth", providerId: p.id }
                        : { type: "apikey", providerId: p.id })}
                    >
                      <ProviderIcon id={p.id} size={16} />
                      <span className="models-nav-label">{p.label}</span>
                    </NavRow>
                    {models.map((m) => (
                      <NavRow
                        key={m.id}
                        child
                        selected={selection?.type === "builtin-model" && selection.providerId === p.id && selection.modelId === m.id}
                        onClick={() => setSelection({ type: "builtin-model", providerId: p.id, modelId: m.id })}
                      >
                        <span className="models-nav-label is-mono">{m.id}</span>
                      </NavRow>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          <div className="models-nav-section">
            <div className="settings-group-title">{t("models.custom")}</div>
            {loading ? (
              <div className="settings-card-empty">{t("modal.loading")}</div>
            ) : (
              providers.map(([pName, pData]) => {
                const isProviderSelected = selection?.type === "provider" && selection.name === pName;
                const models = pData.models ?? [];
                const freeDef = getFreeProvider(typeof pData.managed === "string" ? pData.managed : undefined);
                const managed = Boolean(freeDef);
                const providerLabel = freeDef?.displayName ?? pName;
                return (
                  <div key={pName}>
                    <NavRow
                      selected={isProviderSelected}
                      onClick={() => setSelection({ type: "provider", name: pName })}
                    >
                      {managed && freeDef ? (
                        <ProviderIcon id={freeDef.iconId} size={16} />
                      ) : (
                        <Icon icon={Cpu} size={13} strokeWidth={1.8} />
                      )}
                      <span className={`models-nav-label${managed ? "" : " is-mono"}`}>{providerLabel}</span>
                      {managed && <span className="settings-badge">{t("models.free")}</span>}
                    </NavRow>
                    {models.map((m, i) => {
                      if (m.disabled && m.id) return null;
                      return (
                        <NavRow
                          key={`${pName}-${i}`}
                          child
                          selected={selection?.type === "model" && selection.providerName === pName && selection.index === i}
                          onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                        >
                          <span className="models-nav-label is-mono">
                            {m.id || t("models.newModel")}
                          </span>
                        </NavRow>
                      );
                    })}
                    {!managed && (
                      <NavRow child selected={false} onClick={() => onAddModel(pName)}>
                        <span className="models-nav-label">{t("models.addModel")}</span>
                      </NavRow>
                    )}
                  </div>
                );
              })
            )}
            <NavRow selected={false} onClick={onAddProvider}>
              <span className="models-nav-label">{t("modal.addProvider")}</span>
            </NavRow>
          </div>
        </nav>

        <div className="models-settings-detail">
          {loading ? null : detailContent ?? (
            <div className="settings-card-empty">{t("models.selectHint")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
