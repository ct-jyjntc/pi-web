/**
 * Tool-run grouping and title helpers for transcript scaffold lines.
 */
import type { AssistantContentBlock, ToolCallContent } from "@/lib/types";
import type { TFn } from "./message-view-utils";
import { getToolPreview } from "./message-view-utils";

export interface BlockItem {
  block: AssistantContentBlock;
  originalIndex: number;
}

export type DisplayItem =
  | { kind: "block"; item: BlockItem }
  | { kind: "run"; items: BlockItem[] };

export function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor");
}


export function isCardToolName(toolName: string): boolean {
  const n = toolName.toLowerCase();
  if (isEditToolName(toolName)) return true;
  if (n === "write" || n.startsWith("write_") || n.endsWith("_write") || n.endsWith(".write") || n.includes("write_file")) return true;
  if (n.includes("ask") || n.includes("question") || n.includes("clarif") || n.includes("user")) return true;
  return false;
}

/**
 * Split a message's blocks into singleton blocks and groups of consecutive
 * run-tool calls. Order is preserved — a read→edit→read turn shows a group,
 * the diff card, then a second group.
 *
 * Hermes folds even a lone activity call into a one-line scaffold row, so any
 * non-empty run (≥1) goes through ToolRunGroup / ScaffoldToolRow rather than
 * the heavy card chrome reserved for edit/write/ask.
 */
export function groupRunBlocks(blockItems: BlockItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let run: BlockItem[] = [];
  const flush = () => {
    if (run.length >= 1) out.push({ kind: "run", items: run });
    run = [];
  };
  for (const item of blockItems) {
    // Todo is hoisted to the session top bar — skip entirely from run groups.
    if (item.block.type === "toolCall" && (item.block as ToolCallContent).toolName.toLowerCase() === "todo") {
      flush();
      continue;
    }
    if (item.block.type === "toolCall" && !isCardToolName((item.block as ToolCallContent).toolName)) {
      run.push(item);
    } else {
      flush();
      out.push({ kind: "block", item });
    }
  }
  flush();
  return out;
}

type RunCategory = "command" | "explore" | "other";

export function runCategory(toolName: string): RunCategory {
  const n = toolName.toLowerCase();
  if (n.startsWith("bash") || n.includes("shell") || n.includes("terminal") || n.includes("exec")) return "command";
  if (n === "read" || n === "grep" || n === "find" || n === "ls" || n.includes("search") || n.includes("list") || n.includes("glob")) return "explore";
  return "other";
}

/** Settled group line — "Ran 5 commands · Read 3 files". Clause order is fixed. */
export function settledRunLine(runs: ToolCallContent[], t: TFn): string {
  // Single call: name the target like Hermes ("Read foo.ts"), not "Read 1 file".
  if (runs.length === 1) return scaffoldToolTitle(runs[0]!, false, t);
  const counts: Record<RunCategory, number> = { command: 0, explore: 0, other: 0 };
  for (const tc of runs) counts[runCategory(tc.toolName)]++;
  const clauses: string[] = [];
  if (counts.command > 0) clauses.push(t(counts.command === 1 ? "toolRun.ranCommand" : "toolRun.ranCommands", { n: counts.command }));
  if (counts.explore > 0) clauses.push(t(counts.explore === 1 ? "toolRun.readFile" : "toolRun.readFiles", { n: counts.explore }));
  if (counts.other > 0) clauses.push(t(counts.other === 1 ? "toolRun.usedTool" : "toolRun.usedTools", { n: counts.other }));
  return clauses.join(" · ");
}

/** Live group line for the narrating call — "Reading src/foo.ts". */
export function liveRunLine(tc: ToolCallContent, t: TFn): string {
  return scaffoldToolTitle(tc, true, t);
}

/** One-line scaffold title for a single tool call (Hermes-style). */
export function scaffoldToolTitle(tc: ToolCallContent, live: boolean, t: TFn): string {
  const target = getToolPreview(tc) || tc.toolName;
  const category = runCategory(tc.toolName);
  if (live) {
    const key = category === "command" ? "toolRun.liveRunning" : category === "explore" ? "toolRun.liveReading" : "toolRun.liveUsing";
    return t(key, { target });
  }
  const key = category === "command" ? "toolRun.settledRunning" : category === "explore" ? "toolRun.settledReading" : "toolRun.settledUsing";
  return t(key, { target });
}

/**
 * One collapsed line standing in for a group of consecutive run-tool calls.
 *
 * Live (message streaming with unfinished calls): a one-line ticker narrating
 * the most recent action, plus a done/total counter. Settled: a past-tense
 * summary line. Clicking unfolds the full ToolCallBlock rows.
 *
 * A group containing a failed call auto-unfurls (until the user folds it back)
 * so an error row is never swallowed into the summary.
 */

