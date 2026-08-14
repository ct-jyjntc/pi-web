/**
 * Decide how startRpcSession seeds the wrapper allow-list from optional toolNames.
 */

import { getFullToolNames } from "./tool-presets";

export type ToolAdoption =
  | { kind: "all-off" }
  | { kind: "adopt"; names: string[] };

/** How startRpcSession seeds the allow-list. `[]` = all tools off. */
export function resolveToolAdoption(toolNames?: string[]): ToolAdoption {
  if (toolNames?.length === 0) return { kind: "all-off" };
  if (toolNames && toolNames.length > 0) return { kind: "adopt", names: toolNames };
  return { kind: "adopt", names: getFullToolNames() };
}
