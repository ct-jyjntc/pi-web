/**
 * Developer-role compat defaults for custom OpenAI-compatible providers in
 * models.json (single owner; consumed by PUT /api/models-config on save).
 *
 * pi-ai sends the system prompt as `role: "developer"` when `model.reasoning`
 * and `compat.supportsDeveloperRole` are both truthy, and URL auto-detection
 * defaults the latter to true for any unrecognized host — most third-party
 * gateways (Volcano Ark, Azure, vLLM, …) reject the role with a 400. So on
 * save we stamp an explicit `supportsDeveloperRole: false` at provider level
 * (it merges into every model via mergeCompat; a model-level key still wins)
 * unless the host is known to support `developer` or the key is already set.
 */
type Json = Record<string, unknown>;

/** APIs whose request shape includes the OpenAI `developer` role question. */
const OPENAI_APIS = new Set(["openai-completions", "openai-responses"]);

/**
 * Hosts left to SDK auto-detection. OpenAI first-party is the canonical
 * `developer` consumer; OpenRouter gets per-model handling inside pi-ai.
 * Everything else is safer on `system` — accepted by every OpenAI-compatible
 * API, whereas `developer` hard-400s on gateways that do not know it.
 */
const DEVELOPER_ROLE_HOSTS = ["api.openai.com", "openrouter.ai"];

/**
 * Dead keys written by older Pi Web checkbox builds; the SDK never read them.
 * Removed on save (idempotent, one-way).
 */
const LEGACY_DEVELOPER_ROLE_KEYS = ["developerRole", "useDeveloperRole"] as const;

function isPlainObject(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** True when the host is known to handle `role: "developer"` (SDK auto-detect). */
export function isDeveloperRoleHost(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return false;
  const lower = baseUrl.toLowerCase();
  return DEVELOPER_ROLE_HOSTS.some((host) => lower.includes(host));
}

function normalizeProviderCompat(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  const provider = { ...raw };
  // Garbage compat (string/number/…) is left for SDK schema validation.
  if (provider.compat !== undefined && !isPlainObject(provider.compat)) return provider;

  const compat: Json = { ...(provider.compat ?? {}) };
  for (const key of LEGACY_DEVELOPER_ROLE_KEYS) delete compat[key];

  const api = typeof provider.api === "string" ? provider.api : undefined;
  const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl : undefined;
  if (
    api &&
    OPENAI_APIS.has(api) &&
    !isDeveloperRoleHost(baseUrl) &&
    compat.supportsDeveloperRole == null // respects explicit true AND false
  ) {
    compat.supportsDeveloperRole = false;
  }

  if (Object.keys(compat).length > 0) provider.compat = compat;
  else delete provider.compat;
  return provider;
}

/**
 * Normalize every provider entry in a models.json-shaped object.
 * Returns a new object; safe to run on every save (idempotent).
 */
export function normalizeDeveloperRoleCompat<T extends Json>(data: T): T {
  const providers = data.providers;
  if (!isPlainObject(providers)) return data;
  const next: Record<string, unknown> = {};
  for (const [name, rawProvider] of Object.entries(providers)) {
    next[name] = normalizeProviderCompat(rawProvider);
  }
  return { ...data, providers: next };
}
