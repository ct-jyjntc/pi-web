"use client";

/**
 * Provider settings: connection card + enable-list group below.
 * Custom providers with Base URL auto-list /models (no import UI).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { getFreeProvider } from "@/lib/free-providers";

import type { DiscoveredModel } from "@/lib/model-discovery";
import {
  Field, TextInput, SecretTextInput, Select, DetailStrip,
} from "./form-fields";
import { ConfigModelsEnablePanel } from "./ConfigModelsEnablePanel";
import {
  API_OPTIONS,
  normalizeModelEntry,
  type ModelEntry,
  type ProviderEntry,
} from "./models-config-types";
import { apiFetch } from "@/lib/api-transport";

export function ProviderDetail({
  name, provider, onChange, onRename, onDelete, onRefreshModels, refreshingModels, refreshError,
  onOpenModel, onAddModel,
}: {
  name: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onRename: (n: string) => void; onDelete: () => void;
  onRefreshModels?: () => void;
  refreshingModels?: boolean;
  refreshError?: string | null;
  /** Drill into a persisted model's detail page (index into provider.models). */
  onOpenModel?: (index: number) => void;
  onAddModel?: () => void;
}) {
  const { t } = useLocale();
  const freeDef = getFreeProvider(typeof provider.managed === "string" ? provider.managed : undefined);
  const managed = !!freeDef;
  const [editingName, setEditingName] = useState(name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [remoteModels, setRemoteModels] = useState<DiscoveredModel[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const remoteRequestIdRef = useRef(0);

  useEffect(() => setEditingName(name), [name]);
  useEffect(() => setConfirmDelete(false), [name]);

  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!managed && !provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api, managed]);

  const fetchRemoteModels = useCallback(async () => {
    if (managed || !provider.baseUrl?.trim()) return;
    const requestId = ++remoteRequestIdRef.current;
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      const res = await apiFetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerName: name,
          provider: {
            baseUrl: provider.baseUrl,
            api: provider.api,
            apiKey: provider.apiKey,
            headers: provider.headers,
            compat: provider.compat,
          },
        }),
      });
      const data = await res.json() as { models?: DiscoveredModel[]; error?: string };
      if (requestId !== remoteRequestIdRef.current) return;
      if (!res.ok || data.error || !data.models) {
        setRemoteModels([]);
        setRemoteError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setRemoteModels(data.models);
      setRemoteError(null);
    } catch (error) {
      if (requestId !== remoteRequestIdRef.current) return;
      setRemoteModels([]);
      setRemoteError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === remoteRequestIdRef.current) setRemoteLoading(false);
    }
  }, [managed, name, provider.api, provider.apiKey, provider.baseUrl, provider.compat, provider.headers]);

  useEffect(() => {
    if (managed || !provider.baseUrl?.trim()) {
      remoteRequestIdRef.current += 1;
      setRemoteModels([]);
      setRemoteError(null);
      setRemoteLoading(false);
      return;
    }
    // First-time only: if models.json already has a list, never auto-hit /discover.
    // User refreshes via the button (same as free / built-in providers).
    const hasLocalModels = (provider.models?.length ?? 0) > 0;
    if (hasLocalModels) {
      setRemoteModels([]);
      setRemoteError(null);
      setRemoteLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchRemoteModels();
    }, 320);
    return () => {
      window.clearTimeout(timer);
      remoteRequestIdRef.current += 1;
    };
  }, [fetchRemoteModels, managed, provider.baseUrl, provider.models?.length]);

  const enableModels: ModelEntry[] = (() => {
    const configured = provider.models ?? [];
    if (managed || remoteModels.length === 0) return configured;

    const byId = new Map<string, ModelEntry>();
    for (const model of configured) {
      if (model.id) byId.set(model.id, model);
    }
    for (const remote of remoteModels) {
      if (!remote.id || byId.has(remote.id)) continue;
      byId.set(remote.id, normalizeModelEntry({
        id: remote.id,
        name: remote.name || remote.id,
        disabled: true,
      }));
    }
    const configuredIds = new Set(configured.map((m) => m.id).filter(Boolean));
    const ordered: ModelEntry[] = [...configured];
    for (const remote of remoteModels) {
      if (!remote.id || configuredIds.has(remote.id)) continue;
      const entry = byId.get(remote.id);
      if (entry) ordered.push(entry);
    }
    return ordered;
  })();

  const handleEnableModelsChange = useCallback((next: ModelEntry[]) => {
    const previousIds = new Set((provider.models ?? []).map((m) => m.id).filter(Boolean) as string[]);
    const persisted = next.filter((m) => {
      if (!m.id) return true;
      if (!m.disabled) return true;
      return previousIds.has(m.id);
    }).map((m) => normalizeModelEntry(m));
    onChange({ ...provider, models: persisted.length ? persisted : undefined });
  }, [onChange, provider]);

  // Synthetic rows discovered from /models have no persisted index — only
  // configured models can drill into ModelDetail.
  const configuredIndexOf = useCallback((m: ModelEntry) => (
    (provider.models ?? []).findIndex((x) => (x.id ? x.id === m.id : x === m))
  ), [provider.models]);

  return (
    <div>
      <DetailStrip
        title={managed ? t("models.freeProvider") : t("models.provider")}
        actions={confirmDelete ? (
          <>
            <span style={{ fontSize: 11, color: "var(--destructive)" }}>{t("models.confirmDeleteProvider")}</span>
            <button type="button" className="btn-danger btn-compact" onClick={onDelete}>{t("common.delete")}</button>
            <button type="button" className="btn-ghost btn-compact" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</button>
          </>
        ) : (
          <>
            {managed && onRefreshModels && (
              <button
                type="button"
                className="btn-ghost btn-compact"
                onClick={onRefreshModels}
                disabled={refreshingModels}
                title={t("models.refreshFreeModels")}
              >
                {refreshingModels ? t("models.refreshingModels") : t("models.refreshModels")}
              </button>
            )}
            {!managed && provider.baseUrl?.trim() && (
              <button
                type="button"
                className="btn-ghost btn-compact"
                onClick={() => void fetchRemoteModels()}
                disabled={remoteLoading}
                title={t("models.refreshModels")}
              >
                {remoteLoading ? t("models.refreshingModels") : t("models.refreshModels")}
              </button>
            )}
            <button
              type="button"
              className="btn-ghost btn-compact"
              onClick={() => setConfirmDelete(true)}
              style={{ color: "var(--destructive)", borderColor: "var(--destructive-border)" }}
            >
              {t("common.delete")}
            </button>
          </>
        )}
      />

      {refreshError && (
        <div style={{ fontSize: 12, color: "var(--destructive)", margin: "0 0 8px" }}>{refreshError}</div>
      )}

      <div className="settings-group">
        <div className="settings-card">
          <Field label={t("models.providerName")}>
            {managed ? (
              <div className="input-base" style={{ opacity: 0.85, cursor: "default" }}>
                {freeDef?.displayName ?? name}
              </div>
            ) : (
              <>
                <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
                {editingName !== name && editingName.trim() && (
                  <button type="button" className="btn-primary btn-compact" onClick={() => onRename(editingName.trim())} style={{ marginTop: 4, alignSelf: "flex-start" }}>
                    {t("common.rename")}
                  </button>
                )}
              </>
            )}
          </Field>
          <Field label={t("models.api")}>
            {managed ? (
              <div className="input-base input-mono" style={{ opacity: 0.85, cursor: "default" }}>
                {provider.api || freeDef?.api}
              </div>
            ) : (
              <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
            )}
          </Field>

          <Field label={t("models.baseUrl")}>
            {managed ? (
              <div className="input-base input-mono" style={{ opacity: 0.85, cursor: "default" }}>
                {provider.baseUrl || freeDef?.baseUrl}
              </div>
            ) : (
              <TextInput
                value={provider.baseUrl ?? ""}
                onChange={(v) => set("baseUrl", v || undefined)}
                placeholder="https://api.example.com/v1"
                mono
              />
            )}
          </Field>

          {!managed && (
            <Field label={t("models.apiKey")}>
              <SecretTextInput
                value={provider.apiKey ?? ""}
                onChange={(v) => set("apiKey", v || undefined)}
                placeholder={t("models.apiKeyPlaceholder")}
                mono
              />
            </Field>
          )}

          {!managed && (
            <Field label={t("models.customHeaders")}>
              <textarea
                className="input-base input-mono"
                rows={3}
                value={Object.entries(provider.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n")}
                onChange={(e) => {
                  const headers: Record<string, string> = {};
                  for (const line of e.target.value.split("\n")) {
                    const idx = line.indexOf(":");
                    if (idx <= 0) continue;
                    const key = line.slice(0, idx).trim();
                    const value = line.slice(idx + 1).trim();
                    if (key) headers[key] = value;
                  }
                  set("headers", Object.keys(headers).length ? headers : undefined);
                }}
                placeholder="X-Api-Extra: value"
              />
            </Field>
          )}

          {/* SDK key is compat.supportsDeveloperRole; older builds wrote dead
              keys (developerRole/useDeveloperRole) that PUT now strips on save.
              Unchecked writes explicit false so the choice beats URL auto-detect. */}
          {!managed && (!provider.api || provider.api === "openai-completions" || provider.api === "openai-responses") && (
            <div className="settings-row">
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={provider.compat?.supportsDeveloperRole === true}
                  onChange={(e) => {
                    set("compat", { ...(provider.compat ?? {}), supportsDeveloperRole: e.target.checked });
                  }}
                />
                {t("models.developerRole")}
              </label>
            </div>
          )}
        </div>
      </div>

      <ConfigModelsEnablePanel
        models={enableModels}
        onChangeModels={handleEnableModelsChange}
        loading={remoteLoading && !managed}
        error={!managed ? remoteError : null}
        onOpenModel={onOpenModel ? (m) => {
          const index = configuredIndexOf(m);
          if (index >= 0) onOpenModel(index);
        } : undefined}
        canOpenModel={(m) => configuredIndexOf(m) >= 0}
        onAddModel={!managed ? onAddModel : undefined}
      />
    </div>
  );
}
