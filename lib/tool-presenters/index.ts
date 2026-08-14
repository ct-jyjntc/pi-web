/** Exact-name presenter registry. */
import type { ToolPresenter } from "../tool-presentation";
import { defaultPresenter } from "./default";
import { editPresenter } from "./edit";
import { writePresenter } from "./write";
import { readPresenter } from "./read";
import { bashPresenter } from "./bash";
import { explorePresenter } from "./explore";
import { webPresenter } from "./web";
import { askPresenter } from "./ask";
import { todoPresenter } from "./todo";

const PRESENTERS: Record<string, ToolPresenter> = {
  edit: editPresenter,
  write: writePresenter,
  read: readPresenter,
  bash: bashPresenter,
  grep: explorePresenter,
  find: explorePresenter,
  ls: explorePresenter,
  glob: explorePresenter,
  web_fetch: webPresenter,
  web_search: webPresenter,
  ask_user_question: askPresenter,
  todo: todoPresenter,
};

export function lookupPresenter(name: string): ToolPresenter {
  return PRESENTERS[name] ?? defaultPresenter(name);
}
