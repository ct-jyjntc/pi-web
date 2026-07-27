#!/usr/bin/env node
/**
 * Offline + optional live smoke checks for pi-web security/runtime hardening.
 *
 *   npm run verify           # unit + tsc + module smoke; HTTP if :30141 is up
 *   VERIFY_HTTP=1 npm run verify   # fail if server is not reachable
 *   VERIFY_BASE=http://127.0.0.1:30141 npm run verify
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.VERIFY_BASE || "http://127.0.0.1:30141";
const requireHttp = process.env.VERIFY_HTTP === "1" || process.env.VERIFY_HTTP === "true";

let failed = 0;

function pass(name) {
  console.log(`  ✓ ${name}`);
}

function fail(name, detail) {
  failed += 1;
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  return result;
}

function checkTsc() {
  section("Typecheck");
  const tsc = path.join(root, "node_modules", ".bin", "tsc");
  if (!existsSync(tsc)) {
    fail("tsc", "typescript not installed");
    return;
  }
  const result = run(tsc, ["--noEmit"]);
  if (result.status === 0) pass("tsc --noEmit");
  else fail("tsc --noEmit", (result.stderr || result.stdout || "").slice(0, 400));
}

function checkUnitTests() {
  section("Unit tests");
  const tests = [
    "lib/request-security.test.mjs",
    "lib/path-security.test.mjs",
    "lib/bounded-form-data.test.mjs",
    "lib/image-attachments.test.mjs",
    "lib/session-path.test.mjs",
    "lib/directory-browser.test.mjs",
    "lib/file-fuzzy.test.mjs",
    "lib/node-version.test.mjs",
    "lib/pi-web-options.test.mjs",
    "lib/models-cache.test.mjs",
    "lib/session-title.test.mjs",
  ];
  const result = run(process.execPath, ["--test", ...tests]);
  if (result.status === 0) {
    const match = (result.stdout || "").match(/# tests (\d+)/);
    pass(`node --test (${match?.[1] ?? "?"} tests)`);
  } else {
    fail("node --test", (result.stderr || result.stdout || "").slice(-500));
  }
}

function checkVersionsAndDefaults() {
  section("Versions & defaults");
  try {
    const pkgs = [
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-tui",
    ];
    for (const name of pkgs) {
      const version = JSON.parse(
        readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8"),
      ).version;
      if (version === "0.82.1") pass(`${name}@${version}`);
      else fail(`${name}`, `expected 0.82.1 got ${version}`);
    }

    const { parseLaunchOptions } = require(path.join(root, "bin/pi-web-options.js"));
    const defaults = parseLaunchOptions([], {});
    if (defaults.hostname === "127.0.0.1" && defaults.port === "30141") {
      pass("launch defaults bind loopback:30141");
    } else {
      fail("launch defaults", JSON.stringify(defaults));
    }

    const { isNodeVersionSupported, MIN_NODE_VERSION } = require(path.join(root, "bin/node-version.js"));
    if (isNodeVersionSupported(process.versions.node)) {
      pass(`node ${process.versions.node} >= ${MIN_NODE_VERSION}`);
    } else {
      fail("node version", process.versions.node);
    }

    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    if (pkg.engines?.node === `>=${MIN_NODE_VERSION}`) pass("package.json engines aligned");
    else fail("package.json engines", pkg.engines?.node);

    if (String(pkg.scripts?.dev || "").includes("127.0.0.1")) pass("dev script binds 127.0.0.1");
    else fail("dev script", pkg.scripts?.dev);
  } catch (error) {
    fail("versions/defaults", error instanceof Error ? error.message : String(error));
  }
}

async function checkModules() {
  section("Module smoke");
  try {
    const { isApiRequestOriginAllowed } = await import(path.join(root, "lib/request-security.ts"));
    const { isExistingPathWithinRoots, isPathWithinRoots } = await import(path.join(root, "lib/path-security.ts"));
    const { parseFormDataWithinLimit, RequestBodyTooLargeError } = await import(path.join(root, "lib/bounded-form-data.ts"));
    const { validateAgentImages, MAX_ATTACHED_IMAGES } = await import(path.join(root, "lib/image-attachments.ts"));
    const { buildFileLineMentionText } = await import(path.join(root, "lib/file-fuzzy.ts"));
    const { UPLOAD_FILE_TOO_LARGE_ERROR } = await import(path.join(root, "lib/upload-limits.ts"));

    if (isApiRequestOriginAllowed(new Request("http://127.0.0.1:30141/api/x", {
      headers: { origin: "http://127.0.0.1:30141", "sec-fetch-site": "same-origin" },
    }))) pass("origin same-site allowed");
    else fail("origin same-site allowed");

    if (!isApiRequestOriginAllowed(new Request("http://127.0.0.1:30141/api/x", {
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    }))) pass("origin cross-site rejected");
    else fail("origin cross-site rejected");

    const image = { type: "image", mimeType: "image/png", data: "YWJj" };
    if (validateAgentImages([image]) === null) pass("image attachment valid");
    else fail("image attachment valid");
    if (validateAgentImages(Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, () => image))) {
      pass("image attachment count capped");
    } else fail("image attachment count capped");

    if (buildFileLineMentionText("a.ts", 1, 3) === "@a.ts:1-3 ") pass("file line mention");
    else fail("file line mention");

    if (UPLOAD_FILE_TOO_LARGE_ERROR.includes("25MB")) pass("upload limit messages");
    else fail("upload limit messages");

    const baseDir = mkdtempSync(path.join(tmpdir(), "pi-web-verify-"));
    try {
      const allowed = path.join(baseDir, "allowed");
      const outside = path.join(baseDir, "outside");
      mkdirSync(allowed);
      mkdirSync(outside);
      writeFileSync(path.join(outside, "secret.txt"), "secret");
      const link = path.join(allowed, "link");
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
      const target = path.join(link, "secret.txt");
      const roots = new Set([allowed]);
      if (isPathWithinRoots(target, roots) && !isExistingPathWithinRoots(target, roots)) {
        pass("symlink realpath denied");
      } else {
        fail("symlink realpath denied");
      }
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }

    try {
      await parseFormDataWithinLimit(new Request("http://localhost/upload", {
        method: "POST",
        headers: { "content-length": "99", "content-type": "multipart/form-data; boundary=test" },
        body: "--test\r\nContent-Disposition: form-data; name=\"value\"\r\n\r\nsmall\r\n--test--\r\n",
      }), 10);
      fail("form-data size limit", "expected throw");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) pass("form-data size limit");
      else fail("form-data size limit", String(error));
    }
  } catch (error) {
    fail("module smoke", error instanceof Error ? error.message : String(error));
  }
}

function encodeFileApiPath(filePath) {
  return filePath.split(/[/\\]/).filter(Boolean).map(encodeURIComponent).join("/");
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { res, text, json };
}

async function checkHttp() {
  section(`HTTP smoke (${base})`);
  let reachable = false;
  try {
    const probe = await fetch(`${base}/api/sessions`, {
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
      signal: AbortSignal.timeout(2000),
    });
    reachable = true;
    if (probe.ok) pass(`same-origin sessions ${probe.status}`);
    else fail("same-origin sessions", `status ${probe.status}`);
  } catch (error) {
    if (requireHttp) fail("server reachable", error instanceof Error ? error.message : String(error));
    else console.log("  · server not reachable — skip live HTTP (set VERIFY_HTTP=1 to require)");
    return;
  }
  if (!reachable) return;

  {
    const { res, json } = await fetchJson(`${base}/api/sessions`, {
      headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
    });
    if (res.status === 403 && json?.error) pass("cross-site sessions 403");
    else fail("cross-site sessions 403", `${res.status} ${JSON.stringify(json)}`);
  }

  {
    const { res, json } = await fetchJson(`${base}/api/cwd/browse`, {
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
    });
    if (res.ok && json?.path && Array.isArray(json.directories)) pass("cwd browse");
    else fail("cwd browse", `${res.status}`);
  }

  {
    const { res } = await fetchJson(`${base}/api/cwd/browse?path=/no/such/pi-web-verify-${Date.now()}`, {
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
    });
    if (res.status === 404) pass("cwd browse missing 404");
    else fail("cwd browse missing 404", `status ${res.status}`);
  }

  // Symlink escape under /tmp (outside project allowed roots)
  const smoke = mkdtempSync(path.join(tmpdir(), "pi-web-verify-http-"));
  try {
    const allowed = path.join(smoke, "allowed");
    const outside = path.join(smoke, "outside");
    mkdirSync(allowed);
    mkdirSync(outside);
    writeFileSync(path.join(outside, "secret.txt"), "secret-outside\n");
    symlinkSync(outside, path.join(allowed, "link"), process.platform === "win32" ? "junction" : "dir");

    const validate = await fetchJson(`${base}/api/cwd/validate`, {
      method: "POST",
      headers: {
        Origin: base,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cwd: allowed }),
    });
    if (validate.res.ok) pass("validate allowed tmp cwd");
    else fail("validate allowed tmp cwd", `${validate.res.status}`);

    const secretPath = path.join(allowed, "link", "secret.txt");
    const { res, json } = await fetchJson(
      `${base}/api/files/${encodeFileApiPath(secretPath)}?type=read`,
      { headers: { Origin: base, "Sec-Fetch-Site": "same-origin" } },
    );
    if (res.status === 403) pass("symlink file read 403");
    else fail("symlink file read 403", `${res.status} ${JSON.stringify(json)}`);
  } finally {
    rmSync(smoke, { recursive: true, force: true });
  }

  // Oversized single-file upload should be 413 once proxy body cap is raised.
  {
    const { UPLOAD_FILE_TOO_LARGE_ERROR } = await import(path.join(root, "lib/upload-limits.ts"));
    const cwd = root;
    const form = new FormData();
    const size = 26 * 1024 * 1024;
    const data = new Uint8Array(size);
    data[0] = 1;
    form.append("files", new Blob([data], { type: "application/octet-stream" }), "too-big.bin");
    const { res, json, text } = await fetchJson(
      `${base}/api/files/${encodeFileApiPath(cwd)}?type=upload&conflict=skip`,
      {
        method: "POST",
        headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
        body: form,
      },
    );
    if (res.status === 413 && (json?.error === UPLOAD_FILE_TOO_LARGE_ERROR || /25MB|100MB/i.test(text))) {
      pass("26MB upload returns 413");
    } else {
      fail("26MB upload returns 413", `${res.status} ${text.slice(0, 180)}`);
    }
  }
}

async function main() {
  console.log("pi-web verify");
  checkTsc();
  checkUnitTests();
  checkVersionsAndDefaults();
  await checkModules();
  await checkHttp();

  console.log("");
  if (failed === 0) {
    console.log("ALL CHECKS PASSED");
    process.exit(0);
  }
  console.log(`${failed} CHECK(S) FAILED`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
