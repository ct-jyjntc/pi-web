import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "../app/api/auth/api-key/[provider]/route.ts"),
  "utf8",
);

test("API key saves do not use ModelRuntime.login's network refresh", () => {
  assert.doesNotMatch(source, /modelRuntime\.login\(/);
  assert.match(source, /apiKeyAuth\.login\(/);
  assert.match(source, /signal:\s*req\.signal/);
  assert.match(source, /storeProviderCredential\(provider, credential\)/);
});
