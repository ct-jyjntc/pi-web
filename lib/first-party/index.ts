/**
 * First-party Pi Web session factories. All built-in capabilities live here.
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { createAskUserInlineExtension } from "./ask-user-extension";
import { createTodoInlineExtension } from "./todo-extension";
import { createSubagentsInlineExtension } from "./subagents";
import { createPermissionInlineExtension } from "./permission";
import { createMcpInlineExtension } from "./mcp";

/** All first-party factories registered on every full agent session. */
export function getFirstPartyExtensionFactories(): InlineExtension[] {
  return [
    createTodoInlineExtension(),
    createAskUserInlineExtension(),
    createSubagentsInlineExtension(),
    createPermissionInlineExtension(),
    createMcpInlineExtension(),
  ];
}

export { createTodoInlineExtension } from "./todo-extension";
export { createAskUserInlineExtension } from "./ask-user-extension";
export { createSubagentsInlineExtension } from "./subagents";
export { createPermissionInlineExtension } from "./permission";
export { createMcpInlineExtension } from "./mcp";
