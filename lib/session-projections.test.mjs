import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("peekTodoState does not insert", async () => {
  const todo = await jiti.import("./first-party/todo-extension.ts");
  assert.equal(todo.peekTodoState("missing-session"), undefined);
  assert.equal(todo.peekTodoState("missing-session"), undefined);
});

test("fold todos from last todo toolResult details.tasks", async () => {
  const { foldProjections } = await jiti.import("./session-projections.ts");
  const tasks = [{ id: 1, subject: "A", status: "pending" }];
  const folded = foldProjections({
    sessionId: "s1",
    title: "Hello",
    messages: [
      { role: "user", content: "go" },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "todo",
        content: [{ type: "text", text: "ok" }],
        details: { action: "list", params: {}, tasks, nextId: 2 },
      },
    ],
    contextPressure: { tokens: 10, contextWindow: 100, percent: 10 },
  });
  assert.deepEqual(folded.todos, tasks);
  assert.equal(folded.title, "Hello");
  assert.equal(folded.tokenUsage.userMessages, 1);
  assert.equal(folded.contextPressure?.tokens, 10);
});

test("no todo result yields null todos", async () => {
  const { foldProjections } = await jiti.import("./session-projections.ts");
  const folded = foldProjections({
    sessionId: "s1",
    title: null,
    messages: [{ role: "user", content: "x" }],
    contextPressure: null,
  });
  assert.equal(folded.todos, null);
});

test("one field failure does not fail the fold", async () => {
  const { foldProjections } = await jiti.import("./session-projections.ts");
  const folded = foldProjections({
    sessionId: "s1",
    title: "t",
    messages: null, // foldTokenUsage must catch
    contextPressure: null,
  });
  assert.equal(folded.title, "t");
  assert.equal(folded.todos, null);
});
