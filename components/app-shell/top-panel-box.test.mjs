import test from "node:test";
import assert from "node:assert/strict";
import { topPanelBoxFromRects } from "./top-panel-box.ts";

test("stops the overlay at the trailing rail", () => {
  assert.deepEqual(
    topPanelBoxFromRects({ left: 100, bottom: 36, width: 800 }, 863),
    { top: 36, left: 100, width: 763 },
  );
});

test("uses the full bar when there is no trailing rail", () => {
  assert.deepEqual(
    topPanelBoxFromRects({ left: 0, bottom: 36, width: 400 }, null),
    { top: 36, left: 0, width: 400 },
  );
});

test("does not invert when the rail is missing its box", () => {
  assert.deepEqual(
    topPanelBoxFromRects({ left: 50, bottom: 36, width: 200 }, 10),
    { top: 36, left: 50, width: 0 },
  );
});
