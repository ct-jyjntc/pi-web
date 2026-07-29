/**
 * Built-in free model providers shown under the "Free" group in ModelsConfig.
 * Models are fetched from the provider `/models` endpoint and filtered client-side.
 */

export type FreeProviderId = "opencode-zen-free";

export interface FreeProviderDefinition {
  /** Stable managed marker stored on models.json provider entries. */
  id: FreeProviderId;
  /** Key used under models.json `providers`. */
  providerKey: string;
  displayName: string;
  description: string;
  baseUrl: string;
  api: "openai-completions";
  /** API key used for auth. OpenCode Zen free tier uses the public key. */
  apiKey: string;
  /** Only keep model ids matching this predicate (e.g. free-tier suffix). */
  modelIdFilter: (modelId: string) => boolean;
  /** Icon key for ProviderIcon / lobehub icons. */
  iconId: string;
}

export const FREE_PROVIDERS: readonly FreeProviderDefinition[] = [
  {
    id: "opencode-zen-free",
    providerKey: "opencode-zen",
    displayName: "OpenCode Zen",
    description: "Free models via opencode.ai/zen",
    baseUrl: "https://opencode.ai/zen/v1",
    api: "openai-completions",
    apiKey: "public",
    modelIdFilter: (modelId) => modelId.endsWith("-free"),
    iconId: "opencode",
  },
] as const;

export function getFreeProvider(id: string | undefined | null): FreeProviderDefinition | undefined {
  if (!id) return undefined;
  return FREE_PROVIDERS.find((p) => p.id === id);
}

export function isFreeManagedProvider(
  provider: { managed?: unknown } | null | undefined,
): provider is { managed: FreeProviderId } {
  return typeof provider?.managed === "string" && !!getFreeProvider(provider.managed);
}

export function freeProviderByKey(providerKey: string): FreeProviderDefinition | undefined {
  return FREE_PROVIDERS.find((p) => p.providerKey === providerKey);
}

export function filterFreeModelIds(
  def: FreeProviderDefinition,
  modelIds: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of modelIds) {
    const id = raw.trim();
    if (!id || !def.modelIdFilter(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
