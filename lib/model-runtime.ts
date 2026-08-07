/**
 * ModelRuntime factory that always registers Pi Web–managed native providers
 * (e.g. 基元律动) so auth routes and chat sessions see the same catalog.
 *
 * Invariant:
 * - No pi.dev remote catalog. Builtins are re-registered from raw
 *   `builtinProviders()` (SDK create() wraps them in withRemoteCatalog by default).
 * - Live model lists come from each provider's own API (OpenAI-compat /models,
 *   AtomGit models-v2, TokenRhythm catalog) — never from pi.dev.
 */
import {
  ModelRuntime,
  type CreateModelRuntimeOptions,
} from "@earendil-works/pi-coding-agent";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

import { createAtomGitProvider } from "./atomgit-provider";
import { createMinimaxProvider } from "./minimax-provider";
import { createNousProvider } from "./nous-provider";
import { attachProviderLiveModelLists } from "./provider-live-models";

export type { CreateModelRuntimeOptions };

/** Create a ModelRuntime with Pi Web native providers and no pi.dev overlay. */
export async function createConfiguredModelRuntime(
  options?: CreateModelRuntimeOptions,
): Promise<ModelRuntime> {
  // allowModelNetwork only affects create()-time refresh; we still strip pi.dev
  // wrappers below. Default false so boot never blocks on remote catalogs.
  const runtime = await ModelRuntime.create({
    ...options,
    allowModelNetwork: options?.allowModelNetwork ?? false,
  });

  // Replace SDK builtins (withRemoteCatalog → pi.dev) with raw providers, then
  // attach provider-native live /models where supported (subscription only).
  for (const provider of attachProviderLiveModelLists(builtinProviders())) {
    if (provider.id === "radius") continue;
    runtime.registerNativeProvider(provider);
  }

  // First-party subscriptions (Hermes-parity OAuth + AtomGit).
  // Stock API-key clouds are Custom-only (models.json).
  runtime.registerNativeProvider(createAtomGitProvider());
  runtime.registerNativeProvider(createNousProvider());
  runtime.registerNativeProvider(createMinimaxProvider());
  return runtime;
}
