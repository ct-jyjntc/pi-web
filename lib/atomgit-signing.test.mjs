import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signAtomGitRequest } from "./atomgit-signing.ts";

describe("atomgit-signing v1", () => {
  it("produces stable headers for fixed inputs", () => {
    const headers = signAtomGitRequest({
      method: "POST",
      path: "/v1/chat/completions",
      body: Buffer.from('{"model":"deepseek-v4-flash"}'),
      oauthToken: "test-token",
      userId: "user-123",
      clientVersion: "1.0.0",
      timestampUnix: 1_700_000_000,
      nonce: Buffer.alloc(16, 0xab),
    });
    assert.equal(headers["X-AtomCode-Alg"], "1");
    assert.equal(headers["X-AtomCode-Ver"], "1.0.0");
    assert.equal(headers["X-AtomCode-Ts"], "1700000000");
    assert.equal(headers["X-AtomCode-Nonce"], "abababababababababababababababab");
    assert.match(headers["X-AtomCode-Sig"], /^v1:[0-9a-f]{64}$/);
    // Golden signature for the fixed inputs above (algorithm regression guard).
    assert.equal(
      headers["X-AtomCode-Sig"],
      "v1:f50eed019db7837fdddca4ea3c253bb46e54de4cb09cf7396b7f193cbf6edf47",
    );
  });

  it("rejects non-16-byte nonce", () => {
    assert.throws(
      () =>
        signAtomGitRequest({
          method: "POST",
          path: "/v1/chat/completions",
          body: Buffer.from("{}"),
          oauthToken: "t",
          userId: "u",
          nonce: Buffer.alloc(8),
        }),
      /16 bytes/,
    );
  });
});
