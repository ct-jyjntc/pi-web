import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

describe("fileAccessDenied", () => {
  it("returns path, reason, sample roots, and actionable hint", async () => {
    const { fileAccessDenied } = await jiti.import("./file-access.ts");
    const roots = new Set(["/Users/luna/Desktop/pi-web", "/tmp/other"]);
    const body = fileAccessDenied("/tmp/secret/x.ts", roots, "not_in_roots");
    assert.equal(body.error, "Access denied");
    assert.equal(body.path, "/tmp/secret/x.ts");
    assert.equal(body.reason, "not_in_roots");
    assert.equal(body.rootCount, 2);
    assert.ok(body.rootsSample.includes("/Users/luna/Desktop/pi-web"));
    assert.match(body.hint, /allowed root/i);
  });

  it("hints when no roots are loaded", async () => {
    const { fileAccessDenied } = await jiti.import("./file-access.ts");
    const body = fileAccessDenied("/x", new Set(), "not_in_roots");
    assert.equal(body.rootCount, 0);
    assert.match(body.hint, /No allowed roots/i);
  });

  it("hints absolute-path encoding for relative targets", async () => {
    const { fileAccessDenied } = await jiti.import("./file-access.ts");
    const body = fileAccessDenied("__save_test.ts", new Set(["/proj"]), "not_in_roots");
    assert.match(body.hint, /absolute path/i);
  });
});
