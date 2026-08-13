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
  it("hides when nothing is running or queued", () => {
    assert.equal(widget.formatAgentWidgetLines([
      {
        id: "1",
        type: "Explore",
        displayName: "Explore",
        description: "Scout files",
        status: "completed",
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
      },
    ]), undefined);
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
