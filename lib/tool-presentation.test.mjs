import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  patchFromToolDetails,
  presenterFor,
  attachPresentationToMessages,
  scaffoldGroupFromCard,
  copyPresentationOntoToolCall,
} = await jiti.import("./tool-presentation.ts");

test("patchFromToolDetails reads top-level then nested results", () => {
  assert.equal(patchFromToolDetails({ patch: "A" }), "A");
  assert.equal(patchFromToolDetails({ diff: "B" }), "B");
  assert.equal(
    patchFromToolDetails({ results: [{ patch: "P1" }, { diff: "P2" }] }),
    "P1\nP2",
  );
  assert.equal(patchFromToolDetails({}), null);
});

test("unknown tool is generic with tool name as title", () => {
  const p = presenterFor("mcp").presentCall({ url: "https://x" });
  assert.equal(p.card, "generic");
  assert.equal(p.title, "mcp");
  assert.equal(p.preview, "https://x");
});

test("attach uses presentCall when no result", () => {
  const messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{ type: "toolCall", toolCallId: "c1", toolName: "mystery", input: { path: "z" } }],
  }];
  const out = attachPresentationToMessages(messages);
  assert.equal(out[0].content[0].presentation.card, "generic");
  assert.equal(out[0].content[0].presentation.title, "mystery");
});

test("scaffoldGroupFromCard maps cards without tool names", () => {
  assert.equal(scaffoldGroupFromCard("terminal"), "command");
  assert.equal(scaffoldGroupFromCard("read"), "explore");
  assert.equal(scaffoldGroupFromCard("search"), "explore");
  assert.equal(scaffoldGroupFromCard("web"), "explore");
  assert.equal(scaffoldGroupFromCard("generic"), "other");
  assert.equal(scaffoldGroupFromCard("diff"), "other");
});

test("copyPresentationOntoToolCall updates committed assistant by id", () => {
  const messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{
      type: "toolCall",
      toolCallId: "c1",
      toolName: "write",
      input: {},
      presentation: { card: "generic", title: "write" },
    }],
  }];
  const next = copyPresentationOntoToolCall(messages, "c1", {
    card: "diff",
    title: "write",
    patch: "P",
  });
  assert.equal(next[0].content[0].presentation.card, "diff");
  assert.equal(next[0].content[0].presentation.patch, "P");
});
