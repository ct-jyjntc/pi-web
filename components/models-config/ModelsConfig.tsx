"use client";

/**
 * Models / providers settings panel. Section UIs live in sibling modules.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale } from "@/hooks/useLocale";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ConfigPanelBackdrop, ConfigPanelShell } from "../ConfigPanelShell";
import {
  getFreeProvider,
  isFreeManagedProvider,
  mergeFreeModelEntries,
  type FreeModelEntry,
  type FreeProviderDefinition,
  type FreeProviderId,
} from "@/lib/free-providers";
import { Icon } from "../Icon";
import { Check as CheckIcon, Cpu } from "lucide-react";
import { normalizeModelCost } from "@/lib/model-cost";
import { navRowClass } from "./form-fields";
import {
  type ModelsJson,
  type ModelEntry,
  type ProviderEntry,
  type ProviderModelRow,
  type Selection,
  type OAuthProvider,
  type ApiKeyProvider,
  normalizeModelEntry,
} from "./models-config-types";
import { ProviderIcon } from "./provider-icons";
import { ProviderDetail } from "./ProviderDetail";
import { ModelDetail } from "./ModelDetail";
import { BuiltinModelDetail } from "./BuiltinModelDetail";
import { OAuthDetail } from "./OAuthDetail";
import { ApiKeyDetail } from "./ApiKeyDetail";
import { AddProviderPicker } from "./AddProviderPicker";
import { apiFetch } from "@/lib/api-transport";

export function ModelsConfig({
  onClose,
  onModelsChanged,
  embedded = false,
}: {
  onClose: () => void;
  /** Fired after a successful save so chat pickers can reload. */
  onModelsChanged?: () => void;
  /** When true, render as a full-height settings page panel (no modal chrome). */
  embedded?: boolean;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [freeBusyId, setFreeBusyId] = useState<FreeProviderId | null>(null);
  const [freeRefreshKey, setFreeRefreshKey] = useState<string | null>(null);
  const [freeRefreshError, setFreeRefreshError] = useState<string | null>(null);
  /** Built-in API-key / OAuth provider model catalogs for the unified settings UI. */
  const [builtinModelsByProvider, setBuiltinModelsByProvider] = useState<Record<string, ProviderModelRow[]>>({});
  const [builtinModelsLoading, setBuiltinModelsLoading] = useState<Record<string, boolean>>({});
  const [builtinModelsError, setBuiltinModelsError] = useState<Record<string, string | null>>({});
  // JSON snapshot of the last loaded/saved config; closing with unsaved
  // edits (config differing from this) asks for confirmation instead of
  // silently discarding them.
  const savedConfigJsonRef = useRef<string>(JSON.stringify({ providers: {} }));
  const configRef = useRef(config);
  configRef.current = config;

  const mergeFreeModels = useCallback((existing: ModelEntry[] | undefined, fetched: FreeModelEntry[]): ModelEntry[] => {
    return mergeFreeModelEntries(existing, fetched).map((entry) => normalizeModelEntry(entry));
  }, []);
  const buildFreeProviderEntry = useCallback((
    def: FreeProviderDefinition,
    provider: ProviderEntry | undefined,
    models: FreeModelEntry[],
  ): ProviderEntry => ({
    ...(provider ?? {}),
    managed: def.id,
    baseUrl: def.baseUrl,
    api: def.api,
    apiKey: def.apiKey,
    models: mergeFreeModels(provider?.models, models),
  }), [mergeFreeModels]);

  const fetchFreeModels = useCallback(async (def: FreeProviderDefinition) => {
    const res = await apiFetch(`/api/models-config/free-models?provider=${encodeURIComponent(def.id)}`);
    const d = await res.json() as {
      models?: FreeModelEntry[];
      error?: string;
    };
    if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
    if (!Array.isArray(d.models) || d.models.length === 0) {
      throw new Error("No free models returned");
    }
    return d.models;
  }, []);

  const addFreeProvider = useCallback(async (def: FreeProviderDefinition) => {
    const existing = config.providers?.[def.providerKey];
    if (existing) {
      if (isFreeManagedProvider(existing)) {
        setSelection({ type: "provider", name: def.providerKey });
        setPickerOpen(false);
        return;
      }
      window.alert(t("models.freeProviderKeyTaken", { key: def.providerKey }));
      return;
    }
    setFreeBusyId(def.id);
    setFreeRefreshError(null);
    try {
      const models = await fetchFreeModels(def);
      const entry = buildFreeProviderEntry(def, undefined, models);
      setConfig((prev) => ({
        ...prev,
        providers: { ...(prev.providers ?? {}), [def.providerKey]: entry },
      }));
      setSelection({ type: "provider", name: def.providerKey });
      setPickerOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setFreeRefreshError(message);
      // Keep picker open so the user can retry.
      window.alert(message);
    } finally {
      setFreeBusyId(null);
    }
  }, [config.providers, buildFreeProviderEntry, fetchFreeModels, t]);

  const refreshFreeProviderModels = useCallback(async (providerKey: string) => {
    const provider = config.providers?.[providerKey];
    const def = getFreeProvider(typeof provider?.managed === "string" ? provider.managed : undefined);
    if (!provider || !def) return;
    setFreeRefreshKey(providerKey);
    setFreeRefreshError(null);
    try {
      const models = await fetchFreeModels(def);
      setConfig((prev) => {
        const current = prev.providers?.[providerKey];
        if (!current) return prev;
        return {
          ...prev,
          providers: {
            ...(prev.providers ?? {}),
            [providerKey]: buildFreeProviderEntry(def, current, models),
          },
        };
      });
    } catch (e) {
      setFreeRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setFreeRefreshKey(null);
    }
  }, [config.providers, buildFreeProviderEntry, fetchFreeModels]);

  const loadOAuthProviders = useCallback(() => {
    apiFetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { providers: OAuthProvider[] }) => setOauthProviders(d.providers))
      .catch(() => {});
  }, []);

  const loadApiKeyProviders = useCallback(() => {
    apiFetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers: ApiKeyProvider[] }) => setApiKeyProviders(d.providers))
      .catch(() => {});
  }, []);

  // Dual-auth providers (e.g. Anthropic) appear in both lists; any auth change
  // must refresh both so the API-key row and OAuth row stay consistent.
  // Also bump modelsRefreshKey so the chat model picker drops credentials that
  // just logged out (or gains ones that just logged in) without waiting on the
  // heavy 60s models cache via a blind reload.
  const refreshAuthProviders = useCallback(() => {
    loadOAuthProviders();
    loadApiKeyProviders();
    onModelsChanged?.();
  }, [loadOAuthProviders, loadApiKeyProviders, onModelsChanged]);

  useEffect(() => {
    apiFetch("/api/models-config")
      .then(async (r) => {
        const d = await r.json() as ModelsJson & { error?: string; corrupt?: boolean };
        if (!r.ok) {
          // Corrupt models.json: keep editor empty/read-only of empty defaults but do not
          // mark it as a clean saved baseline the user can casually overwrite.
          setConfig({ providers: {} });
          savedConfigJsonRef.current = "";
          console.error("Failed to load models.json:", d.error ?? r.status);
          return;
        }
        const normalized = d.providers ? d : { ...d, providers: {} };
        setConfig(normalized);
        savedConfigJsonRef.current = JSON.stringify(normalized);
        const keys = Object.keys(normalized.providers ?? {});
        if (keys.length > 0) setSelection({ type: "provider", name: keys[0] });
      })
      .catch((e) => {
        console.error("Failed to load models.json:", e);
        setConfig({ providers: {} });
        savedConfigJsonRef.current = "";
      })
      .finally(() => setLoading(false));
    refreshAuthProviders();
  }, [refreshAuthProviders]);

  // Free provider official fields (context/reasoning/thinking map) come from
  // models.dev and can gain new keys over time. Re-sync once per settings open;
  // persist only when the merged models actually change.
  const freeMetadataBackfillRef = useRef(false);
    useEffect(() => {
      if (loading || freeMetadataBackfillRef.current) return;
      const providers = config.providers ?? {};
      const freeEntries = Object.entries(providers).filter(([, provider]) => isFreeManagedProvider(provider));
      freeMetadataBackfillRef.current = true;
      if (freeEntries.length === 0) return;

      void (async () => {
        const updates = new Map<string, { def: FreeProviderDefinition; models: FreeModelEntry[] }>();
        let firstError: string | null = null;

        // Parallel: each free provider hits an external /models (up to 15s). Sequential
        // backfill made opening Models settings feel multi-second with several free rows.
        const results = await Promise.all(
          freeEntries.map(async ([key, provider]) => {
            const def = getFreeProvider(typeof provider.managed === "string" ? provider.managed : undefined);
            if (!def) return null;
            try {
              const models = await fetchFreeModels(def);
              const merged = buildFreeProviderEntry(def, provider, models);
              if (JSON.stringify(merged.models) === JSON.stringify(provider.models ?? [])) return null;
              return { key, def, models } as const;
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              if (!firstError) firstError = message;
              return null;
            }
          }),
        );

        for (const row of results) {
          if (!row) continue;
          updates.set(row.key, { def: row.def, models: row.models });
        }
        if (firstError) setFreeRefreshError(firstError);
        if (updates.size === 0) return;

        const latestProviders = { ...(configRef.current.providers ?? {}) };
        for (const [key, update] of updates) {
          const current = latestProviders[key];
          if (!current || !isFreeManagedProvider(current)) continue;
          latestProviders[key] = buildFreeProviderEntry(update.def, current, update.models);
        }
        const payload = { ...configRef.current, providers: latestProviders };
        setConfig(payload);
        try {
          const res = await apiFetch("/api/models-config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) return;
          savedConfigJsonRef.current = JSON.stringify(payload);
          onModelsChanged?.();
        } catch {
          // Keep enriched editor state; user can save manually.
        }
      })();
    }, [loading, config, buildFreeProviderEntry, fetchFreeModels, onModelsChanged]);

    const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } } }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    setConfig((prev) => {
      const entries = Object.entries(prev.providers ?? {});
      const idx = entries.findIndex(([k]) => k === oldName);
      if (idx === -1) return prev;
      entries[idx] = [newName, entries[idx][1]];
      return { ...prev, providers: Object.fromEntries(entries) };
    });
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
  }, []);

  const deleteProvider = useCallback((name: string) => {
    setConfig((prev) => {
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    setConfig((prev) => {
      const remaining = Object.keys(prev.providers ?? {});
      setSelection(remaining.length > 0 ? { type: "provider", name: remaining[0] } : null);
      return prev;
    });
  }, []);

  const addModel = useCallback((providerName: string) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [
        ...(provider.models ?? []),
        { id: "", cost: normalizeModelCost(null) },
      ];
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
    setConfig((prev) => {
      const idx = (prev.providers?.[providerName]?.models?.length ?? 1) - 1;
      setSelection({ type: "model", providerName, index: idx });
      return prev;
    });
  }, []);


  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
    });
    setSelection({ type: "provider", name: providerName });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    // Normalize every model cost so blank prices become 0 and all four keys exist.
    const providers = { ...(config.providers ?? {}) };
    for (const [name, provider] of Object.entries(providers)) {
      if (!provider?.models?.length) continue;
      providers[name] = {
        ...provider,
        models: provider.models.map((m) => normalizeModelEntry(m)),
      };
    }
    const payload = { ...config, providers };
    try {
      const res = await apiFetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setSaveError(d.error ?? `HTTP ${res.status}`);
      else {
        setConfig(payload);
        savedConfigJsonRef.current = JSON.stringify(payload);
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onModelsChanged?.();
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [config, onModelsChanged]);

  const requestClose = useCallback(() => {
    if (JSON.stringify(config) !== savedConfigJsonRef.current) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [config, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmDiscard) { setConfirmDiscard(false); return; }
      if (pickerOpen) { setPickerOpen(false); return; }
      requestClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [confirmDiscard, pickerOpen, requestClose]);

  useEffect(() => {
    setFreeRefreshError(null);
  }, [selection]);

  const providers = Object.entries(config.providers ?? {});
  const activeOAuth = oauthProviders.filter((p) => p.loggedIn);
  // Dual-auth providers (e.g. kimi-coding) can be OAuth-logged-in and also
  // report as configured — keep a single sidebar row under Subscriptions.
  const activeOAuthIds = new Set(activeOAuth.map((p) => p.id));
  const activeApiKey = apiKeyProviders.filter((p) => p.configured && !activeOAuthIds.has(p.id));
  const activeBuiltinProviders = [
    ...activeOAuth.map((p) => ({ id: p.id, label: p.name, type: "oauth" as const })),
    ...activeApiKey.map((p) => ({ id: p.id, label: p.displayName, type: "apikey" as const })),
  ];

  const builtinProviderIdsKey = [
    ...activeOAuth.map((p) => p.id),
    ...activeApiKey.map((p) => p.id),
  ].join("\0");

  useEffect(() => {
    const ids = builtinProviderIdsKey ? builtinProviderIdsKey.split("\0").filter(Boolean) : [];
    if (ids.length === 0) {
      setBuiltinModelsByProvider({});
      setBuiltinModelsLoading({});
      setBuiltinModelsError({});
      return;
    }
    const loadingState = Object.fromEntries(ids.map((id) => [id, true]));
    const errorState = Object.fromEntries(ids.map((id) => [id, null]));
    setBuiltinModelsLoading(loadingState);
    setBuiltinModelsError(errorState);
    let cancelled = false;
    void (async () => {
      const next: Record<string, ProviderModelRow[]> = {};
      const nextErrors: Record<string, string | null> = {};
      await Promise.all(ids.map(async (id) => {
        try {
          const res = await apiFetch(`/api/models-config/provider-models?provider=${encodeURIComponent(id)}`);
          const data = await res.json() as { models?: ProviderModelRow[]; error?: string };
          if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
          next[id] = Array.isArray(data.models) ? data.models : [];
          nextErrors[id] = null;
        } catch (e) {
          next[id] = [];
          nextErrors[id] = e instanceof Error ? e.message : String(e);
        }
      }));
      if (cancelled) return;
      setBuiltinModelsByProvider(next);
      setBuiltinModelsLoading(Object.fromEntries(ids.map((id) => [id, false])));
      setBuiltinModelsError(nextErrors);
    })();
    return () => { cancelled = true; };
  }, [builtinProviderIdsKey]);


  const toggleBuiltinModel = useCallback(async (providerId: string, modelId: string, disabled: boolean) => {
      // Optimistic: free/custom toggles are pure local state. Built-in toggles used
      // to await a heavy ModelRuntime refresh before flipping the switch — felt laggy.
      const previous = builtinModelsByProvider[providerId] ?? [];
      setBuiltinModelsByProvider((prev) => ({
        ...prev,
        [providerId]: (prev[providerId] ?? []).map((m) => (
          m.id === modelId ? { ...m, disabled } : m
        )),
      }));
      try {
        const res = await apiFetch("/api/models-config/disabled-models", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: providerId, modelId, disabled }),
        });
        const data = await res.json() as { success?: boolean; error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        onModelsChanged?.();
      } catch (error) {
        setBuiltinModelsByProvider((prev) => ({
          ...prev,
          [providerId]: previous,
        }));
        throw error;
      }
    }, [builtinModelsByProvider, onModelsChanged]);

  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return (
        <OAuthDetail
          key={p.id}
          provider={p}
          onRefresh={refreshAuthProviders}
          models={builtinModelsByProvider[p.id] ?? []}
          modelsLoading={builtinModelsLoading[p.id] ?? false}
          modelsError={builtinModelsError[p.id] ?? null}
          onToggleModel={(modelId, enabled) => toggleBuiltinModel(p.id, modelId, !enabled)}
        />
      );
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return (
        <ApiKeyDetail
          key={p.id}
          provider={p}
          onRefresh={refreshAuthProviders}
          models={builtinModelsByProvider[p.id] ?? []}
          modelsLoading={builtinModelsLoading[p.id] ?? false}
          modelsError={builtinModelsError[p.id] ?? null}
          onToggleModel={(modelId, enabled) => toggleBuiltinModel(p.id, modelId, !enabled)}
        />
      );
    }
    if (selection.type === "builtin-model") {
      const models = builtinModelsByProvider[selection.providerId] ?? [];
      const model = models.find((m) => m.id === selection.modelId);
      if (!model) return null;
      return (
        <BuiltinModelDetail
          key={`${selection.providerId}/${selection.modelId}`}
          model={model}
          onModelPatch={async (patch) => {
            const res = await apiFetch("/api/models-config/model-overrides", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: selection.providerId,
                modelId: selection.modelId,
                ...patch,
              }),
            });
            const data = await res.json() as { success?: boolean; error?: string };
            if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
            setBuiltinModelsByProvider((prev) => ({
              ...prev,
              [selection.providerId]: (prev[selection.providerId] ?? []).map((m) => (
                m.id === selection.modelId ? { ...m, ...patch } : m
              )),
            }));
            onModelsChanged?.();
          }}
        />
      );
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => deleteProvider(selection.name)}
          onRefreshModels={isFreeManagedProvider(provider) ? () => void refreshFreeProviderModels(selection.name) : undefined}
          refreshingModels={freeRefreshKey === selection.name}
          refreshError={freeRefreshError}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
        managed={isFreeManagedProvider(provider)}
      />
    );
  })();

  const panel = (
      <ConfigPanelShell
        embedded={embedded}
        title={t("modal.models")}
        subtitle="~/.pi/agent/models.json"
        onClose={requestClose}
        closeAriaLabel={t("common.close")}
        style={embedded ? undefined : {
          width: isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "78vh",
          maxHeight: "calc(100dvh - 16px)",
        }}
      >
        <div className="modal-body" style={{ flexDirection: isMobile ? "column" : "row", flex: 1, minHeight: 0 }}>

          {/* Left: tree */}
          <div className="modal-sidebar" style={isMobile ? { width: "100%", maxHeight: "40vh" } : undefined}>
            <div className="modal-sidebar-scroll">
              {/* Active subscriptions + models */}
              {activeBuiltinProviders.map((p) => {
                const isSelected = p.type === "oauth"
                  ? selection?.type === "oauth" && selection.providerId === p.id
                  : selection?.type === "apikey" && selection.providerId === p.id;
                // Sidebar is navigation for enabled models; toggles live on provider details.
                const models = (builtinModelsByProvider[p.id] ?? []).filter((m) => !m.disabled);
                return (
                  <div key={p.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelection(p.type === "oauth"
                        ? { type: "oauth", providerId: p.id }
                        : { type: "apikey", providerId: p.id })}
                      className={navRowClass(isSelected)}
                    >
                      <ProviderIcon id={p.id} size={16} />
                      <span className={`modal-nav-label${isSelected ? " is-strong" : ""}`}>{p.label}</span>
                    </div>
                    {models.map((m) => {
                      const isModelSelected = selection?.type === "builtin-model"
                        && selection.providerId === p.id
                        && selection.modelId === m.id;
                      return (
                        <div
                          key={m.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelection({ type: "builtin-model", providerId: p.id, modelId: m.id })}
                          className={navRowClass(isModelSelected, true)}
                        >
                          <span className="modal-nav-label is-mono">{m.id}</span>
                          {m.reasoning && (
                            <span style={{ fontSize: 9, padding: "1px 5px", border: "1px solid var(--border)", color: "var(--text-dim)", borderRadius: "var(--radius-xs)", flexShrink: 0 }}>T</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Divider before custom providers, only when there are active managed providers */}
              {(activeOAuth.length > 0 || activeApiKey.length > 0) && providers.length > 0 && (
                <div style={{ margin: "4px 8px", borderTop: "1px solid var(--border)" }} />
              )}

              {/* Custom providers */}
              {loading ? (
                <div style={{ padding: "10px 10px", fontSize: 12, color: "var(--text-muted)" }}>{t("modal.loading")}</div>
              ) : providers.map(([pName, pData]) => {
                const isProviderSelected = selection?.type === "provider" && selection.name === pName;
                const models = pData.models ?? [];
                const freeDef = getFreeProvider(typeof pData.managed === "string" ? pData.managed : undefined);
                const managed = !!freeDef;
                const providerLabel = freeDef?.displayName ?? pName;
                return (
                  <div key={pName}>
                    {/* Provider row */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelection({ type: "provider", name: pName })}
                      className={navRowClass(isProviderSelected)}
                    >
                      {managed ? (
                        <ProviderIcon id={freeDef.iconId} size={14} />
                      ) : (
                        <Icon icon={Cpu} size={11} strokeWidth={2} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
                      )}
                      <span className={`modal-nav-label${managed ? "" : " is-mono"}${isProviderSelected ? " is-strong" : ""}`}>{providerLabel}</span>
                      {managed && (
                        <span className="settings-badge" style={{ flexShrink: 0 }}>{t("models.free")}</span>
                      )}
                    </div>

                    {/* Model rows — only enabled (or empty draft); enable more on provider page */}
                    {models.map((m, i) => {
                      if (m.disabled && m.id) return null;
                      const isModelSelected = selection?.type === "model" && selection.providerName === pName && selection.index === i;
                      return (
                        <div
                          key={i}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                          className={navRowClass(isModelSelected, true)}
                        >
                          <span className="modal-nav-label is-mono" style={{ color: m.id ? undefined : "var(--text-dim)" }}>
                            {m.id || t("models.newModel")}
                          </span>
                          {m.reasoning && (
                            <span style={{ fontSize: 9, padding: "1px 5px", border: "1px solid var(--border)", color: "var(--text-dim)", borderRadius: "var(--radius-xs)", flexShrink: 0 }}>T</span>
                          )}
                        </div>
                      );
                    })}

                    {/* Add model button — not for free/managed providers */}
                    {!managed && (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); addModel(pName); }}
                        className={navRowClass(false, true)}
                      >
                        <span className="modal-nav-label">{t("models.addModel")}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add provider — strip footer action */}
            <div className="modal-sidebar-footer">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="chrome-btn"
              >
                {t("modal.addProvider")}
              </button>
            </div>
          </div>

          {/* Right: detail */}
          <div className="modal-main">
            {loading ? null : detailContent ?? (
              <div className="modal-empty">{t("models.selectHint")}</div>
            )}
          </div>
        </div>

        {/* Footer — strip chrome */}
        <div className="modal-footer" style={embedded ? { borderRadius: 0 } : undefined}>
          {saveError && <span style={{ fontSize: 12, color: "var(--destructive)", flex: 1, minWidth: 0 }}>{saveError}</span>}
          {!embedded && (
            <button type="button" onClick={requestClose} className="chrome-btn">
              {t("common.cancel")}
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || savedOk}
            style={{
              minWidth: 88,
              background: savedOk ? "var(--success)" : undefined,
              animation: savedOk ? "saved-pop 0.45s ease" : undefined,
            }}
          >
            {savedOk && (
              <Icon
                icon={CheckIcon}
                size={14}
                strokeWidth={3}
                style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards", flexShrink: 0 }}
              />
            )}
            <span>{savedOk ? t("common.saved") : saving ? t("common.saving") : t("common.save")}</span>
          </button>
        </div>
      </ConfigPanelShell>
  );

  return (
    <>
    {embedded ? panel : (
      <ConfigPanelBackdrop onClose={requestClose}>
        {panel}
      </ConfigPanelBackdrop>
    )}
    {confirmDiscard && (
      <div
        className="modal-backdrop"
        style={{ zIndex: 1100 }}
        onClick={(e) => { if (e.target === e.currentTarget) setConfirmDiscard(false); }}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="modal-shell"
          style={{ width: "min(360px, calc(100vw - 32px))" }}
        >
          <div style={{ padding: "14px 16px", fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
            {t("models.unsavedChanges")}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={() => setConfirmDiscard(false)} className="chrome-btn">{t("common.cancel")}</button>
            <button type="button" onClick={() => { setConfirmDiscard(false); onClose(); }} className="btn-danger">{t("models.discardChanges")}</button>
          </div>
        </div>
      </div>
    )}
    {pickerOpen && (
      <AddProviderPicker
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        existingProviderKeys={Object.keys(config.providers ?? {})}
        onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
        onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
        onAddCustom={addCustomProvider}
        onAddFree={(def) => void addFreeProvider(def)}
        freeBusyId={freeBusyId}
        onClose={() => setPickerOpen(false)}
      />
    )}
    </>
  );
}
