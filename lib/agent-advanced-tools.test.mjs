import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("debug_run aborted signal returns promptly", { timeout: 4000 }, async () => {
  const { createAdvancedTools } = await jiti.import("./agent-advanced-tools.ts");
  const [debugRun] = createAdvancedTools({ cwd: process.cwd() }).filter((t) => t.name === "debug_run");
  const ac = new AbortController();
  ac.abort();
  const t0 = Date.now();
  const result = await debugRun.execute("id", { command: "sleep 30", timeoutMs: 5000 }, ac.signal);
  assert.ok(Date.now() - t0 < 3_000);
  assert.equal(result.isError, true);
});
