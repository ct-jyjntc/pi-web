import assert from "node:assert/strict";
import test from "node:test";

async function load() {
  return import("./todo-from-transcript.ts");
}

function toolResult(text, toolCallId = "c1") {
  return {
    role: "toolResult",
    toolCallId,
    content: [{ type: "text", text }],
  };
}

function assistantTodoCalls(...ids) {
  return {
    role: "assistant",
    provider: "test",
    model: "m",
    content: ids.map((id) => ({
      type: "toolCall",
      toolCallId: id,
      toolName: "todo",
      input: {},
    })),
  };
}

test("derives todos from create + update + list results", async () => {
  const { deriveTodosFromTranscript, deriveTodoWidgetLines } = await load();
  const messages = [
    assistantTodoCalls("a", "b", "c", "d", "e"),
    toolResult("Created #1: 侦察当前目录结构 (pending)", "a"),
    toolResult("Created #2: 统计 TypeScript 文件数量 (pending)", "b"),
    toolResult("Created #3: 写一份简短结论 (pending)", "c"),
    toolResult("[pending] #1 侦察当前目录结构\n[pending] #2 统计 TypeScript 文件数量\n[pending] #3 写一份简短结论", "d"),
    toolResult("Updated #1 (pending → in_progress)", "e"),
  ];

  const items = deriveTodosFromTranscript(messages);
  assert.equal(items.length, 3);
  assert.equal(items[0].status, "in_progress");
  assert.equal(items[1].status, "pending");
  assert.equal(items[2].subject, "写一份简短结论");

  const lines = deriveTodoWidgetLines(messages);
  assert.ok(lines);
  assert.match(lines[0], /Todo \(0\/3\)|Todo \(1\/3\)/);
  assert.ok(lines.some((l) => l.includes("#1")));
});

test("returns null when no todos", async () => {
  const { deriveTodoWidgetLines } = await load();
  assert.equal(deriveTodoWidgetLines([]), null);
});
