/**
 * Parent-turn settlement for background subagents. One path: agent_end
 * waits for this prompt's uncollected children and returns their records
 * so the extension can inject a follow-up and the loop continues.
 */
import { SUBAGENT_RESULTS_CUSTOM_TYPE } from "../../types";
import type { SubagentRecord } from "./types";

export { SUBAGENT_RESULTS_CUSTOM_TYPE };

export type SubagentSettlement = {
  epoch: number;
  uncollectedInEpoch(epoch: number): SubagentRecord[];
  waitUncollectedInEpoch(epoch: number, signal?: AbortSignal): Promise<"ok" | "aborted">;
  markCollected(id: string): void;
};

const SKIP_STOP_REASONS = new Set(["aborted", "error", "length"]);

export function shouldDeliverOnAgentEnd(
  messages: Array<{ role?: string; stopReason?: string }>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    return !SKIP_STOP_REASONS.has(message.stopReason ?? "");
  }
  return false;
}

export function formatRecord(record: SubagentRecord): string {
  const lines = [
    record.note,
    `Agent ID: ${record.id}`,
    record.sessionId ? `Session ID: ${record.sessionId}` : "",
    `Type: ${record.displayName}`,
    `Status: ${record.status}`,
    record.description ? `Description: ${record.description}` : "",
  ].filter(Boolean);
  if (record.error) lines.push(`Error: ${record.error}`);
  if (record.result) lines.push("", record.result);
  return lines.join("\n");
}

export function formatDeliveredResults(records: SubagentRecord[]): string {
  const header = records.length === 1
    ? "Background subagent finished. Incorporate this result into your reply. Do not tell the user to wait."
    : `${records.length} background subagents finished. Incorporate these results into your reply. Do not tell the user to wait.`;
  return [header, ...records.map((record) => formatRecord(record))].join("\n\n---\n\n");
}

export async function deliverUncollectedOnAgentEnd(input: {
  manager: SubagentSettlement;
  messages: Array<{ role?: string; stopReason?: string }>;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (!shouldDeliverOnAgentEnd(input.messages)) return null;
  const { manager } = input;
  const epoch = manager.epoch;
  if (manager.uncollectedInEpoch(epoch).length === 0) return null;
  const waited = await manager.waitUncollectedInEpoch(epoch, input.signal);
  if (waited !== "ok") return null;
  const records = manager.uncollectedInEpoch(epoch);
  if (records.length === 0) return null;
  for (const record of records) manager.markCollected(record.id);
  return formatDeliveredResults(records);
}
