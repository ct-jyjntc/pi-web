/** Read tool card. */
import type { ToolPresenter } from "../tool-presentation";
import { firstStringArg } from "./default";

function presentRead(args: Record<string, unknown>) {
  const path = typeof args.path === "string" ? args.path : firstStringArg(args);
  return { card: "read" as const, title: path ?? "read", locations: path ? [path] : undefined, preview: path };
}

export const readPresenter: ToolPresenter = {
  presentCall: presentRead,
  presentResult: (args) => presentRead(args),
};
