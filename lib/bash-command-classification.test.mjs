import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./bash-command-classification.ts");
}

test("foreground guardrail rejects long-lived server commands", async () => {
  const { foregroundGuardrail } = await loadSubject();
  const rejected = [
    "npm run dev",
    "pnpm start",
    "yarn dev",
    "bun run serve",
    "npm run watch",
    "next dev",
    "next start",
    "vite",
    "vite dev",
    "vite preview",
    "nodemon server.js",
    "docker compose up",
    "docker-compose up",
    "uvicorn app:api --reload",
    "gunicorn app:wsgi",
    "python3 -m http.server 8000",
    "npx serve dist",
    "cd apps/web && npm run dev",
  ];
  for (const cmd of rejected) {
    const guidance = foregroundGuardrail(cmd);
    assert.ok(guidance, `expected rejection: ${cmd}`);
    assert.match(guidance, /background: true/, `guidance should teach background param: ${cmd}`);
  }
});

test("foreground guardrail rejects shell background hacks", async () => {
  const { foregroundGuardrail } = await loadSubject();
  for (const cmd of [
    "nohup npm start > log.txt 2>&1",
    "setsid node server.js",
    "npm run dev &",
    "python3 server.py &  # run in bg",
  ]) {
    const guidance = foregroundGuardrail(cmd);
    assert.ok(guidance, `expected rejection: ${cmd}`);
  }
});

test("foreground guardrail allows normal short commands", async () => {
  const { foregroundGuardrail } = await loadSubject();
  const allowed = [
    "ls -la",
    "git status",
    "npm run build",
    "npm test",
    "pnpm install",
    "next build",
    "node script.js",
    "python3 manage.py migrate",
    "curl -s http://localhost:3000/health",
  ];
  for (const cmd of allowed) {
    assert.equal(foregroundGuardrail(cmd), null, `expected allow: ${cmd}`);
  }
});

test("quoted content never triggers the guardrail", async () => {
  const { foregroundGuardrail } = await loadSubject();
  const allowed = [
    `git commit -m "document npm run dev setup"`,
    `git commit -m 'use setsid for the daemon'`,
    `echo "run with nohup ... &"`,
    `python3 -c "print('npm run dev')"`,
  ];
  for (const cmd of allowed) {
    assert.equal(foregroundGuardrail(cmd), null, `expected allow: ${cmd}`);
  }
});

test("help/version invocations are never blocked", async () => {
  const { foregroundGuardrail } = await loadSubject();
  const allowed = [
    "npm run dev --help",
    "uvicorn --help",
    "docker compose up --help",
    "vite --version",
  ];
  for (const cmd of allowed) {
    assert.equal(foregroundGuardrail(cmd), null, `expected allow: ${cmd}`);
  }
});

test("looksLikeLongRunningCommand still drives the PTY fallback", async () => {
  const { looksLikeLongRunningCommand } = await loadSubject();
  assert.equal(looksLikeLongRunningCommand("npm run dev"), true);
  assert.equal(looksLikeLongRunningCommand("next start"), true);
  assert.equal(looksLikeLongRunningCommand("vite preview"), true);
  assert.equal(looksLikeLongRunningCommand("git status"), false);
  assert.equal(looksLikeLongRunningCommand("npm run build"), false);
});
