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
import type { Api, Credential, Model, Provider, ProviderModelsStore } from "@earendil-works/pi-ai";

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
  fetchSubscriptionLiveModels,
  SUBSCRIPTION_LIVE_MODEL_PROVIDERS,
  PROVIDER_LIVE_MODELS_TIMEOUT_MS,
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
 * Live-fetch only this provider's models into models-store, then re-read via runtime.
 * Does not call modelRuntime.refresh({ allowNetwork: true }) (that would fan out).
 */
async function liveRefreshOneProvider(
  modelRuntime: {
    getProvider: (id: string) => Provider | undefined;
    refresh: (opts?: { allowNetwork?: boolean; signal?: AbortSignal }) => Promise<unknown>;
  },
  providerId: string,
  signal?: AbortSignal,
): Promise<{ live: boolean; warning?: string }> {
  const provider = modelRuntime.getProvider(providerId);
  if (!provider) return { live: false };

  // Prefer the provider's own refreshModels (Nous/MiniMax/AtomGit/Kimi wrappers).
  // That path owns rich /models parsing. Do NOT short-circuit
  // first-party providers through bare id-only fetchSubscriptionLiveModels.
  if (typeof provider.refreshModels === "function") {
    const credential = await credentialFor(providerId);
    if (!credential && SUBSCRIPTION_LIVE_MODEL_PROVIDERS.has(providerId)) {
      return { live: false, warning: "Not signed in; showing static catalog" };
    }
    try {
      const { join, dirname } = await import("node:path");
      const { getAgentDir } = await import("./agent-dir");
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import("node:fs");
      const storePath = join(getAgentDir(), "models-store.json");

      const store: ProviderModelsStore = {
        async read() {
          if (!existsSync(storePath)) return undefined;
          try {
            const file = JSON.parse(readFileSync(storePath, "utf8")) as Record<
              string,
              { models?: AnyModel[]; checkedAt?: number }
            >;
            const entry = file[providerId];
            if (!entry?.models) return undefined;
            return { models: entry.models, checkedAt: entry.checkedAt };
          } catch {
            return undefined;
          }
        },
        async write(entry) {
          let file: Record<string, unknown> = {};
          if (existsSync(storePath)) {
            try {
              file = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>;
            } catch {
              file = {};
            }
          }
          file[providerId] = entry;
          mkdirSync(dirname(storePath), { recursive: true });
          writeFileSync(storePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
        },
        async delete() {
          /* unused */
        },
      };

      await provider.refreshModels({
        credential,
        store,
        allowNetwork: true,
        force: true,
        signal,
      });
      await modelRuntime.refresh({ allowNetwork: false, signal });
      return { live: true };
    } catch (error) {
      return {
        live: false,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Fallback: id-list fetch for providers without refreshModels.
  if (SUBSCRIPTION_LIVE_MODEL_PROVIDERS.has(providerId)) {
    const credential = await credentialFor(providerId);
    if (!credential) return { live: false, warning: "Not signed in; showing static catalog" };
    try {
      const liveModels = await fetchSubscriptionLiveModels(provider, {
        credential,
        signal,
        timeoutMs: PROVIDER_LIVE_MODELS_TIMEOUT_MS,
      });
      const { join, dirname } = await import("node:path");
      const { getAgentDir } = await import("./agent-dir");
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import("node:fs");
      const storePath = join(getAgentDir(), "models-store.json");
      let file: Record<string, unknown> = {};
      if (existsSync(storePath)) {
        try {
          file = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>;
        } catch {
          file = {};
        }
      }
      file[providerId] = { models: liveModels, checkedAt: Date.now() };
      mkdirSync(dirname(storePath), { recursive: true });
      writeFileSync(storePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      await modelRuntime.refresh({ allowNetwork: false, signal });
      return { live: true };
    } catch (error) {
      return {
        live: false,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { live: false };
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
