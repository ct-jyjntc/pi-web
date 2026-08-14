/** web_fetch / web_search cards. */
import type { ToolPresenter } from "../tool-presentation";
import { firstStringArg } from "./default";

export const webPresenter: ToolPresenter = {
  presentCall(args) {
    const query = typeof args.url === "string" ? args.url
      : typeof args.query === "string" ? args.query
      : firstStringArg(args);
    return { card: "web", title: query ?? "web", query, preview: query };
  },
  presentResult(args) {
    return webPresenter.presentCall(args);
  },
};
