import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  parseAgentItems,
  agentListCounts,
} = await jiti.import("./extension-widget-agents.ts");
const {
  parseWidget,
  chromeWidgetFocus,
  chromeWidgetIsIdle,
} = await jiti.import("./extension-widgets.ts");

const SAMPLE = [
  "● Agents",
  "├─ ✓ Explore  Find auth files · ↻2 · 3 tool uses · 4.2s",
  "├─ ⠋ Reviewer  Check the diff · ↻1 · 1.1s",
  "│  ⎿  Reading lib/foo.ts",
  "└─ ◦ 2 queued",
];

test("parseAgentItems reads running / finished / queued rows", () => {
  const items = parseAgentItems(SAMPLE);
  assert.equal(items.length, 3);
  assert.equal(items[0].status, "completed");
  assert.equal(items[0].type, "Explore");
  assert.equal(items[0].description, "Find auth files");
  assert.equal(items[1].status, "running");
  assert.equal(items[1].type, "Reviewer");
  assert.equal(items[1].description, "Check the diff");
  assert.equal(items[1].activity, "Reading lib/foo.ts");
  assert.equal(items[2].status, "queued");
  assert.equal(items[2].queuedCount, 2);
  const counts = agentListCounts(items);
  assert.equal(counts.runningCount, 1);
  assert.equal(counts.queuedCount, 2);
  assert.equal(counts.agentCount, 4);
});

test("chromeWidgetFocus prefers the running agent description", () => {
  assert.equal(chromeWidgetFocus("agents", SAMPLE), "Check the diff");
  assert.equal(chromeWidgetIsIdle("agents", SAMPLE), false);
});

test("chromeWidgetIsIdle when only finished agents remain", () => {
  const lines = [
    "○ Agents",
    "└─ ✓ Explore  Find auth files · ↻2 · 4.2s",
  ];
  const parsed = parseWidget("agents", lines);
  assert.equal(parsed.kind, "agents");
  assert.equal(parsed.runningCount, 0);
  assert.equal(chromeWidgetIsIdle("agents", lines), true);
  assert.equal(chromeWidgetFocus("agents", lines), "Find auth files");
});

test("todo focus uses in_progress activeForm when encoded", () => {
  const lines = [
    "Todo (1/3)",
    "├─ ◐ #1 Research existing tool (reading parsers)",
    "└─ ○ #2 Implement parser",
  ];
  assert.equal(chromeWidgetFocus("rpiv-todos", lines), "reading parsers");
  assert.equal(chromeWidgetIsIdle("rpiv-todos", lines), false);
});

test("todo capsule is idle when every item is completed", () => {
  const lines = [
    "Todo (2/2)",
    "├─ ✓ #1 One",
    "└─ ✓ #2 Two",
  ];
  assert.equal(chromeWidgetIsIdle("rpiv-todos", lines), true);
  assert.equal(chromeWidgetFocus("rpiv-todos", lines), "");
});
