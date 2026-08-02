"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { SettingsToggle } from "../SettingsToggle";
import { type ProviderModelRow } from "./models-config-types";

export function ProviderModelsPanel({
  providerId,
  active,
  onModelsChanged,
}: {
  providerId: string;
  /** Only load when the provider is configured / logged in. */
  active: boolean;
  onModelsChanged?: () => void;
}) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ProviderModelRow[]>([]);
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!active) {
      setModels([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/models-config/provider-models?provider=${encodeURIComponent(providerId)}`);
      const data = await res.json() as { models?: ProviderModelRow[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setModels(Array.isArray(data.models) ? data.models : []);
    } catch (e) {
      setModels([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [active, providerId]);

  useEffect(() => {
    setSearch("");
    void load();
  }, [load]);

  const toggle = useCallback(async (model: ProviderModelRow, enabled: boolean) => {
    setPendingId(model.id);
    setError(null);
    // Optimistic update
    setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, disabled: !enabled } : m)));
    try {
      const res = await fetch("/api/models-config/provider-models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, modelId: model.id, disabled: !enabled }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      onModelsChanged?.();
    } catch (e) {
      // Revert
      setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, disabled: model.disabled } : m)));
      setError(e instanceof Error ? e.message : t("models.providerModelToggleError"));
    } finally {
      setPendingId(null);
    }
  }, [onModelsChanged, providerId, t]);

  if (!active) return null;

  const q = search.trim().toLowerCase();
  const filtered = !q
    ? models
    : models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  const enabledCount = models.filter((m) => !m.disabled).length;

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        paddingTop: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flex: 1,
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("models.providerModels")}</div>
        {!loading && models.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {models.length} {t("models.freeModelCount")}
            {" · "}
            {enabledCount} {t("models.enabledCount")}
          </div>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45, flexShrink: 0 }}>
        {t("models.providerModelsHint")}
      </p>

      {models.length > 8 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("models.searchProviderModels")}
          className="input-base"
          style={{ fontSize: 12, flexShrink: 0 }}
        />
      )}

      {loading && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>{t("models.loadingProviderModels")}</div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: "var(--destructive)", flexShrink: 0 }}>{error}</div>
      )}

      {!loading && !error && models.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>{t("models.noProviderModels")}</div>
      )}

      {!loading && filtered.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg)",
          }}
        >
          {filtered.map((model) => (
            <div
              key={model.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderBottom: "1px solid var(--border)",
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
                  {model.name}
                </div>
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
                  {model.supportsImage ? " · img" : ""}
                </div>
              </div>
              <span style={{ fontSize: 10, color: model.disabled ? "var(--text-dim)" : "var(--text-muted)", flexShrink: 0 }}>
                {model.disabled ? t("models.disabled") : t("models.enabled")}
              </span>
              <SettingsToggle
                enabled={!model.disabled}
                loading={pendingId === model.id}
                title={model.disabled ? t("models.enableHint") : t("models.disableHint")}
                onChange={(on) => void toggle(model, on)}
              />
            </div>
          ))}
        </div>
      )}

      {!loading && models.length > 0 && filtered.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("models.noProvidersMatch")}</div>
      )}
    </div>
  );
}

// ── OAuth detail ──────────────────────────────────────────────────────────────


