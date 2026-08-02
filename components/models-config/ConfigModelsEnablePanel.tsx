"use client";

/**
 * Enable/disable list shared by models.json and built-in provider catalogs.
 * The caller owns persistence; this component only renders the list and emits
 * a model id + desired enabled state.
 */
import { useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { SettingsToggle } from "../SettingsToggle";
import { normalizeModelEntry, type ModelEntry } from "./models-config-types";

export function ConfigModelsEnablePanel({
  models,
  onChangeModels,
  onToggleModel,
  loading = false,
  error = null,
}: {
  models: readonly ModelEntry[];
  onChangeModels?: (models: ModelEntry[]) => void;
  onToggleModel?: (modelId: string, enabled: boolean) => void | Promise<void>;
  loading?: boolean;
  error?: string | null;
}) {
  const { t } = useLocale();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const enabledCount = models.filter((m) => !m.disabled).length;

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        paddingTop: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("models.providerModels")}</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {loading
            ? t("models.loadingProviderModels")
            : (
              <>
                {models.length} {t("models.freeModelCount")}
                {" · "}
                {enabledCount} {t("models.enabledCount")}
              </>
            )}
        </div>
      </div>

      {(error || toggleError) && (
        <div style={{ fontSize: 12, color: "var(--destructive)", flexShrink: 0 }}>{error ?? toggleError}</div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          maxHeight: 320,
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg)",
        }}
      >
        {loading && models.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>
            {t("models.loadingProviderModels")}
          </div>
        ) : models.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>
            {t("models.noProviderModels")}
          </div>
        ) : (
          models.map((model, index) => {
            const label = model.name?.trim() || model.id || t("models.newModel");
            return (
              <div
                key={`${model.id || "draft"}-${index}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--border)",
                  opacity: model.disabled ? 0.65 : 1,
                  flexShrink: 0,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </div>
                  {model.id ? (
                    <div
                      className="input-mono"
                      style={{
                        fontSize: 10,
                        color: "var(--text-dim)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        marginTop: 1,
                      }}
                    >
                      {model.id}
                      {model.reasoning ? " · T" : ""}
                    </div>
                  ) : null}
                </div>
                <span style={{ fontSize: 10, color: model.disabled ? "var(--text-dim)" : "var(--text-muted)", flexShrink: 0 }}>
                  {model.disabled ? t("models.disabled") : t("models.enabled")}
                </span>
                <SettingsToggle
                  enabled={!model.disabled}
                  loading={pendingId === model.id}
                  title={model.disabled ? t("models.enableHint") : t("models.disableHint")}
                  onChange={(on) => {
                    if (onToggleModel) {
                      setPendingId(model.id);
                      setToggleError(null);
                      void Promise.resolve(onToggleModel(model.id, on))
                        .catch((e) => setToggleError(e instanceof Error ? e.message : String(e)))
                        .finally(() => setPendingId(null));
                      return;
                    }
                    if (!onChangeModels) return;
                    const next = models.map((m, i) => (
                      i === index
                        ? normalizeModelEntry({ ...m, disabled: on ? undefined : true })
                        : m
                    ));
                    onChangeModels(next);
                  }}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
