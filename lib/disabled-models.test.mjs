import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { pathToFileURL } from "node:url";

// jiti so we can load .ts without Node ESM extension resolution (production code
// imports `./agent-dir` extensionless for Next/tsc bundler resolution).
const jiti = createJiti(import.meta.url);
const {
  filterDisabledModels,
  getBuiltinDisabledModelRefs,
  getDisabledModelRefs,
  isModelDisabled,
  setBuiltinModelDisabled,
} = await jiti.import("./disabled-models.ts");

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
    const refs = getDisabledModelRefs(path, join(dir, "disabled-models.json"));
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

test("merges dedicated disabled-models.json with models.json flags", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-disabled-merge-"));
  const modelsPath = join(dir, "models.json");
  const listPath = join(dir, "disabled-models.json");
  writeFileSync(modelsPath, JSON.stringify({
    providers: {
      custom: { models: [{ id: "a", disabled: true }] },
    },
  }), "utf8");
  writeFileSync(listPath, JSON.stringify(["tokenrhythm/deepseek-v4-flash", "bad", "x/"]), "utf8");

  try {
    const refs = getDisabledModelRefs(modelsPath, listPath);
    assert.equal(refs.has("custom/a"), true);
    assert.equal(refs.has("tokenrhythm/deepseek-v4-flash"), true);
    assert.equal(refs.has("bad"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("setBuiltinModelDisabled writes denylist file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-disabled-set-"));
  const listPath = join(dir, "disabled-models.json");
  try {
    const off = setBuiltinModelDisabled("tokenrhythm", "glm-5.2", true, listPath);
    assert.equal(off.ok, true);
    assert.equal(getBuiltinDisabledModelRefs(listPath).has("tokenrhythm/glm-5.2"), true);
    assert.equal(existsSync(listPath), true);
    const raw = JSON.parse(readFileSync(listPath, "utf8"));
    assert.deepEqual(raw, ["tokenrhythm/glm-5.2"]);

    const on = setBuiltinModelDisabled("tokenrhythm", "glm-5.2", false, listPath);
    assert.equal(on.ok, true);
    assert.equal(getBuiltinDisabledModelRefs(listPath).has("tokenrhythm/glm-5.2"), false);
    assert.deepEqual(JSON.parse(readFileSync(listPath, "utf8")), []);
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
    assert.equal(getDisabledModelRefs(join(dir, "nope.json"), join(dir, "nope-list.json")).size, 0);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json", "utf8");
    assert.equal(getDisabledModelRefs(bad, join(dir, "missing-list.json")).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
