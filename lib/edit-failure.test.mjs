import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyEditFailure } from "./edit-failure.ts";

describe("classifyEditFailure", () => {
  it("classifies not_found", () => {
    const info = classifyEditFailure(
      new Error("Could not find the exact text in src/a.ts. The old text must match exactly including all whitespace and newlines."),
    );
    assert.equal(info.kind, "not_found");
    assert.equal(info.path, "src/a.ts");
  });

  it("classifies not_unique with occurrences", () => {
    const info = classifyEditFailure(
      new Error("Found 3 occurrences of the text in src/b.ts. The text must be unique. Please provide more context to make it unique."),
    );
    assert.equal(info.kind, "not_unique");
    assert.equal(info.occurrences, 3);
    assert.equal(info.path, "src/b.ts");
  });

  it("classifies overlap", () => {
    const info = classifyEditFailure(
      new Error("edits[0] and edits[1] overlap in foo.ts. Merge them into one edit or target disjoint regions."),
    );
    assert.equal(info.kind, "overlap");
  });

  it("classifies no_change", () => {
    const info = classifyEditFailure(
      new Error("No changes made to bar.ts. The replacement produced identical content."),
    );
    assert.equal(info.kind, "no_change");
  });

  it("classifies aborted", () => {
    assert.equal(classifyEditFailure(new Error("Operation aborted")).kind, "aborted");
  });
});
