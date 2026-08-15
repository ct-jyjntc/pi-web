import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
/** @type {typeof import("./widget.ts")} */
let widget;
/** @type {typeof import("../../extension-widget-agents.ts")} */
let parse;
/** @type {typeof import("../../extension-widgets.ts")} */
let chrome;

before(async () => {
  widget = await jiti.import("./widget.ts");
  parse = await jiti.import("../../extension-widget-agents.ts");
  chrome = await jiti.import("../../extension-widgets.ts");
});

describe("formatAgentWidgetLines", () => {
  it("emits completed agents so chrome can open them", () => {
    const lines = widget.formatAgentWidgetLines([
      {
        id: "1",
        type: "Explore",
        displayName: "Explore",
        description: "Scout files",
        status: "completed",
        sessionId: "01234567-89ab-4def-8123-456789abcdef",
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
      },
    ]);
    assert.ok(lines);
    const items = parse.parseAgentItems(lines);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "completed");
    assert.equal(items[0].sessionId, "01234567-89ab-4def-8123-456789abcdef");
  });

  it("emits nested descendants and parses depth/parent", () => {
    const parent = "01234567-89ab-4def-8123-456789abcdef";
    const child = "11234567-89ab-4def-8123-456789abcdef";
    const lines = widget.formatAgentWidgetLines([
      {
        id: "1",
        type: "Explore",
        displayName: "Explore",
        description: "Parent scout",
        status: "completed",
        sessionId: parent,
        startedAt: Date.now() - 2000,
        completedAt: Date.now(),
        depth: 1,
      },
      {
        id: "2",
        type: "Explore",
        displayName: "Explore",
        description: "Nested scout",
        status: "completed",
        sessionId: child,
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
        depth: 2,
        parentSessionId: parent,
      },
    ]);
    assert.ok(lines);
    const items = parse.parseAgentItems(lines);
    assert.equal(items.length, 2);
    assert.equal(items[1].depth, 2);
    assert.equal(items[1].parentId, parent);
    assert.match(lines[2], /^│ {2}└─/);
  });

  it("keeps last activity on completed agents", () => {
    const lines = widget.formatAgentWidgetLines([
      {
        id: "1",
        type: "Explore",
        displayName: "Explore",
        description: "Scout files",
        status: "completed",
        activity: "Read lib/foo.ts",
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
      },
    ]);
    assert.ok(lines);
    const items = parse.parseAgentItems(lines);
    assert.equal(items[0].activity, "Read lib/foo.ts");
  });

  it("emits lines the existing chrome parser understands", () => {
    const startedAt = Date.now() - 1100;
    const lines = widget.formatAgentWidgetLines([
      {
        id: "1",
        type: "Explore",
        displayName: "Explore",
        description: "Find auth files",
        status: "running",
        activity: "Reading lib/foo.ts",
        contextPercent: 12.4,
        contextTokens: 3200,
        startedAt,
      },
    ]);
    assert.ok(lines);
    const items = parse.parseAgentItems(lines);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "running");
    assert.equal(items[0].type, "Explore");
    assert.equal(items[0].percent, 12);
    assert.equal(items[0].tokens, 3200);
    assert.equal(items[0].startedAt, startedAt);
    assert.equal(chrome.chromeWidgetIsIdle("agents", lines), false);
  });
});
