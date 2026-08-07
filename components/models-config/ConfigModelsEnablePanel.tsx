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
  onToggleAllModels,
  loading = false,
  error = null,
}: {
  models: readonly ModelEntry[];
  onChangeModels?: (models: ModelEntry[]) => void;
  onToggleModel?: (modelId: string, enabled: boolean) => void | Promise<void>;
  /** Bulk enable (true) / disable (false) every model in the list. */
  onToggleAllModels?: (enabled: boolean) => void | Promise<void>;
  loading?: boolean;
  error?: string | null;
}) {
  const { t } = useLocale();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const enabledCount = models.filter((m) => !m.disabled).length;
  const busy = bulkPending || pendingId !== null;
  const q = query.trim().toLowerCase();
  const visibleModels = q
    ? models.filter((m) => {
        const hay = `${m.id ?? ""} ${m.name ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
    : models;

  const runBulk = (enabled: boolean) => {
    if (onToggleAllModels) {
      setBulkPending(true);
      setToggleError(null);
      void Promise.resolve(onToggleAllModels(enabled))
        .catch((e) => setToggleError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBulkPending(false));
      return;
    }
    if (!onChangeModels) return;
    onChangeModels(
      models.map((m) => normalizeModelEntry({ ...m, disabled: enabled ? undefined : true })),
    );
  };

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

      {models.length > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <input
            className="input-base"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("models.searchModelsPlaceholder")}
            aria-label={t("models.searchModelsPlaceholder")}
            style={{ fontSize: 12, flex: 1, minWidth: 0 }}
          />
          {(onToggleAllModels || onChangeModels) ? (
            <>
              <button
                type="button"
                className="btn-ghost btn-compact"
                disabled={busy || loading || enabledCount === models.length}
                onClick={() => runBulk(true)}
                title={t("models.enableAllHint")}
                style={{ flexShrink: 0 }}
              >
                {bulkPending ? t("models.working") : t("models.enableAll")}
              </button>
              <button
                type="button"
                className="btn-ghost btn-compact"
                disabled={busy || loading || enabledCount === 0}
                onClick={() => runBulk(false)}
                title={t("models.disableAllHint")}
                style={{ flexShrink: 0 }}
              >
                {bulkPending ? t("models.working") : t("models.disableAll")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

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
        ) : visibleModels.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>
            {t("models.noSearchMatches")}
          </div>
        ) : (
          visibleModels.map((model, index) => {
            const label = model.name?.trim() || model.id || t("models.newModel");
            const fullIndex = models.indexOf(model);
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
                  loading={pendingId === model.id || bulkPending}
                  title={model.disabled ? t("models.enableHint") : t("models.disableHint")}
                  onChange={(on) => {
                    if (busy) return;
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
                      i === fullIndex
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
