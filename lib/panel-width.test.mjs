import test from "node:test";
import assert from "node:assert/strict";
import { clampPanelWidth, panelWidthCap, parseStoredPanelWidth } from "./panel-width.ts";

test("clamps and rounds panel widths", () => {
  assert.equal(clampPanelWidth(199.4, 200, 480), 200);
  assert.equal(clampPanelWidth(481, 200, 480), 480);
  assert.equal(clampPanelWidth(272.6, 200, 480), 273);
});

test("caps against a viewport fraction", () => {
  assert.equal(panelWidthCap(480, 1000, 0.45), 450);
  assert.equal(panelWidthCap(480, 2000, 0.45), 480);
});

test("parses stored widths", () => {
  assert.equal(parseStoredPanelWidth("272"), 272);
  assert.equal(parseStoredPanelWidth("nope"), null);
  assert.equal(parseStoredPanelWidth(null), null);
});
