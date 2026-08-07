/**
 * Client fetch sequence for built-in provider model catalogs.
 * Cache-first, then one timed fresh=1 when empty or forced — single owner of this path.
 */
import { apiFetch } from "@/lib/api-transport";
import type { ProviderModelRow } from "./models-config-types";

/** Client budget for provider-models (includes server-side refresh). */
export const BUILTIN_PROVIDER_MODELS_TIMEOUT_MS = 20_000;

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function loadBuiltinProviderModelCatalog(
  providerId: string,
  options?: {
    forceFresh?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<{ models: ProviderModelRow[]; warning?: string | null }> {
  const timeoutMs = options?.timeoutMs ?? BUILTIN_PROVIDER_MODELS_TIMEOUT_MS;
  const signal = withTimeout(options?.signal, timeoutMs);
  const q = encodeURIComponent(providerId);

  if (!options?.forceFresh) {
    const res = await apiFetch(`/api/models-config/provider-models?provider=${q}`, { signal });
    const data = (await res.json()) as { models?: ProviderModelRow[]; error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    const models = Array.isArray(data.models) ? data.models : [];
    if (models.length > 0) return { models };
  }

  const res = await apiFetch(
    `/api/models-config/provider-models?provider=${q}&fresh=1`,
    { signal },
  );
  const data = (await res.json()) as {
    models?: ProviderModelRow[];
    error?: string;
    warning?: string;
  };
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return {
    models: Array.isArray(data.models) ? data.models : [],
    warning: data.warning ?? null,
  };
}
