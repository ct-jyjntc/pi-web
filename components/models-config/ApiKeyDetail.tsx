"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";
import { Check as CheckIcon } from "lucide-react";
import { Field, SecretTextInput, DetailStrip } from "./form-fields";
import { ConfigModelsEnablePanel } from "./ConfigModelsEnablePanel";
import type { ApiKeyProvider, ProviderModelRow } from "./models-config-types";

export function ApiKeyDetail({
  provider,
  onRefresh,
  models,
  modelsLoading = false,
  modelsError = null,
  onToggleModel,
}: {
  provider: ApiKeyProvider;
  onRefresh: () => void;
  models: readonly ProviderModelRow[];
  modelsLoading?: boolean;
  modelsError?: string | null;
  onToggleModel?: (modelId: string, enabled: boolean) => void | Promise<void>;
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
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
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
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
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
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", minHeight: 0, overflow: "auto" }}>
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

      {error && <p style={{ margin: 0, fontSize: 12, color: "var(--destructive)" }}>{error}</p>}

      {provider.configured && (
        <button
          type="button"
          className="btn-ghost btn-compact"
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start",
            color: "var(--destructive)",
            borderColor: "var(--destructive-border)",
          }}
        >
          {removing ? t("modal.removing") : t("modal.disconnect")}
        </button>
      )}
      {provider.configured && (
        <ConfigModelsEnablePanel
          models={models}
          loading={modelsLoading}
          error={modelsError}
          onToggleModel={onToggleModel}
        />
      )}

    </div>
  );
}
