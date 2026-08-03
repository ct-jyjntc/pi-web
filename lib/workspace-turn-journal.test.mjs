/**
 * Workspace turn journal unit tests (node:test).
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, before, beforeEach, afterEach } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
const testRoot = mkdtempSync(join(tmpdir(), "pi-web-journal-"));
process.env.PI_CODING_AGENT_DIR = testRoot;

/** @type {typeof import("./workspace-turn-journal.ts")} */
let journal;

before(async () => {
  journal = await jiti.import("./workspace-turn-journal.ts");
});

const sessionId = "test-session-1";
let workDir;

beforeEach(() => {
  journal.clearWorkspaceJournalsForTests();
  workDir = mkdtempSync(join(testRoot, "work-"));
});

afterEach(() => {
  journal.clearWorkspaceJournalsForTests();
});

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

describe("workspace-turn-journal", () => {
  it("records edit and undoes to before", () => {
    const file = join(workDir, "a.ts");
    write(file, "one\n");
    journal.beginAgentTurn(sessionId);
    journal.recordFileMutation(sessionId, {
      path: file,
      kind: "edit",
      before: "one\n",
      after: "two\n",
    });
    write(file, "two\n");
    journal.sealAgentTurn(sessionId);

    const status = journal.getJournalStatus(sessionId);
    assert.equal(status.canUndo, true);
    assert.equal(status.undoCount, 1);

    const result = journal.undoWorkspaceTurn(sessionId);
    assert.equal(result.ok, true);
    assert.equal(readFileSync(file, "utf8"), "one\n");
    assert.equal(journal.getJournalStatus(sessionId).canRedo, true);

    const redone = journal.redoWorkspaceTurn(sessionId);
    assert.equal(redone.ok, true);
    assert.equal(readFileSync(file, "utf8"), "two\n");
  });

  it("undoes create by deleting the file", () => {
    const file = join(workDir, "new.ts");
    journal.beginAgentTurn(sessionId);
    journal.recordFileMutation(sessionId, {
      path: file,
      kind: "create",
      before: null,
      after: "hello\n",
    });
    write(file, "hello\n");
    journal.sealAgentTurn(sessionId);

    const result = journal.undoWorkspaceTurn(sessionId);
    assert.equal(result.ok, true);
    assert.equal(existsSync(file), false);
  });

  it("collapses multiple edits of same path keeping original before", () => {
    const file = join(workDir, "b.ts");
    write(file, "v0\n");
    journal.beginAgentTurn(sessionId);
    journal.recordFileMutation(sessionId, {
      path: file,
      kind: "edit",
      before: "v0\n",
      after: "v1\n",
    });
    journal.recordFileMutation(sessionId, {
      path: file,
      kind: "edit",
      before: "v1\n",
      after: "v2\n",
    });
    write(file, "v2\n");
    journal.sealAgentTurn(sessionId);

    journal.undoWorkspaceTurn(sessionId);
    assert.equal(readFileSync(file, "utf8"), "v0\n");
  });

  it("blocks undo on conflict when disk != after", () => {
    const file = join(workDir, "c.ts");
    write(file, "orig\n");
    journal.beginAgentTurn(sessionId);
    journal.recordFileMutation(sessionId, {
      path: file,
      kind: "edit",
      before: "orig\n",
      after: "agent\n",
    });
    write(file, "agent\n");
    journal.sealAgentTurn(sessionId);
    write(file, "user\n");

    const result = journal.undoWorkspaceTurn(sessionId);
    assert.equal(result.ok, false);
    assert.equal(readFileSync(file, "utf8"), "user\n");
    assert.equal(journal.getJournalStatus(sessionId).canUndo, true);
  });

  it("empty seal does not push undo stack", () => {
    journal.beginAgentTurn(sessionId);
    journal.sealAgentTurn(sessionId);
    assert.equal(journal.getJournalStatus(sessionId).canUndo, false);
  });

  it("undoThroughLeaf undoes from top through matching userEntryId", () => {
    const f1 = join(workDir, "t1.ts");
    const f2 = join(workDir, "t2.ts");
    write(f1, "a0\n");
    write(f2, "b0\n");

    journal.beginAgentTurn(sessionId, { userEntryId: "leaf-a" });
    journal.recordFileMutation(sessionId, {
      path: f1, kind: "edit", before: "a0\n", after: "a1\n",
    });
    write(f1, "a1\n");
    journal.sealAgentTurn(sessionId);

    journal.beginAgentTurn(sessionId, { userEntryId: "leaf-b" });
    journal.recordFileMutation(sessionId, {
      path: f2, kind: "edit", before: "b0\n", after: "b1\n",
    });
    write(f2, "b1\n");
    journal.sealAgentTurn(sessionId);

    // Edit-from-here at leaf-a should undo both turns (b then a)
    const batch = journal.undoWorkspaceTurnsThroughLeaf(sessionId, "leaf-a");
    assert.equal(batch.ok, true);
    assert.equal(batch.matchedLeaf, true);
    assert.equal(batch.undone, 2);
    assert.equal(readFileSync(f1, "utf8"), "a0\n");
    assert.equal(readFileSync(f2, "utf8"), "b0\n");
    assert.equal(journal.getJournalStatus(sessionId).canUndo, false);
    assert.equal(journal.getJournalStatus(sessionId).canRedo, true);
  });

  it("undoThroughLeaf with only later leaf undoes one turn", () => {
    const f1 = join(workDir, "u1.ts");
    const f2 = join(workDir, "u2.ts");
    write(f1, "x0\n");
    write(f2, "y0\n");

    journal.beginAgentTurn(sessionId, { userEntryId: "L0" });
    journal.recordFileMutation(sessionId, {
      path: f1, kind: "edit", before: "x0\n", after: "x1\n",
    });
    write(f1, "x1\n");
    journal.sealAgentTurn(sessionId);

    journal.beginAgentTurn(sessionId, { userEntryId: "L1" });
    journal.recordFileMutation(sessionId, {
      path: f2, kind: "edit", before: "y0\n", after: "y1\n",
    });
    write(f2, "y1\n");
    journal.sealAgentTurn(sessionId);

    const batch = journal.undoWorkspaceTurnsThroughLeaf(sessionId, "L1");
    assert.equal(batch.ok, true);
    assert.equal(batch.undone, 1);
    assert.equal(readFileSync(f1, "utf8"), "x1\n");
    assert.equal(readFileSync(f2, "utf8"), "y0\n");
  });
});

if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
