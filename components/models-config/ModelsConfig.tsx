"use client";



/**

 * Models / providers settings panel. Section UIs live in sibling modules.

 */

import { useState, useEffect, useCallback, useRef } from "react";

import { useLocale } from "@/hooks/useLocale";

import {

  getFreeProvider,

  isFreeManagedProvider,

  mergeFreeModelEntries,

  type FreeModelEntry,

  type FreeProviderDefinition,

  type FreeProviderId,

} from "@/lib/free-providers";

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



import { ProviderDetail } from "./ProviderDetail";

import { ModelDetail } from "./ModelDetail";

import { BuiltinModelDetail } from "./BuiltinModelDetail";

import { OAuthDetail } from "./OAuthDetail";

import { ApiKeyDetail } from "./ApiKeyDetail";

import { AddProviderPicker } from "./AddProviderPicker";
import { ModelsSettingsView } from "./ModelsSettingsView";

import { loadBuiltinProviderModelCatalog } from "./load-builtin-provider-models";

import { apiFetch } from "@/lib/api-transport";

import { commitProvider, removeProvider } from "@/lib/models-config-save";



// Module-scope last-known auth provider lists. Settings sections unmount this
// panel on switch; seeding from cache keeps the subscription rows (and their
// icons) from popping in only after the IPC round-trip on every re-entry.
// Mutations (login/logout/api-key) go through this module, so the cache is
// always rewritten when the lists change.
let oauthProvidersCache: OAuthProvider[] | null = null;

let apiKeyProvidersCache: ApiKeyProvider[] | null = null;

// Same for built-in model catalogs — keeps the "N models · M enabled" counts
// stable across remounts (the disk-cache reload is fast but still async).
let builtinModelsCache: Record<string, ProviderModelRow[]> | null = null;

