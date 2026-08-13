import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildCapabilityBrief } = await jiti.import("./capability-brief.ts");

test("capability brief forbids hidden tools and invented browsers", () => {
  const text = buildCapabilityBrief();
  assert.match(text, /## Capabilities/);
  assert.match(text, /does not add hidden tools/);
  assert.match(text, /web_fetch/);
  assert.match(text, /do not launch Playwright/i);
  assert.match(text, /Do not use bash for cat/);
  assert.doesNotMatch(text, /Call a configured MCP/);
});
