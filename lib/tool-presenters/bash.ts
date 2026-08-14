/** Bash tool card. */
import type { ToolPresenter } from "../tool-presentation";

export const bashPresenter: ToolPresenter = {
  presentCall(args) {
    const command = typeof args.command === "string" ? args.command : "";
    return { card: "terminal", title: command || "bash", command, preview: command };
  },
  presentResult(args) {
    return bashPresenter.presentCall(args);
  },
};
