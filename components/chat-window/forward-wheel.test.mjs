import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { forwardWheelToScrollContainer } = await jiti.import("./chat-window-helpers.ts");

test("forwards pixel wheel delta into scrollTop", () => {
  const el = { scrollTop: 10, clientHeight: 400 };
  forwardWheelToScrollContainer(el, 40, 0);
  assert.equal(el.scrollTop, 50);
});

test("scales line and page delta modes", () => {
  const el = { scrollTop: 0, clientHeight: 200 };
  forwardWheelToScrollContainer(el, 2, 1);
  assert.equal(el.scrollTop, 32);
  forwardWheelToScrollContainer(el, 1, 2);
  assert.equal(el.scrollTop, 232);
});

test("no-ops on missing element or zero delta", () => {
  forwardWheelToScrollContainer(null, 10, 0);
  const el = { scrollTop: 5, clientHeight: 100 };
  forwardWheelToScrollContainer(el, 0, 0);
  assert.equal(el.scrollTop, 5);
});
