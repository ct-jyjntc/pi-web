import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
/** @type {typeof import("./agent-session-extension-ui.ts")} */
const { applyExtensionUiRequest } = await jiti.import("./agent-session-extension-ui.ts");

function handlers() {
  /** @type {{ dialog: any, custom: any }} */
  const state = { dialog: { id: "dlg-1" }, custom: { id: "dlg-1" } };
  return {
    state,
    setExtensionDialog(next) {
      state.dialog = typeof next === "function" ? next(state.dialog) : next;
    },
    setExtensionCustomUi(next) {
      state.custom = typeof next === "function" ? next(state.custom) : next;
    },
    setExtensionStatuses() {},
    setExtensionWidgets() {},
    addNotice() {},
  };
}

describe("applyExtensionUiRequest dismiss", () => {
  it("clears the matching dialog and custom panel", () => {
    const h = handlers();
    applyExtensionUiRequest({ type: "extension_ui_request", id: "dlg-1", method: "dismiss" }, h);
    assert.equal(h.state.dialog, null);
    assert.equal(h.state.custom, null);
  });

  it("leaves a different dialog open", () => {
    const h = handlers();
    applyExtensionUiRequest({ type: "extension_ui_request", id: "other", method: "dismiss" }, h);
    assert.equal(h.state.dialog?.id, "dlg-1");
    assert.equal(h.state.custom?.id, "dlg-1");
  });
});
