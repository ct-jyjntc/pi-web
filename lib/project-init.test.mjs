/**
 * Project /init scan + heuristic generation tests.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

/** @type {typeof import("./project-init.ts")} */
let mod;

before(async () => {
  mod = await jiti.import("./project-init.ts");
});

describe("project-init", () => {
  it("scans package.json scripts and lockfiles", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-init-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "demo",
        scripts: { dev: "next dev", lint: "eslint ." },
        dependencies: { next: "15.0.0" },
      }),
      "utf8",
    );
    writeFileSync(join(dir, "package-lock.json"), "{}\n", "utf8");
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "README.md"), "# Demo\n", "utf8");

    const scan = mod.scanProject(dir);
    assert.equal(scan.packageJson?.name, "demo");
    assert.equal(scan.packageJson?.scripts?.lint, "eslint .");
    assert.ok(scan.lockfiles.includes("package-lock.json"));
    assert.ok(scan.topLevel.some((e) => e === "app/" || e === "app"));
    assert.equal(scan.docs.some((d) => d.path === "README.md"), true);
  });

  it("writes heuristic AGENTS.md when heuristicOnly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-init-write-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "write-demo", scripts: { test: "node --test" } }),
      "utf8",
    );

    const result = await mod.runProjectInit(dir, { heuristicOnly: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.written, true);
    assert.equal(result.source, "heuristic");
    assert.equal(existsSync(join(dir, "AGENTS.md")), true);
    const body = readFileSync(join(dir, "AGENTS.md"), "utf8");
    assert.match(body, /write-demo|Commands|test/);
    assert.equal(result.created, true);
  });

  it("dryRun does not write", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-init-dry-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "dry" }), "utf8");
    const result = await mod.runProjectInit(dir, { heuristicOnly: true, dryRun: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.written, false);
    assert.equal(existsSync(join(dir, "AGENTS.md")), false);
    assert.ok(result.preview.length > 20);
  });

  it("improves existing path marks created=false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-init-exist-"));
    writeFileSync(join(dir, "AGENTS.md"), "# Old\n\nKeep me.\n", "utf8");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "exist" }), "utf8");
    const result = await mod.runProjectInit(dir, { heuristicOnly: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.created, false);
  });
});
