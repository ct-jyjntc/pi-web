/**
 * Heavy-path materialization of ONE built-in provider catalog into the disk cache.
 *
 * Invariant (decoupling):
 * 1. Scope is a single provider id — live network only for that provider.
 * 2. Never uses pi.dev (stripped in createConfiguredModelRuntime).
 * 3. Live source is the provider's own models API when available; else static/store.
 * 4. Single-flight per provider so concurrent UI refreshes share one load.
 * 5. Always ends with models or a soft cache fallback.
 */
import type { Api, Credential, Model, Provider } from "@earendil-works/pi-ai";

type AnyModel = Model<Api>;

import { getDisabledModelRefs } from "./disabled-models";
import {
  projectBuiltinProviderModel,
  type BuiltinProviderModelRow,
} from "./builtin-provider-models";
import {
  readBuiltinProviderModelsCache,
  writeBuiltinProviderModelsCache,
} from "./builtin-provider-models-cache";
import {
  SUBSCRIPTION_LIVE_MODEL_PROVIDERS,
} from "./provider-live-models";

export type BuiltinProviderCatalogMaterialize = {
  provider: string;
  displayName: string;
  models: BuiltinProviderModelRow[];
  modelCount: number;
  enabledCount: number;
  /** True when models were just fetched from the provider's own API. */
  live: boolean;
  degraded: boolean;
  cached: boolean;
  updatedAt: number;
  warning?: string;
};

declare global {
  var __piBuiltinProviderFresh: Map<string, Promise<BuiltinProviderCatalogMaterialize>> | undefined;
}

function freshMap(): Map<string, Promise<BuiltinProviderCatalogMaterialize>> {
  return (globalThis.__piBuiltinProviderFresh ??= new Map());
}

function sortModels(models: BuiltinProviderModelRow[]): BuiltinProviderModelRow[] {
  return [...models].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );
}

function projectRows(
  provider: string,
  runtimeModels: readonly AnyModel[],
): BuiltinProviderModelRow[] {
  const disabled = getDisabledModelRefs();
  return sortModels(
    runtimeModels.map((m) =>
      projectBuiltinProviderModel(provider, m, disabled.has(`${provider}/${m.id}`)),
    ),
  );
}

async function credentialFor(providerId: string): Promise<Credential | undefined> {
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { getAgentDir } = await import("./agent-dir");
    const authPath = join(getAgentDir(), "auth.json");
    if (!existsSync(authPath)) return undefined;
    const raw = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, Credential>;
    const cred = raw[providerId];
    if (!cred || typeof cred !== "object") return undefined;
    if (cred.type === "oauth" || cred.type === "api_key") return cred;
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Live-fetch only this provider's models into the SDK models-store.
 * Uses Models.refresh({ providers: [id] }) so we never fan out to every provider.
 * Pi 0.84: store/publish is owned by the runtime — no hand-rolled ProviderModelsStore.
 */
async function liveRefreshOneProvider(
  modelRuntime: {
    getProvider: (id: string) => Provider | undefined;
    refresh: (opts?: {
      allowNetwork?: boolean;
      force?: boolean;
      providers?: readonly string[];
      signal?: AbortSignal;
    }) => Promise<{ aborted: boolean; errors: ReadonlyMap<string, Error> }>;
  },
  providerId: string,
  signal?: AbortSignal,
): Promise<{ live: boolean; warning?: string }> {
  const provider = modelRuntime.getProvider(providerId);
  if (!provider) return { live: false };
  if (typeof provider.refreshModels !== "function") return { live: false };

  if (SUBSCRIPTION_LIVE_MODEL_PROVIDERS.has(providerId)) {
    const credential = await credentialFor(providerId);
    if (!credential) {
      return { live: false, warning: "Not signed in; showing static catalog" };
    }
  }

  try {
    const result = await modelRuntime.refresh({
      allowNetwork: true,
      force: true,
      providers: [providerId],
      signal,
    });
    if (result.aborted) {
      return { live: false, warning: "Aborted" };
    }
    const err = result.errors.get(providerId);
    if (err) {
      return { live: false, warning: err.message };
    }
    return { live: true };
  } catch (error) {
    return {
      live: false,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

async function materializeOnce(
  provider: string,
  signal?: AbortSignal,
): Promise<BuiltinProviderCatalogMaterialize> {
  const { createConfiguredModelRuntime } = await import("./model-runtime");

  const modelRuntime = await createConfiguredModelRuntime({ allowModelNetwork: false });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const def = modelRuntime.getProvider(provider);
  if (!def) {
    const cached = readBuiltinProviderModelsCache(provider);
    if (cached && cached.models.length > 0) {
      return {
        provider,
        displayName: cached.displayName ?? provider,
        models: cached.models,
        modelCount: cached.models.length,
        enabledCount: cached.models.filter((m) => !m.disabled).length,
        live: false,
        degraded: true,
        cached: true,
        updatedAt: cached.updatedAt,
        warning: `Unknown provider: ${provider}`,
      };
    }
    throw new Error(`Unknown provider: ${provider}`);
  }

  // 1) Local static + store
  try {
    await modelRuntime.refresh({ allowNetwork: false, signal });
  } catch (error) {
    console.warn(`[provider-models] local refresh failed for ${provider}`, error);
  }

  // 2) Live: only this provider's own API (no fan-out, no pi.dev)
  let live = false;
  let warning: string | undefined;
  if (!signal?.aborted) {
    const result = await liveRefreshOneProvider(modelRuntime, provider, signal);
    live = result.live;
    warning = result.warning;
  }

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const models = projectRows(provider, modelRuntime.getModels(provider));

  if (models.length > 0) {
    writeBuiltinProviderModelsCache(provider, {
      displayName: def.name,
      models,
    });
    return {
      provider,
      displayName: def.name,
      models,
      modelCount: models.length,
      enabledCount: models.filter((m) => !m.disabled).length,
      live,
      degraded: !live,
      cached: false,
      updatedAt: Date.now(),
      ...(warning ? { warning } : {}),
    };
  }

  const cached = readBuiltinProviderModelsCache(provider);
  if (cached && cached.models.length > 0) {
    return {
      provider,
      displayName: cached.displayName ?? def.name,
      models: cached.models,
      modelCount: cached.models.length,
      enabledCount: cached.models.filter((m) => !m.disabled).length,
      live: false,
      degraded: true,
      cached: true,
      updatedAt: cached.updatedAt,
      warning: warning ?? "Runtime catalog empty; showing last cached models",
    };
  }

  return {
    provider,
    displayName: def.name,
    models: [],
    modelCount: 0,
    enabledCount: 0,
    live: false,
    degraded: true,
    cached: false,
    updatedAt: Date.now(),
    ...(warning ? { warning } : {}),
  };
}

export function materializeBuiltinProviderCatalog(
  provider: string,
  options?: { signal?: AbortSignal },
): Promise<BuiltinProviderCatalogMaterialize> {
  const id = provider.trim();
  if (!id) {
    return Promise.reject(new Error("provider is required"));
  }

  const map = freshMap();
  const existing = map.get(id);
  if (existing) return existing;

  const work = materializeOnce(id, options?.signal).finally(() => {
    if (map.get(id) === work) map.delete(id);
  });
  map.set(id, work);
  return work;
}
