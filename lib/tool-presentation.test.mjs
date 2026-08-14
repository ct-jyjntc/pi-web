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
const { normalizeToolCalls } = await jiti.import("./normalize.ts");

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

test("normalize then attach presents SDK-shaped streaming snapshot", () => {
  const snapshot = {
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }],
  };
  const presented = attachPresentationToMessages([normalizeToolCalls(snapshot)])[0];
  assert.equal(presented.content[0].presentation.card, "terminal");
  assert.equal(presented.content[0].presentation.command, "ls");
});

test("copyPresentationOntoToolCall keeps presentCall title when result used empty args", () => {
  const messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{
      type: "toolCall",
      toolCallId: "c1",
      toolName: "write",
      input: { path: "a.ts" },
      presentation: { card: "generic", title: "a.ts", locations: ["a.ts"] },
    }],
  }];
  const next = copyPresentationOntoToolCall(messages, "c1", {
    card: "diff",
    title: "write",
    patch: "@@",
  });
  assert.equal(next[0].content[0].presentation.card, "diff");
  assert.equal(next[0].content[0].presentation.patch, "@@");
  assert.equal(next[0].content[0].presentation.title, "a.ts");
  assert.deepEqual(next[0].content[0].presentation.locations, ["a.ts"]);
});

function copyEmptyArgsResult(toolName, callArgs) {
  const call = presenterFor(toolName).presentCall(callArgs);
  const result = presenterFor(toolName).presentResult({}, { content: [] });
  const messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{
      type: "toolCall",
      toolCallId: "c1",
      toolName,
      input: callArgs,
      presentation: call,
    }],
  }];
  return copyPresentationOntoToolCall(messages, "c1", result)[0].content[0].presentation;
}

test("copyPresentationOntoToolCall keeps presentCall titles across empty-args results", () => {
  const web = copyEmptyArgsResult("web_search", { query: "foo" });
  assert.equal(web.title, "foo");
  assert.equal(web.query, "foo");
  assert.equal(web.card, "web");

  const grep = copyEmptyArgsResult("grep", { pattern: "foo" });
  assert.equal(grep.title, "foo");
  assert.equal(grep.query, "foo");
  assert.equal(grep.card, "search");

  const ask = copyEmptyArgsResult("ask_user_question", { question: "foo" });
  assert.equal(ask.title, "foo");
  assert.equal(ask.card, "ask");
});

test("first-party presenters match the spec table", () => {
  assert.equal(presenterFor("edit").presentCall({ path: "a.ts" }).card, "diff");
  assert.deepEqual(presenterFor("edit").presentCall({ path: "a.ts" }).locations, ["a.ts"]);

  const writeNoPatch = presenterFor("write").presentResult({ path: "b.ts" }, { content: [], details: {} });
  assert.equal(writeNoPatch.card, "generic");
  const writePatch = presenterFor("write").presentResult({ path: "b.ts" }, {
    content: [],
    details: { results: [{ patch: "@@" }] },
  });
  assert.equal(writePatch.card, "diff");
  assert.equal(writePatch.patch, "@@");

  assert.equal(presenterFor("read").presentCall({ path: "c.ts" }).card, "read");
  assert.equal(presenterFor("bash").presentCall({ command: "ls" }).card, "terminal");
  assert.equal(presenterFor("bash").presentCall({ command: "ls" }).command, "ls");
  assert.equal(presenterFor("grep").presentCall({ pattern: "x" }).card, "search");
  assert.equal(presenterFor("find").presentCall({}).card, "search");
  assert.equal(presenterFor("ls").presentCall({}).card, "search");
  assert.equal(presenterFor("glob").presentCall({}).card, "search");
  assert.equal(presenterFor("web_fetch").presentCall({ url: "https://x" }).card, "web");
  assert.equal(presenterFor("web_search").presentCall({ query: "q" }).card, "web");
  assert.equal(presenterFor("ask_user_question").presentCall({}).card, "ask");
  const todo = presenterFor("todo").presentCall({});
  assert.equal(todo.hoist, true);
  assert.equal(patchFromToolDetails({ results: [{ patch: "P1" }] }), "P1");
});

test("edit presentCall extracts hashline path, not the patch blob", () => {
  const p = presenterFor("edit").presentCall({
    input: "[a.ts#A1B2]\nSWAP 1:=1:\n+x",
  });
  const hay = `${p.title}\n${(p.locations ?? []).join("\n")}`;
  assert.match(hay, /(?:^|\n)a\.ts(?:\n|$)/);
  assert.doesNotMatch(hay, /SWAP/);
  assert.ok(!String(p.title).includes("SWAP"));
  assert.ok(!(p.locations ?? []).some((loc) => loc.includes("SWAP")));
});

test("edit presentCall ignores hashline-shaped tags in SWAP body", () => {
  const p = presenterFor("edit").presentCall({
    input: "[real.ts#A1B2]\nSWAP 1:=1:\n+[fake.ts#CDEF]\n+x",
  });
  assert.deepEqual(p.locations, ["real.ts"]);
  assert.equal(p.title, "real.ts");
});

test("edit presentResult uses details.results[].path", () => {
  const p = presenterFor("edit").presentResult({}, {
    content: [],
    details: { results: [{ path: "b.ts", patch: "@@" }] },
  });
  assert.ok((p.locations ?? []).includes("b.ts"));
});

test("edit presentResult prefers hashline header over result absolute path", () => {
  const p = presenterFor("edit").presentResult(
    { input: "[src/real.ts#A1B2]\nSWAP 1:=1:\n+x" },
    { content: [], details: { results: [{ path: "/abs/src/real.ts", patch: "@@" }] } },
  );
  assert.deepEqual(p.locations, ["src/real.ts"]);
  assert.equal(p.title, "src/real.ts");
});

test("attach pairs edit toolResult and concatenates nested patches", () => {
  const messages = [
    {
      role: "assistant",
      model: "m",
      provider: "p",
      content: [{ type: "toolCall", toolCallId: "c1", toolName: "edit", input: { path: "a.ts" } }],
    },
    {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "edit",
      content: [{ type: "text", text: "ok" }],
      details: { results: [{ patch: "@@ a" }, { patch: "@@ b" }] },
      isError: false,
    },
  ];
  const out = attachPresentationToMessages(messages);
  const pres = out[0].content[0].presentation;
  assert.equal(pres.card, "diff");
  assert.equal(pres.patch, "@@ a\n@@ b");
  assert.deepEqual(pres.locations, ["a.ts"]);
});
