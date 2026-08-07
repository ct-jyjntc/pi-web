import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { shouldDismissMenuOnScroll } = await jiti.import("./menu-dismiss.ts");

test("ignores scroll inside the menu element", () => {
  const menu = { contains: (n) => n === "inside" };
  assert.equal(shouldDismissMenuOnScroll({ target: "inside" }, menu), false);
});

test("ignores scroll from chat transcript scroller", () => {
  const chat = {
    closest(sel) {
      return sel.includes("chat-scroll-area") ? this : null;
    },
  };
  assert.equal(shouldDismissMenuOnScroll({ target: chat }, null), false);
});

test("dismisses scroll from other regions", () => {
  const sidebar = {
    closest() {
      return null;
    },
  };
  assert.equal(shouldDismissMenuOnScroll({ target: sidebar }, null), true);
  assert.equal(shouldDismissMenuOnScroll({ target: null }, null), true);
});
