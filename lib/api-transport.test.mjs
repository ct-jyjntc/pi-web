import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");
const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(here, "..") } });

const { createSseParser } = await jiti.import("./api-transport.ts");

const encode = (s) => new TextEncoder().encode(s);

/** Collect (type, data) pairs the parser emits for a sequence of byte chunks. */
function run(chunks) {
  const seen = [];
  const parse = createSseParser((type, data) => seen.push([type, data]));
  for (const chunk of chunks) parse(encode(chunk));
  return seen;
}

test("parses a named event with data", () => {
  assert.deepEqual(run(["event: agent\ndata: hello\n\n"]), [["agent", "hello"]]);
});

test("defaults to the message type", () => {
  assert.deepEqual(run(["data: plain\n\n"]), [["message", "plain"]]);
});

test("joins multi-line data with newlines", () => {
  assert.deepEqual(run(["data: a\ndata: b\n\n"]), [["message", "a\nb"]]);
});

test("emits nothing until the blank-line boundary arrives", () => {
  const seen = [];
  const parse = createSseParser((type, data) => seen.push([type, data]));
  parse(encode("event: partial\ndata: half"));
  assert.deepEqual(seen, []);
  parse(encode(" way\n\n"));
  assert.deepEqual(seen, [["partial", "half way"]]);
});

test("splits several events in one chunk", () => {
  assert.deepEqual(run(["data: one\n\ndata: two\n\n"]), [
    ["message", "one"],
    ["message", "two"],
  ]);
});

test("survives an event split across chunk boundaries mid-frame", () => {
  assert.deepEqual(run(["event: a\nda", "ta: split\n", "\n"]), [["a", "split"]]);
});

test("handles CRLF framing", () => {
  assert.deepEqual(run(["event: crlf\r\ndata: x\r\n\r\n"]), [["crlf", "x"]]);
});

test("ignores comments and keeps surrounding events", () => {
  assert.deepEqual(run([": keep-alive\n\ndata: real\n\n"]), [["message", "real"]]);
});

test("does not split a multi-byte character across chunks", () => {
  const bytes = new TextEncoder().encode("data: 中文\n\n");
  const seen = [];
  const parse = createSseParser((type, data) => seen.push([type, data]));
  parse(bytes.slice(0, 8));
  parse(bytes.slice(8));
  assert.deepEqual(seen, [["message", "中文"]]);
});