export function ModelsConfig({

  onClose,

  onModelsChanged,

}: {

  onClose: () => void;

  /** Fired after a successful save so chat pickers can reload. */

  onModelsChanged?: () => void;

}) {

  const { t } = useLocale();

  const [config, setConfig] = useState<ModelsJson>({ providers: {} });

  const [loading, setLoading] = useState(true);

  const [saveError, setSaveError] = useState<string | null>(null);

  const [selection, setSelection] = useState<Selection | null>(null);

  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>(() => oauthProvidersCache ?? []);

  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>(() => apiKeyProvidersCache ?? []);

  const [pickerOpen, setPickerOpen] = useState(false);

  const [freeBusyId, setFreeBusyId] = useState<FreeProviderId | null>(null);

  const [freeRefreshKey, setFreeRefreshKey] = useState<string | null>(null);

  const [freeRefreshError, setFreeRefreshError] = useState<string | null>(null);

  /** Built-in API-key / OAuth provider model catalogs for the unified settings UI. */

  const [builtinModelsByProvider, setBuiltinModelsByProvider] = useState<Record<string, ProviderModelRow[]>>(() => builtinModelsCache ?? {});

  // Single write-through point for the module-scope catalog cache.
  useEffect(() => {
    builtinModelsCache = builtinModelsByProvider;
  }, [builtinModelsByProvider]);

  const [builtinModelsLoading, setBuiltinModelsLoading] = useState<Record<string, boolean>>({});

  const [builtinModelsError, setBuiltinModelsError] = useState<Record<string, string | null>>({});

  const configRef = useRef(config);

  /** Bumps when the built-in catalog load effect restarts so stale finally blocks no-op. */
  const builtinModelsLoadGenRef = useRef(0);

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

      .then((d: { providers?: OAuthProvider[] }) => {
        if (Array.isArray(d.providers)) {
          oauthProvidersCache = d.providers;
          setOauthProviders(d.providers);
        }
      })

      .catch(() => {});

  }, []);



  const loadApiKeyProviders = useCallback(() => {

    apiFetch("/api/auth/all-providers")

      .then((r) => r.json())

      .then((d: { providers?: ApiKeyProvider[] }) => {
        if (Array.isArray(d.providers)) {
          apiKeyProvidersCache = d.providers;
          setApiKeyProviders(d.providers);
        }
      })

      .catch(() => {});

  }, []);



  // Dual-auth providers (e.g. Anthropic) appear in both lists; any auth change

  // must refresh both so the API-key row and OAuth row stay consistent.

  // Do NOT call onModelsChanged here — this runs on mount and any parent re-render

  // if onModelsChanged is unstable; that remounts the picker load loop and used

  // to reset selection to the first provider.

  const refreshAuthProviders = useCallback(() => {

    loadOAuthProviders();

    loadApiKeyProviders();

  }, [loadOAuthProviders, loadApiKeyProviders]);



  // After real auth mutations (login/logout/api-key), refresh lists + chat catalog.

  const handleAuthMutation = useCallback(() => {

    refreshAuthProviders();

    onModelsChanged?.();

  }, [refreshAuthProviders, onModelsChanged]);



  useEffect(() => {

    apiFetch("/api/models-config")

      .then(async (r) => {

        const d = await r.json() as ModelsJson & { error?: string; corrupt?: boolean };

        if (!r.ok) {

          // Corrupt models.json: keep editor empty/read-only of empty defaults but do not

          // mark it as a clean saved baseline the user can casually overwrite.

          setConfig({ providers: {} });

          console.error("Failed to load models.json:", d.error ?? r.status);

          return;

        }

        const normalized = d.providers ? d : { ...d, providers: {} };

        setConfig(normalized);

        // List view is the landing state — never auto-select a provider or
        // stomp an in-progress edit by re-seeding selection here.

      })

      .catch((e) => {

        console.error("Failed to load models.json:", e);

        setConfig({ providers: {} });

      })

      .finally(() => setLoading(false));

    refreshAuthProviders();

  }, [refreshAuthProviders]);



  // Free providers: no auto re-fetch on Models open. models.json is the list;

  // user clicks "Refresh models" (or first add) for a live pull.



  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    const entry: ProviderEntry = { api: "openai-completions" };
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: entry } }));
    setSelection({ type: "provider", name: finalName });
    void commitProvider(finalName, { ...entry })
      .then(() => { setSaveError(null); onModelsChanged?.(); })
      .catch((e) => {
        setSaveError(e instanceof Error ? e.message : String(e));
        setConfig((prev) => {
          const providers = { ...(prev.providers ?? {}) };
          delete providers[finalName];
          return { ...prev, providers };
        });
      });
  }, [config.providers, onModelsChanged]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    const previous = config.providers?.[name];
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
    void commitProvider(name, { ...p })
      .then(() => { setSaveError(null); onModelsChanged?.(); })
      .catch((e) => {
        setSaveError(e instanceof Error ? e.message : String(e));
        setConfig((prev) => {
          if (previous === undefined) {
            const providers = { ...(prev.providers ?? {}) };
            delete providers[name];
            return { ...prev, providers };
          }
          return { ...prev, providers: { ...(prev.providers ?? {}), [name]: previous } };
        });
      });
  }, [config.providers, onModelsChanged]);

  const renameProvider = useCallback(async (oldName: string, newName: string) => {
    const entry = config.providers?.[oldName];
    if (!entry) return;
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
    try {
      await removeProvider(oldName);
      await commitProvider(newName, { ...entry });
      setSaveError(null);
      onModelsChanged?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setConfig((prev) => {
        const entries = Object.entries(prev.providers ?? {});
        const idx = entries.findIndex(([k]) => k === newName);
        if (idx !== -1) entries[idx] = [oldName, entries[idx][1]];
        else entries.push([oldName, entry]);
        return { ...prev, providers: Object.fromEntries(entries) };
      });
      setSelection((prev) => {
        if (!prev) return prev;
        if (prev.type === "provider" && prev.name === newName) return { type: "provider", name: oldName };
        if (prev.type === "model" && prev.providerName === newName) return { ...prev, providerName: oldName };
        return prev;
      });
    }
  }, [config.providers, onModelsChanged]);

  const deleteProvider = useCallback((name: string) => {
    const previous = config.providers?.[name];
    setConfig((prev) => {
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    // Back to the provider list — the deleted provider's detail is gone.
    setSelection(null);
    void removeProvider(name)
      .then(() => { setSaveError(null); onModelsChanged?.(); })
      .catch((e) => {
        setSaveError(e instanceof Error ? e.message : String(e));
        if (previous !== undefined) {
          setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: previous } }));
        }
      });
  }, [config.providers, onModelsChanged]);

  const addModel = useCallback((providerName: string) => {
    const previous = config.providers?.[providerName] ?? {};
    const newEntry: ProviderEntry = {
      ...previous,
      models: [...(previous.models ?? []), { id: "" }],
    };
    setConfig((prev) => ({
      ...prev,
      providers: { ...(prev.providers ?? {}), [providerName]: newEntry },
    }));
    const idx = (newEntry.models ?? []).length - 1;
    setSelection({ type: "model", providerName, index: idx });
    void commitProvider(providerName, { ...newEntry })
      .then(() => { setSaveError(null); onModelsChanged?.(); })
      .catch((e) => {
        setSaveError(e instanceof Error ? e.message : String(e));
        setConfig((prev) => ({
          ...prev,
          providers: { ...(prev.providers ?? {}), [providerName]: previous },
        }));
      });
  }, [config.providers, onModelsChanged]);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    const previous = config.providers?.[providerName] ?? {};
    const models = [...(previous.models ?? [])];
    models[index] = m;
    const newEntry: ProviderEntry = { ...previous, models };
    setConfig((prev) => ({
      ...prev,
      providers: { ...(prev.providers ?? {}), [providerName]: newEntry },
    }));
    void commitProvider(providerName, { ...newEntry })
      .then(() => { setSaveError(null); onModelsChanged?.(); })
      .catch((e) => {
        setSaveError(e instanceof Error ? e.message : String(e));
        setConfig((prev) => ({
          ...prev,
          providers: { ...(prev.providers ?? {}), [providerName]: previous },
        }));
      });
  }, [config.providers, onModelsChanged]);

  const removeModel = useCallback((providerName: string, index: number) => {
    const previous = config.providers?.[providerName] ?? {};
    const models = [...(previous.models ?? [])];
    models.splice(index, 1);
    const newEntry: ProviderEntry = {
      ...previous,
      models: models.length ? models : undefined,
    };
    setConfig((prev) => ({
      ...prev,
      providers: { ...(prev.providers ?? {}), [providerName]: newEntry },
    }));
    setSelection({ type: "provider", name: providerName });
    void commitProvider(providerName, { ...newEntry })
      .then(() => { setSaveError(null); onModelsChanged?.(); })
      .catch((e) => {
        setSaveError(e instanceof Error ? e.message : String(e));
        setConfig((prev) => ({
          ...prev,
          providers: { ...(prev.providers ?? {}), [providerName]: previous },
        }));
      });
  }, [config.providers, onModelsChanged]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pickerOpen) { setPickerOpen(false); return; }
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pickerOpen, onClose]);



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

  ].join("|");



  // Built-in catalogs: local disk cache by default (light).

  // First-time only (empty cache) -> one timed ?fresh=1. After that: manual refresh only.

  useEffect(() => {

    const ids = builtinProviderIdsKey ? builtinProviderIdsKey.split("|").filter(Boolean) : [];

    if (ids.length === 0) {

      setBuiltinModelsByProvider({});

      setBuiltinModelsLoading({});

      setBuiltinModelsError({});

      return;

    }

    const gen = ++builtinModelsLoadGenRef.current;

    const ac = new AbortController();

    setBuiltinModelsLoading(Object.fromEntries(ids.map((id) => [id, true])));

    setBuiltinModelsError(Object.fromEntries(ids.map((id) => [id, null])));

    for (const id of ids) {

      void (async () => {

        try {

          const { models, warning } = await loadBuiltinProviderModelCatalog(id, {

            signal: ac.signal,

          });

          if (builtinModelsLoadGenRef.current !== gen) return;

          setBuiltinModelsByProvider((prev) => ({ ...prev, [id]: models }));

          setBuiltinModelsError((prev) => ({ ...prev, [id]: warning ?? null }));

        } catch (e) {

          if (builtinModelsLoadGenRef.current !== gen) return;

          if (e instanceof DOMException && e.name === "AbortError") return;

          if (e instanceof Error && e.name === "AbortError") return;

          setBuiltinModelsByProvider((prev) => ({ ...prev, [id]: prev[id] ?? [] }));

          setBuiltinModelsError((prev) => ({

            ...prev,

            [id]: e instanceof Error ? e.message : String(e),

          }));

        } finally {

          // Always clear when this generation still owns the load — prevents

          // permanent "刷新中" if the effect is superseded or the request times out.

          if (builtinModelsLoadGenRef.current === gen) {

            setBuiltinModelsLoading((prev) => ({ ...prev, [id]: false }));

          }

        }

      })();

    }

    return () => {

      ac.abort();

    };

  }, [builtinProviderIdsKey]);



  const refreshBuiltinProviderModels = useCallback(async (providerId: string) => {

    setBuiltinModelsLoading((prev) => ({ ...prev, [providerId]: true }));

    setBuiltinModelsError((prev) => ({ ...prev, [providerId]: null }));

    const ac = new AbortController();

    try {

      const { models, warning } = await loadBuiltinProviderModelCatalog(providerId, {

        forceFresh: true,

        signal: ac.signal,

      });

      setBuiltinModelsByProvider((prev) => ({

        ...prev,

        [providerId]: models,

      }));

      if (warning) {

        setBuiltinModelsError((prev) => ({ ...prev, [providerId]: warning }));

      }

      onModelsChanged?.();

    } catch (e) {

      if (!(e instanceof DOMException && e.name === "AbortError") &&

          !(e instanceof Error && e.name === "AbortError")) {

        setBuiltinModelsError((prev) => ({

          ...prev,

          [providerId]: e instanceof Error ? e.message : String(e),

        }));

      }

    } finally {

      setBuiltinModelsLoading((prev) => ({ ...prev, [providerId]: false }));

    }

  }, [onModelsChanged]);



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



  const toggleAllBuiltinModels = useCallback(async (providerId: string, enabled: boolean) => {

    const previous = builtinModelsByProvider[providerId] ?? [];

    const modelIds = previous.map((m) => m.id).filter(Boolean);

    if (modelIds.length === 0) return;

    const disabled = !enabled;

    setBuiltinModelsByProvider((prev) => ({

      ...prev,

      [providerId]: (prev[providerId] ?? []).map((m) => ({ ...m, disabled })),

    }));

    try {

      const res = await apiFetch("/api/models-config/disabled-models", {

        method: "PATCH",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ provider: providerId, modelIds, disabled }),

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

          onRefresh={handleAuthMutation}

          models={builtinModelsByProvider[p.id] ?? []}

          modelsLoading={builtinModelsLoading[p.id] ?? false}

          modelsError={builtinModelsError[p.id] ?? null}

          onToggleModel={(modelId, enabled) => toggleBuiltinModel(p.id, modelId, !enabled)}

          onToggleAllModels={(enabled) => toggleAllBuiltinModels(p.id, enabled)}

          onOpenModel={(modelId) => setSelection({ type: "builtin-model", providerId: p.id, modelId })}

          onRefreshModels={() => void refreshBuiltinProviderModels(p.id)}

          refreshingModels={builtinModelsLoading[p.id] ?? false}

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

          onRefresh={handleAuthMutation}

          models={builtinModelsByProvider[p.id] ?? []}

          modelsLoading={builtinModelsLoading[p.id] ?? false}

          modelsError={builtinModelsError[p.id] ?? null}

          onToggleModel={(modelId, enabled) => toggleBuiltinModel(p.id, modelId, !enabled)}

          onToggleAllModels={(enabled) => toggleAllBuiltinModels(p.id, enabled)}

          onOpenModel={(modelId) => setSelection({ type: "builtin-model", providerId: p.id, modelId })}

          onRefreshModels={() => void refreshBuiltinProviderModels(p.id)}

          refreshingModels={builtinModelsLoading[p.id] ?? false}

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

          onOpenModel={(index) => setSelection({ type: "model", providerName: selection.name, index })}

          onAddModel={() => addModel(selection.name)}

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



  return (

    <>

      <ModelsSettingsView
        loading={loading}
        saveError={saveError}
        selection={selection}
        setSelection={setSelection}
        detailContent={detailContent}
        activeBuiltinProviders={activeBuiltinProviders}
        builtinModelsByProvider={builtinModelsByProvider}
        providers={providers}
        onAddProvider={() => setPickerOpen(true)}
      />

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
