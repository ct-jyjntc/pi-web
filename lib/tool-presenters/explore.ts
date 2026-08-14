/** Search/explore cards (grep, find, ls, glob). */
import type { ToolPresenter } from "../tool-presentation";
import { firstStringArg } from "./default";

export const explorePresenter: ToolPresenter = {
  presentCall(args) {
    const query = typeof args.pattern === "string" ? args.pattern : firstStringArg(args);
    return { card: "search", title: query ?? "search", query, preview: query };
  },
  presentResult(args) {
    return explorePresenter.presentCall(args);
  },
};
