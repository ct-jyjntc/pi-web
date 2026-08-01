/**
 * First-party Pi Web extensions registered via DefaultResourceLoader.extensionFactories.
 * Thin tools (todo, ask-user) live here; heavy packages are prebundled (heavy-extensions.ts).
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { createAskUserInlineExtension } from "./ask-user-extension";
import { createTodoInlineExtension } from "./todo-extension";

/** Thin inline factories — no disk/jiti load; pure app modules. */
export function getFirstPartyExtensionFactories(): InlineExtension[] {
  return [createTodoInlineExtension(), createAskUserInlineExtension()];
}

export { createTodoInlineExtension } from "./todo-extension";
export { createAskUserInlineExtension } from "./ask-user-extension";
export {
  loadHeavyExtensionFactories,
  resolveHeavyBundlePath,
  HEAVY_EXTENSION_SPECS,
} from "./heavy-extensions";
