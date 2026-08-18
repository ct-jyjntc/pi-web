"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";
import { Check as CheckIcon } from "lucide-react";
import { Field, SecretTextInput, DetailStrip } from "./form-fields";
import { ConfigModelsEnablePanel } from "./ConfigModelsEnablePanel";
import type { ApiKeyProvider, ProviderModelRow } from "./models-config-types";
import { apiFetch } from "@/lib/api-transport";

export function ApiKeyDetail({
  provider,
  onRefresh,
  models,
  modelsLoading = false,
  modelsError = null,
  onToggleModel,
  onToggleAllModels,
  onOpenModel,
  onRefreshModels,
  refreshingModels = false,
}: {
  provider: ApiKeyProvider;
  onRefresh: () => void;
  models: readonly ProviderModelRow[];
  modelsLoading?: boolean;
  modelsError?: string | null;
  onToggleModel?: (modelId: string, enabled: boolean) => void | Promise<void>;
  onToggleAllModels?: (enabled: boolean) => void | Promise<void>;
  /** Drill into a catalog model's detail page. */
  onOpenModel?: (modelId: string) => void;
  onRefreshModels?: () => void;
  refreshingModels?: boolean;
}) {
  const { t } = useLocale();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await apiFetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        setApiKey("");
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
        onRefreshModels?.();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh, onRefreshModels]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `HTTP ${res.status}`);
      else onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  return (
    <div>
      <DetailStrip
        title={t("models.apiKey")}
        actions={(
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.configured ? "var(--success)" : "var(--border)", display: "inline-block" }} />
            <span style={{ fontSize: 11, color: provider.configured ? "var(--success)" : "var(--text-dim)" }}>
              {provider.configured ? t("models.statusConfigured") : t("models.statusNotConfigured")}
            </span>
          </div>
        )}
      />

      <div className="settings-group">
        <div className="settings-card">
          <Field label={t("models.apiKey")}>
            <div style={{ display: "flex", gap: 6 }}>
              <SecretTextInput
                value={apiKey}
                onChange={setApiKey}
                onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleSave(); }}
                placeholder={provider.configured ? t("models.enterNewKey") : "sk-…"}
                style={{ flex: 1 }}
                autoComplete="off"
                spellCheck={false}
                mono
              />
              <button
                type="button"
                className="btn-primary btn-compact"
                onClick={handleSave}
                disabled={saving || !apiKey.trim() || savedOk}
                style={{
                  flexShrink: 0,
                  background: savedOk ? "var(--success)" : undefined,
                  animation: savedOk ? "saved-pop 0.45s ease" : undefined,
                }}
              >
                {savedOk && (
                  <Icon icon={CheckIcon} size={12} strokeWidth={3} />
                )}
                {savedOk ? t("common.saved") : saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </Field>

          {error && (
            <div className="settings-card-empty" style={{ color: "var(--destructive)" }}>{error}</div>
          )}

          {provider.configured && (
            <div className="settings-card-footer">
              <button
                type="button"
                className="btn-ghost btn-compact"
                onClick={handleRemove}
                disabled={removing}
                style={{
                  color: "var(--destructive)",
                  borderColor: "var(--destructive-border)",
                }}
              >
                {removing ? t("modal.removing") : t("modal.disconnect")}
              </button>
            </div>
          )}
        </div>
      </div>

      {provider.configured && (
        <ConfigModelsEnablePanel
          models={models}
          loading={modelsLoading && models.length === 0}
          error={modelsError}
          onToggleModel={onToggleModel}
          onToggleAllModels={onToggleAllModels}
          onOpenModel={onOpenModel ? (m) => { if (m.id) onOpenModel(m.id); } : undefined}
          toolbar={onRefreshModels ? (
            <button
              type="button"
              className="btn-ghost btn-compact"
              onClick={onRefreshModels}
              disabled={refreshingModels || modelsLoading}
              title={t("models.refreshModels")}
            >
              {refreshingModels || modelsLoading
                ? t("models.refreshingModels")
                : t("models.refreshModels")}
            </button>
          ) : null}
        />
      )}

    </div>
  );
}
