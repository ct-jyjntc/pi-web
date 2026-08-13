import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

/** @type {typeof import("./hashline-hunk-batch.ts")} */
let batch;
/** @type {typeof import("./hashline-snapshots.ts")} */
let snaps;

const SRC = `export function Panel() {
  return (
    <div>
      <div className="usage-section">
        <p>body</p>
      </div>
    </div>
  );
}
`;

before(async () => {
  batch = await jiti.import("./hashline-hunk-batch.ts");
  snaps = await jiti.import("./hashline-snapshots.ts");
});

describe("classic same-path hunk batch", () => {
  it("applies opener+closer splits together on the next same-file call", () => {
    batch.clearBatchedHashlineEdits();
    const dir = mkdtempSync(join(tmpdir(), "hl-batch-"));
    const file = join(dir, "UsagePanel.tsx");
    writeFileSync(file, SRC);

    const opener = {
      oldText: `      <div className="usage-section">`,
      newText: `      <SettingsGroup>`,
    };
    const closer = {
      oldText: `        <p>body</p>\n      </div>`,
      newText: `        <p>body</p>\n      </SettingsGroup>`,
    };

    assert.throws(
      () => batch.applyBatchedHashlineEdits(dir, "UsagePanel.tsx", [opener]),
      /would leave unparsable/,
    );
    assert.equal(readFileSync(file, "utf8"), SRC);
    assert.equal(batch.pendingBatchedHunkCount(file), 1);

    const result = batch.applyBatchedHashlineEdits(dir, "UsagePanel.tsx", [closer]);
    assert.match(result.summary ?? "", /earlier same-file hunk/);
    const out = readFileSync(file, "utf8");
    assert.match(out, /<SettingsGroup>/);
    assert.match(out, /<\/SettingsGroup>/);
    assert.doesNotMatch(out, /usage-section/);
    assert.equal(batch.pendingBatchedHunkCount(file), 0);
  });

  it("drops the stash when the path lock queue drains", async () => {
    batch.clearBatchedHashlineEdits();
    const dir = mkdtempSync(join(tmpdir(), "hl-idle-"));
    const file = join(dir, "UsagePanel.tsx");
    writeFileSync(file, SRC);
    const opener = {
      oldText: `      <div className="usage-section">`,
      newText: `      <SettingsGroup>`,
    };

    await snaps.withHashlinePathLock(file, () => {
      assert.throws(
        () => batch.applyBatchedHashlineEdits(dir, "UsagePanel.tsx", [opener]),
        /would leave unparsable/,
      );
      assert.equal(batch.pendingBatchedHunkCount(file), 1);
    });
    assert.equal(batch.pendingBatchedHunkCount(file), 0);
    assert.equal(readFileSync(file, "utf8"), SRC);
  });

  it("combines parallel locked calls the way the tool serializes a turn", async () => {
    batch.clearBatchedHashlineEdits();
    const dir = mkdtempSync(join(tmpdir(), "hl-par-"));
    const file = join(dir, "UsagePanel.tsx");
    writeFileSync(file, SRC);
    const opener = {
      oldText: `      <div className="usage-section">`,
      newText: `      <SettingsGroup>`,
    };
    const closer = {
      oldText: `        <p>body</p>\n      </div>`,
      newText: `        <p>body</p>\n      </SettingsGroup>`,
    };

    const errors = [];
    await Promise.all([
      snaps.withHashlinePathLock(file, () => {
        try {
          batch.applyBatchedHashlineEdits(dir, "UsagePanel.tsx", [opener]);
        } catch (e) {
          errors.push(e);
        }
      }),
      snaps.withHashlinePathLock(file, () => {
        try {
          batch.applyBatchedHashlineEdits(dir, "UsagePanel.tsx", [closer]);
        } catch (e) {
          errors.push(e);
        }
      }),
    ]);

    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /would leave unparsable/);
    const out = readFileSync(file, "utf8");
    assert.match(out, /<SettingsGroup>/);
    assert.match(out, /<\/SettingsGroup>/);
  });
});
