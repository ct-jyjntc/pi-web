/**
 * Tool-run grouping and title helpers for transcript scaffold lines.
 */
import type { AssistantContentBlock, ToolCallContent } from "@/lib/types";
import { scaffoldGroupFromCard, type ScaffoldGroup, type ToolCardKind } from "@/lib/tool-presentation";
import type { TFn } from "./message-view-utils";
import { getToolPreview } from "./message-view-utils";

export interface BlockItem {
  block: AssistantContentBlock;
  originalIndex: number;
}

export type DisplayItem =
  | { kind: "block"; item: BlockItem }
  | { kind: "run"; items: BlockItem[] };

function cardOf(block: ToolCallContent): ToolCardKind {
  return block.presentation?.card ?? "generic";
}

function isCard(card: ToolCardKind): boolean {
  return card === "diff" || card === "ask";
}

function targetOf(tc: ToolCallContent): string {
  return tc.presentation?.title || tc.presentation?.preview || getToolPreview(tc) || tc.toolName;
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
    if (item.block.type === "toolCall") {
      const tc = item.block as ToolCallContent;
      // Hoisted tools (todo) skip the transcript run group. Missing presentation is generic.
      if (tc.presentation?.hoist) {
        flush();
        continue;
      }
      if (!isCard(cardOf(tc))) {
        run.push(item);
        continue;
      }
    }
    flush();
    out.push({ kind: "block", item });
  }
  flush();
  return out;
}

/** Settled group line — "Ran 5 commands · Read 3 files". Clause order is fixed. */
export function settledRunLine(runs: ToolCallContent[], t: TFn): string {
  // Single call: name the target like Hermes ("Read foo.ts"), not "Read 1 file".
  if (runs.length === 1) return scaffoldToolTitle(runs[0]!, false, t);
  const counts: Record<ScaffoldGroup, number> = { command: 0, explore: 0, other: 0 };
  for (const tc of runs) counts[scaffoldGroupFromCard(cardOf(tc))]++;
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
  const target = targetOf(tc);
  const category = scaffoldGroupFromCard(cardOf(tc));
  if (live) {
    const key = category === "command" ? "toolRun.liveRunning" : category === "explore" ? "toolRun.liveReading" : "toolRun.liveUsing";
    return t(key, { target });
  }
  const key = category === "command" ? "toolRun.settledRunning" : category === "explore" ? "toolRun.settledReading" : "toolRun.settledUsing";
  return t(key, { target });
}
