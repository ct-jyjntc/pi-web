import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
/** @type {typeof import("./oauth.ts")} */
let oauth;

before(async () => {
  oauth = await jiti.import("./oauth.ts");
});

describe("parseAuthorizationInput", () => {
  it("reads code from a full redirect URL", () => {
    assert.equal(
      oauth.parseAuthorizationInput("http://127.0.0.1:19876/callback?code=abc123&state=x"),
      "abc123",
    );
  });

  it("accepts a raw code", () => {
    assert.equal(oauth.parseAuthorizationInput("abc123"), "abc123");
  });

  it("rejects empty input", () => {
    assert.throws(() => oauth.parseAuthorizationInput("  "), /empty/i);
  });
});
