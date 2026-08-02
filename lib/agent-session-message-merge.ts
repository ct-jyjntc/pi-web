/**
 * Merge a delivered user message_end into the transcript, consuming an
 * adjacent optimistic bubble when keys match.
 */

import type { AgentMessage } from "@/lib/types";
import { userMessageKey } from "@/lib/agent-session-message-key";

export function mergeDeliveredUserMessage(
  prev: AgentMessage[],
  delivered: AgentMessage,
  optimisticKey: string | null,
): AgentMessage[] {
  const deliveredKey = userMessageKey(delivered);
  const last = prev[prev.length - 1];
  if (optimisticKey && last?.role === "user" && userMessageKey(last) === optimisticKey) {
    return optimisticKey === deliveredKey
      ? prev
      : [...prev.slice(0, -1), delivered];
  }
  return [...prev, delivered];
}
