import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-session-start.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("custom extension UI receives the fixed headless terminal facade", async () => {
  const source = await readFile(new URL("./rpc-session-wrapper.ts", import.meta.url), "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
});

test("rpc-manager façade re-exports split modules without a second registry", async () => {
  const façade = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(façade, /from "\.\/rpc-session-wrapper"/);
  assert.match(façade, /from "\.\/rpc-registry"/);
  assert.match(façade, /from "\.\/rpc-session-start"/);
  assert.doesNotMatch(façade, /__piSessions\s*=/);
});

test("set_tools waits for extension bind and re-adopts factory tools", async () => {
  const source = await readFile(new URL("./rpc-session-wrapper.ts", import.meta.url), "utf8");
  const waitSource = source.slice(
    source.indexOf("private shouldWaitForExtensions"),
    source.indexOf("private applyForcedEmptySystemPrompt"),
  );
  assert.match(waitSource, /set_tools/);

  const bindSource = source.slice(
    source.indexOf("this.extensionsBound = true"),
    source.indexOf("this.extensionBindingPromise = null"),
  );
  assert.match(bindSource, /adoptBaseToolNames\(this\.baseToolNames\)/);
});

test("first-party factories include native subagents", async () => {
  const source = await readFile(new URL("./first-party/index.ts", import.meta.url), "utf8");
  assert.match(source, /createSubagentsInlineExtension/);
  assert.match(source, /createPermissionInlineExtension/);
  assert.match(source, /createMcpInlineExtension/);
  assert.doesNotMatch(source, /@gotgenes\/pi-subagents/);
});
