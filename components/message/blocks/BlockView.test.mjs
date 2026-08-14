import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { BlockView } = await jiti.import("./BlockView.tsx");

function renderToolCall(block) {
  return renderToStaticMarkup(
    React.createElement(BlockView, { block, blockIndex: 0 }),
  );
}

test("hides a row only when presentation.hoist is set", () => {
  const hoisted = renderToolCall({
    type: "toolCall",
    toolCallId: "1",
    toolName: "custom",
    input: {},
    presentation: { card: "generic", title: "x", hoist: true },
  });
  assert.equal(hoisted, "");

  const namedTodo = renderToolCall({
    type: "toolCall",
    toolCallId: "2",
    toolName: "todo",
    input: {},
  });
  assert.notEqual(namedTodo, "");
});
