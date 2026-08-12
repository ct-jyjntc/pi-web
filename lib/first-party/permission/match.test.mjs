import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
/** @type {typeof import("./match.ts")} */
let match;

before(async () => {
  match = await jiti.import("./match.ts");
});

describe("permission matchers", () => {
  it("matches bash globs", () => {
    assert.equal(match.matchBashPattern("git status", "git status"), true);
    assert.equal(match.matchBashPattern("git diff*", "git diff --stat"), true);
    assert.equal(match.matchBashPattern("sudo *", "sudo rm -rf /"), true);
    assert.equal(match.matchBashPattern("git status", "git log"), false);
  });

  it("splits chained bash commands without breaking quoted text", () => {
    assert.deepEqual(match.splitBashCommands("echo hi && rm -rf /"), ["echo hi", "rm -rf /"]);
    assert.deepEqual(match.splitBashCommands("true; sudo id"), ["true", "sudo id"]);
    assert.deepEqual(match.splitBashCommands("git status | cat"), ["git status", "cat"]);
    assert.deepEqual(match.splitBashCommands('git commit -m "foo && bar"'), ['git commit -m "foo && bar"']);
  });

  it("matches path globs including basename", () => {
    assert.equal(match.matchPathPattern("*.env", "/tmp/.env"), true);
    assert.equal(match.matchPathPattern("**/.ssh/**", "/Users/x/.ssh/id_rsa"), true);
    assert.equal(match.matchPathPattern("*.env.example", "/tmp/.env"), false);
  });
});
