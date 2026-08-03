/**
 * ModelRuntime factory that always registers Pi Web–managed native providers
 * (e.g. 基元律动) so auth routes and chat sessions see the same catalog.
 */

import {
  ModelRuntime,
  type CreateModelRuntimeOptions,
} from "@earendil-works/pi-coding-agent";

import { createAtomGitProvider } from "./atomgit-provider";
import { createTokenRhythmProvider } from "./tokenrhythm-provider";

export type { CreateModelRuntimeOptions };

/** Create a ModelRuntime with Pi Web native providers registered. */
export async function createConfiguredModelRuntime(
  options?: CreateModelRuntimeOptions,
): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create(options);
  // registerNativeProvider replaces any prior registration for the same id.
  runtime.registerNativeProvider(createTokenRhythmProvider());
  runtime.registerNativeProvider(createAtomGitProvider());
  return runtime;
}
