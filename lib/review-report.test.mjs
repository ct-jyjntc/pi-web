import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countFindingsByPriority, parseReviewReport } from "./review-report.ts";

describe("parseReviewReport", () => {
  it("parses fenced JSON", () => {
    const text = `
Summary here.

\`\`\`json
{
  "overall_correctness": "incorrect",
  "explanation": "One P0 bug",
  "confidence": 0.9,
  "findings": [
    {
      "title": "Null deref",
      "body": "x is null",
      "priority": "P0",
      "confidence": 0.95,
      "file_path": "/tmp/a.ts",
      "line_start": 10
    }
  ]
}
\`\`\`
`;
    const report = parseReviewReport(text);
    assert.ok(report);
    assert.equal(report.overall_correctness, "incorrect");
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].priority, "P0");
    assert.deepEqual(countFindingsByPriority(report.findings), { P0: 1, P1: 0, P2: 0, P3: 0 });
  });

  it("returns null without review JSON", () => {
    assert.equal(parseReviewReport("just a normal reply"), null);
  });

  it("accepts alternate field names from real Reviewer output", () => {
    const text = `
\`\`\`json
{
  "findings": [
    {
      "priority": "P2",
      "file": "lib/edit-failure.ts",
      "line": 131,
      "message": "Unbounded file read can OOM."
    }
  ],
  "overall_correctness": "needs_fix",
  "summary": "Cap the file read before merge."
}
\`\`\`
`;
    const report = parseReviewReport(text);
    assert.ok(report);
    assert.equal(report.overall_correctness, "incorrect");
    assert.equal(report.explanation, "Cap the file read before merge.");
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].priority, "P2");
    assert.equal(report.findings[0].file_path, "lib/edit-failure.ts");
    assert.equal(report.findings[0].line_start, 131);
  });
});
