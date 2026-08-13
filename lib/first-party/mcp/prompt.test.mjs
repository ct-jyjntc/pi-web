import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildMcpPromptCopy, enabledMcpServerNames } = await jiti.import("./prompt.ts");

test("empty copy does not claim a configured server", () => {
  const copy = buildMcpPromptCopy([]);
  assert.match(copy.promptSnippet, /No MCP servers configured/i);
  assert.doesNotMatch(copy.promptSnippet, /Call a configured/i);
  assert.match(copy.description, /Do not call this tool/i);
  assert.match(copy.description, /web_fetch/i);
  assert.match(copy.description, /bash/i);
  assert.ok(copy.promptGuidelines.length >= 1);
  assert.match(copy.promptGuidelines.join(" "), /Do not call mcp/i);
});

test("configured copy lists live server names", () => {
  const copy = buildMcpPromptCopy(["playwright", "github"]);
  assert.equal(copy.promptSnippet, "Call tools on MCP servers: playwright, github");
  assert.match(copy.description, /playwright, github/);
  assert.match(copy.description, /search\/describe first/i);
  assert.doesNotMatch(copy.description, /Do not call this tool/);
});

test("enabledMcpServerNames drops disabled and blank names", () => {
  assert.deepEqual(
    enabledMcpServerNames([
      { name: "playwright" },
      { name: "old-browser", disabled: true },
      { name: "  " },
      { name: "github", disabled: false },
    ]),
    ["playwright", "github"],
  );
});
