/** Edit tool card: always diff. */
import { patchFromToolDetails, type ToolPresenter } from "../tool-presentation";
import { firstStringArg } from "./default";

function pathOf(args: Record<string, unknown>): string | undefined {
  return typeof args.path === "string" ? args.path : firstStringArg(args);
}

export const editPresenter: ToolPresenter = {
  presentCall(args) {
    const path = pathOf(args);
    return { card: "diff", title: path ?? "edit", locations: path ? [path] : undefined };
  },
  presentResult(args, result) {
    const path = pathOf(args);
    return {
      card: "diff",
      title: path ?? "edit",
      locations: path ? [path] : undefined,
      patch: patchFromToolDetails(result.details) ?? undefined,
    };
  },
};
