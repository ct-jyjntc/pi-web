/** Exact-name presenter registry. */
import type { ToolPresenter } from "../tool-presentation";
import { defaultPresenter } from "./default";

const PRESENTERS: Record<string, ToolPresenter> = {};

export function lookupPresenter(name: string): ToolPresenter {
  return PRESENTERS[name] ?? defaultPresenter(name);
}
