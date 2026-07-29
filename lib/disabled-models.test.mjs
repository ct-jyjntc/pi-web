import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { filterDisabledModels, getDisabledModelRefs, isModelDisabled } from "./disabled-models.ts";

test("reads disabled model refs from models.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-disabled-models-"));
  const path = join(dir, "models.json");
  writeFileSync(path, JSON.stringify({
    providers: {
      custom: {
        models: [
          { id: "on", name: "On" },
          { id: "off", name: "Off", disabled: true },
          { id: "off-false", disabled: false },
          { id: "", disabled: true },
          { disabled: true },
        ],
      },
      other: {
        models: [{ id: "x", disabled: true }],
      },
    },
  }), "utf8");

  try {
    const refs = getDisabledModelRefs(path);
    assert.equal(refs.has("custom/off"), true);
    assert.equal(refs.has("custom/on"), false);
    assert.equal(refs.has("custom/off-false"), false);
    assert.equal(refs.has("custom/"), false);
    assert.equal(refs.has("other/x"), true);
    assert.equal(isModelDisabled("custom", "off", refs), true);
    assert.equal(isModelDisabled("custom", "on", refs), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("filters available models by disabled refs", () => {
  const available = [
    { provider: "a", id: "1" },
    { provider: "a", id: "2" },
    { provider: "b", id: "1" },
  ];
  const disabled = new Set(["a/2", "b/1"]);
  assert.deepEqual(filterDisabledModels(available, disabled), [{ provider: "a", id: "1" }]);
  assert.deepEqual(filterDisabledModels(available, new Set()), available);
});

test("missing or corrupt models.json yields empty disabled set", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-disabled-models-missing-"));
  try {
    assert.equal(getDisabledModelRefs(join(dir, "nope.json")).size, 0);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json", "utf8");
    assert.equal(getDisabledModelRefs(bad).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
