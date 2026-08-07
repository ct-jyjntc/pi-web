/** Single-flight + local-only materialize ownership. */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("materialize rejects empty provider id", async () => {
  const { materializeBuiltinProviderCatalog } = await jiti.import(
    "./builtin-provider-models-fresh.ts",
  );
  await assert.rejects(
    () => materializeBuiltinProviderCatalog("  "),
    /provider is required/,
  );
});

test("refreshBuiltinProviderModels is local-only (returns live=false)", async () => {
  const { refreshBuiltinProviderModels } = await jiti.import("./builtin-provider-models.ts");
  let sawAllowNetwork;
  const fakeRuntime = {
    async refresh(options = {}) {
      sawAllowNetwork = options.allowNetwork;
    },
  };
  const live = await refreshBuiltinProviderModels(fakeRuntime, "xai");
  assert.equal(live, false);
  assert.equal(sawAllowNetwork, false);
});
