"use client";

/**
 * Enable/disable list shared by models.json and built-in provider catalogs.
 * The caller owns persistence; this component only renders the list and emits
 * a model id + desired enabled state. Renders in settings-group/card grammar.
 */
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";
import { SettingsToggle } from "../SettingsToggle";
import { normalizeModelEntry, type ModelEntry } from "./models-config-types";

export function ConfigModelsEnablePanel({
  models,
  onChangeModels,
  onToggleModel,
  onToggleAllModels,
  onOpenModel,
  canOpenModel,
  onAddModel,
  loading = false,
  error = null,
  toolbar = null,
}: {
  models: readonly ModelEntry[];
  onChangeModels?: (models: ModelEntry[]) => void;
  onToggleModel?: (modelId: string, enabled: boolean) => void | Promise<void>;
  /** Bulk enable (true) / disable (false) every model in the list. */
  onToggleAllModels?: (enabled: boolean) => void | Promise<void>;
  /** Drill into a model's detail page. Rows without a detail hide the chevron. */
  onOpenModel?: (model: ModelEntry) => void;
  /** Which rows can drill in — defaults to any row with an id. */
  canOpenModel?: (model: ModelEntry) => boolean;
  /** Shown in the toolbar for providers with user-managed model lists. */
  onAddModel?: () => void;
  loading?: boolean;
  error?: string | null;
  toolbar?: ReactNode;
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
  const openable = (m: ModelEntry) => Boolean(onOpenModel) && (canOpenModel ? canOpenModel(m) : Boolean(m.id));

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
    <section className="settings-group">
      <div className="settings-group-head">
        <h3 className="settings-group-title">{t("models.providerModels")}</h3>
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {loading
            ? t("models.loadingProviderModels")
            : `${models.length} ${t("models.freeModelCount")} · ${enabledCount} ${t("models.enabledCount")}`}
        </div>
      </div>

      {models.length > 0 || onAddModel ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, marginBottom: 8 }}>
          {models.length > 0 && (
            <input
              className="input-base"
              style={{ flex: 1, minWidth: 0 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("models.searchModelsPlaceholder")}
              aria-label={t("models.searchModelsPlaceholder")}
            />
          )}
          {toolbar}
          {(onToggleAllModels || onChangeModels) && models.length > 0 ? (
            <>
              <button
                type="button"
                className="btn-ghost btn-compact"
                disabled={busy || loading || enabledCount === models.length}
                onClick={() => runBulk(true)}
                title={t("models.enableAllHint")}
              >
                {bulkPending ? t("models.working") : t("models.enableAll")}
              </button>
              <button
                type="button"
                className="btn-ghost btn-compact"
                disabled={busy || loading || enabledCount === 0}
                onClick={() => runBulk(false)}
                title={t("models.disableAllHint")}
              >
                {bulkPending ? t("models.working") : t("models.disableAll")}
              </button>
            </>
          ) : null}
          {onAddModel && (
            <button type="button" className="btn-ghost btn-compact" onClick={onAddModel}>
              {t("models.addModel")}
            </button>
          )}
        </div>
      ) : null}

      {(error || toggleError) && (
        <div style={{ fontSize: 12, color: "var(--destructive)", marginBottom: 8 }}>{error ?? toggleError}</div>
      )}

      <div className="settings-card">
        {loading && models.length === 0 ? (
          <div className="settings-card-empty">{t("models.loadingProviderModels")}</div>
        ) : models.length === 0 ? (
          <div className="settings-card-empty">{t("models.noProviderModels")}</div>
        ) : visibleModels.length === 0 ? (
          <div className="settings-card-empty">{t("models.noSearchMatches")}</div>
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
                  padding: "9px var(--settings-card-pad-x)",
                  opacity: model.disabled ? 0.65 : 1,
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
                {openable(model) && (
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ "--icon-btn-size": "24px" } as React.CSSProperties}
                    onClick={() => onOpenModel?.(model)}
                    aria-label={label}
                    title={label}
                  >
                    <Icon icon={ChevronRight} size={14} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
