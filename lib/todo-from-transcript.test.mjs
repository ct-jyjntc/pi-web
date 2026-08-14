import assert from "node:assert/strict";
import test from "node:test";

async function load() {
  return import("./todo-from-transcript.ts");
}

test("formatTodoWidgetLines encodes in_progress activeForm", async () => {
  const { formatTodoWidgetLines } = await load();
  const lines = formatTodoWidgetLines([
    { id: 1, subject: "Research existing tool", status: "in_progress", activeForm: "reading parsers" },
    { id: 2, subject: "Implement parser", status: "pending" },
  ]);
  assert.ok(lines);
  assert.match(lines[0], /Todo \(0\/2\)/);
  assert.ok(lines.some((l) => l.includes("#1 Research existing tool (reading parsers)")));
});

test("formatTodoWidgetLines returns null when empty", async () => {
  const { formatTodoWidgetLines } = await load();
  assert.equal(formatTodoWidgetLines([]), null);
  assert.equal(formatTodoWidgetLines([{ id: 1, subject: "gone", status: "deleted" }]), null);
});
