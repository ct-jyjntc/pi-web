/** ask_user_question card. */
import type { ToolPresenter } from "../tool-presentation";
import { isRecord } from "../type-guards";

function firstQuestion(args: Record<string, unknown>): string {
  const q = args.questions;
  if (Array.isArray(q)) {
    const first = q[0];
    if (isRecord(first) && typeof first.question === "string" && first.question) {
      return first.question;
    }
  }
  if (typeof args.question === "string" && args.question) return args.question;
  return "ask";
}

export const askPresenter: ToolPresenter = {
  presentCall(args) {
    const title = firstQuestion(args);
    return { card: "ask", title, preview: title };
  },
  presentResult(args) {
    return askPresenter.presentCall(args);
  },
};
