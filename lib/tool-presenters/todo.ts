/** Todo is hoisted to chrome; not a transcript card. */
import type { ToolPresenter } from "../tool-presentation";

export const todoPresenter: ToolPresenter = {
  presentCall() {
    return { card: "generic", title: "todo", hoist: true };
  },
  presentResult() {
    return { card: "generic", title: "todo", hoist: true };
  },
};
