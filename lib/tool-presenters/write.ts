/** Write tool card: diff only when a patch exists. */
import { patchFromToolDetails, type ToolPresenter } from "../tool-presentation";
import { firstStringArg } from "./default";

function pathOf(args: Record<string, unknown>): string | undefined {
  return typeof args.path === "string" ? args.path : firstStringArg(args);
}

export const writePresenter: ToolPresenter = {
  presentCall(args) {
    const path = pathOf(args);
    return { card: "generic", title: path ?? "write", locations: path ? [path] : undefined };
  },
  presentResult(args, result) {
    const path = pathOf(args);
    const patch = patchFromToolDetails(result.details);
    return {
      card: patch ? "diff" : "generic",
      title: path ?? "write",
      locations: path ? [path] : undefined,
      patch: patch ?? undefined,
    };
  },
};
