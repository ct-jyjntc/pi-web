"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { getFreeProvider } from "@/lib/free-providers";
import type { DiscoveredModel } from "@/lib/model-discovery";
import {
  Field, TextInput, SecretTextInput, Select, DetailStrip,
} from "./form-fields";
import {
  API_OPTIONS,
  type ModelDiscoveryState,
  type ProviderEntry,
} from "./models-config-types";

export function ProviderDetail({
  name, provider, onChange, onRename, onDelete, onAddModels, onRefreshModels, refreshingModels, refreshError,
}: {
  name: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onRename: (n: string) => void; onDelete: () => void;
  onAddModels: (models: DiscoveredModel[]) => void;
  onRefreshModels?: () => void;
  refreshingModels?: boolean;
  refreshError?: string | null;
}) {
  const { t } = useLocale();
  const freeDef = getFreeProvider(typeof provider.managed === "string" ? provider.managed : undefined);
  const managed = !!freeDef;
  const [editingName, setEditingName] = useState(name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [discoveryState, setDiscoveryState] = useState<ModelDiscoveryState>({ phase: "idle" });
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const discoveryRequestIdRef = useRef(0);
  const selectShownRef = useRef<HTMLInputElement>(null);
  useEffect(() => setEditingName(name), [name]);
  useEffect(() => setConfirmDelete(false), [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!managed && !provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api, managed]);

  useEffect(() => {
    discoveryRequestIdRef.current += 1;
    setDiscoveryState({ phase: "idle" });
    setDiscoveryQuery("");
    setSelectedModelIds([]);
  }, [name, provider.baseUrl, provider.api, provider.apiKey]);

  const handleDiscoverModels = useCallback(async () => {
    if (managed || !provider.baseUrl?.trim() || discoveryState.phase === "loading") return;
    const requestId = ++discoveryRequestIdRef.current;
    setDiscoveryState({ phase: "loading" });
    setSelectedModelIds([]);
    try {
      const res = await fetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: name, provider: { ...provider, models: undefined } }),
      });
      const data = await res.json() as { models?: DiscoveredModel[]; endpoint?: string; error?: string };
      if (requestId !== discoveryRequestIdRef.current) return;
      if (!res.ok || data.error || !data.models) {
        setDiscoveryState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setDiscoveryState({ phase: "success", models: data.models, endpoint: data.endpoint ?? provider.baseUrl });
    } catch (error) {
      if (requestId !== discoveryRequestIdRef.current) return;
      setDiscoveryState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [discoveryState.phase, managed, name, provider]);

  const existingModelIds = new Set((provider.models ?? []).map((model) => model.id));
  const discoveredModels = discoveryState.phase === "success" ? discoveryState.models : [];
  const normalizedDiscoveryQuery = discoveryQuery.trim().toLocaleLowerCase();
  const filteredDiscoveredModels = discoveredModels.filter((model) => !normalizedDiscoveryQuery
    || model.id.toLocaleLowerCase().includes(normalizedDiscoveryQuery)
    || model.name?.toLocaleLowerCase().includes(normalizedDiscoveryQuery));
  const shownDiscoveredModels = filteredDiscoveredModels.slice(0, 300);
  const selectableShownIds = shownDiscoveredModels
    .filter((model) => !existingModelIds.has(model.id))
    .map((model) => model.id);
  const selectedCount = selectedModelIds.filter((id) => !existingModelIds.has(id)).length;
  const allShownSelected = selectableShownIds.length > 0
    && selectableShownIds.every((id) => selectedModelIds.includes(id));
  const someShownSelected = !allShownSelected
    && selectableShownIds.some((id) => selectedModelIds.includes(id));

  useEffect(() => {
    if (selectShownRef.current) selectShownRef.current.indeterminate = someShownSelected;
  }, [someShownSelected]);

  const toggleDiscoveredModel = (id: string) => {
    setSelectedModelIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  };

  const toggleShownModels = () => {
    const shownIds = new Set(selectableShownIds);
    setSelectedModelIds((current) => allShownSelected
      ? current.filter((id) => !shownIds.has(id))
      : Array.from(new Set([...current, ...selectableShownIds])));
  };

  const addSelectedModels = () => {
    if (discoveryState.phase !== "success") return;
    const selected = new Set(selectedModelIds);
    const additions = discoveryState.models.filter((model) => selected.has(model.id) && !existingModelIds.has(model.id));
    if (additions.length === 0) return;
    onAddModels(additions);
    setSelectedModelIds([]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0, overflow: "auto" }}>
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

      {managed && freeDef && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
            lineHeight: 1.45,
          }}
        >
          {t("models.freeProviderNotice")}
        </div>
      )}

      {refreshError && (
        <div style={{ fontSize: 12, color: "var(--destructive)" }}>{refreshError}</div>
      )}

      <Field label={t("models.providerName")}>
        {managed ? (
          <div className="input-base" style={{ opacity: 0.85, cursor: "default" }}>
            {freeDef?.displayName ?? name}
          </div>
        ) : (
          <>
            <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
            {editingName !== name && editingName.trim() && (
              <button type="button" className="btn-primary btn-compact" onClick={() => onRename(editingName.trim())} style={{ marginTop: 6, alignSelf: "flex-start" }}>
                {t("common.rename")}
              </button>
            )}
          </>
        )}
      </Field>

      <Field label={t("models.baseUrl")}>
        {managed ? (
          <div className="input-base input-mono" style={{ opacity: 0.85, cursor: "default" }}>
            {provider.baseUrl || freeDef?.baseUrl}
          </div>
        ) : (
          <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
            placeholder="https://api.example.com/v1" mono />
        )}
      </Field>

      {!managed && (
        <Field label={t("models.apiKey")}>
          <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
            placeholder={t("models.apiKeyPlaceholder")} mono />
          <span style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
            {t("models.apiKeyHint")}
          </span>
        </Field>
      )}

      <Field label={t("models.api")}>
        {managed ? (
          <div className="input-base input-mono" style={{ opacity: 0.85, cursor: "default" }}>
            {provider.api || freeDef?.api}
          </div>
        ) : (
          <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
        )}
      </Field>

      {!managed && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {discoveryState.phase !== "success" && (
            <button
              type="button"
              className="btn-ghost btn-compact"
              onClick={() => void handleDiscoverModels()}
              disabled={!provider.baseUrl?.trim() || discoveryState.phase === "loading"}
              style={{ alignSelf: "flex-start" }}
            >
              {discoveryState.phase === "loading" ? t("models.discoveryFetching") : t("models.discoveryFetch")}
            </button>
          )}

          {discoveryState.phase === "error" && (
            <div style={{
              padding: "7px 9px",
              border: "1px solid var(--destructive-border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--destructive-bg)",
              color: "var(--destructive)",
              fontSize: 11,
              lineHeight: 1.4,
            }}>
              {discoveryState.message}
            </div>
          )}

          {discoveryState.phase === "success" && (
            <>
              <input
                value={discoveryQuery}
                onChange={(event) => setDiscoveryQuery(event.target.value)}
                placeholder={t("models.discoveryFilterPlaceholder", { count: discoveryState.models.length })}
                aria-label={t("models.discoveryFilter")}
                className="input-base"
                style={{ width: "100%", minWidth: 0, borderRadius: 0 }}
              />

              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", background: "var(--bg-panel)" }}>
                <label
                  style={{
                    minHeight: 32, padding: "5px 9px", display: "flex", alignItems: "center", gap: 8,
                    position: "sticky", top: 0, zIndex: 1, borderBottom: "1px solid var(--border)",
                    background: "var(--bg)", cursor: selectableShownIds.length ? "pointer" : "default",
                    color: "var(--text-muted)", fontSize: 10, fontWeight: 600,
                  }}
                >
                  <input
                    ref={selectShownRef}
                    type="checkbox"
                    checked={allShownSelected}
                    disabled={selectableShownIds.length === 0}
                    onChange={toggleShownModels}
                    style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                  />
                  {t("models.discoverySelectShown")}
                </label>
                {shownDiscoveredModels.length === 0 ? (
                  <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 11 }}>{t("models.discoveryNoMatches")}</div>
                ) : shownDiscoveredModels.map((model, index) => {
                  const alreadyAdded = existingModelIds.has(model.id);
                  const checked = selectedModelIds.includes(model.id);
                  return (
                    <label
                      key={model.id}
                      style={{
                        minHeight: 36, padding: "6px 9px", display: "flex", alignItems: "center", gap: 8,
                        borderTop: index === 0 ? "none" : "1px solid var(--border)", cursor: alreadyAdded ? "default" : "pointer",
                        opacity: alreadyAdded ? 0.65 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked || alreadyAdded}
                        disabled={alreadyAdded}
                        onChange={() => toggleDiscoveredModel(model.id)}
                        style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                      />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 11 }}>{model.name ?? model.id}</span>
                        {model.name && <code style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)" }}>{model.id}</code>}
                      </span>
                      {alreadyAdded && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{t("models.discoveryAdded")}</span>}
                    </label>
                  );
                })}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span title={discoveryState.endpoint} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10 }}>
                  {filteredDiscoveredModels.length > shownDiscoveredModels.length
                    ? t("models.discoveryShowing", { shown: shownDiscoveredModels.length, total: filteredDiscoveredModels.length })
                    : t("models.discoveryFetched", { count: discoveryState.models.length })}
                </span>
                <button
                  type="button"
                  className={selectedCount ? "btn-primary btn-compact" : "btn-ghost btn-compact"}
                  onClick={addSelectedModels}
                  disabled={selectedCount === 0}
                >
                  {selectedCount
                    ? t("models.discoveryAddSelectedCount", { count: selectedCount })
                    : t("models.discoveryAddSelected")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {managed && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {(provider.models ?? []).length} {t("models.freeModelCount")}
          {" · "}
          {(provider.models ?? []).filter((m) => !m.disabled).length} {t("models.enabledCount")}
        </div>
      )}
    </div>
  );
}

// ── ThinkingLevelMap editor ───────────────────────────────────────────────────


