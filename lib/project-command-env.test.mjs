import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// jiti so we can load .ts without Node ESM extension resolution (production code
// imports extensionless for Next/tsc bundler resolution).
const jiti = createJiti(import.meta.url);
const {
  sanitizeProjectCommandEnvironment,
  withProjectCommandEnvironment,
} = await jiti.import("./project-command-env.ts");

const HOST_ENVIRONMENT = {
  PORT: "30141",
  NODE_ENV: "production",
  NEXT_RUNTIME: "nodejs",
  NEXT_PRIVATE_WORKER: "1",
  PATH: "/usr/local/bin:/usr/bin",
  HOME: "/home/pi",
  HTTPS_PROXY: "http://proxy.example",
  OPENROUTER_API_KEY: "secret",
  PI_USER_SETTING: "preserved",
  PI_WEB_RUNTIME: "heavy",
};

test("sanitizes host variables using platform casing rules", () => {
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(HOST_ENVIRONMENT, "linux"),
    {
      PATH: HOST_ENVIRONMENT.PATH,
      HOME: HOST_ENVIRONMENT.HOME,
      HTTPS_PROXY: HOST_ENVIRONMENT.HTTPS_PROXY,
      OPENROUTER_API_KEY: HOST_ENVIRONMENT.OPENROUTER_API_KEY,
      PI_USER_SETTING: HOST_ENVIRONMENT.PI_USER_SETTING,
      PI_WEB_RUNTIME: HOST_ENVIRONMENT.PI_WEB_RUNTIME,
    },
  );
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(
      {
        Port: "30141",
        node_env: "production",
        Next_Runtime: "nodejs",
        NEXT_PUBLIC_FLAG: "1",
        Path: "C:\\Windows",
      },
      "win32",
    ),
    { Path: "C:\\Windows" },
  );
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(
      {
        PORT: "30141",
        Port: "project-value",
        NODE_ENV: "production",
        node_env: "project-mode",
        NEXT_RUNTIME: "nodejs",
        Next_Runtime: "project-runtime",
      },
      "linux",
    ),
    {
      Port: "project-value",
      node_env: "project-mode",
      Next_Runtime: "project-runtime",
    },
  );
});

test("wrapped operations strip host variables and tombstone them for merge consumers", async () => {
  let received;
  const operations = withProjectCommandEnvironment({
    async exec(_command, _cwd, execOptions) {
      received = execOptions;
      return { exitCode: 0 };
    },
  });

  await operations.exec("echo ready", "/project", {
    onData() {},
    env: { ...HOST_ENVIRONMENT },
  });

  // Host variables are tombstoned (undefined) so pty-sessions buildEnv, which
  // merges env over process.env, deletes them instead of resurrecting them.
  assert.equal(received.env.PORT, undefined);
  assert.equal(received.env.NODE_ENV, undefined);
  assert.equal(received.env.NEXT_RUNTIME, undefined);
  assert.equal(received.env.NEXT_PRIVATE_WORKER, undefined);
  assert.ok("PORT" in received.env, "host variables must be explicit tombstones");
  // Everything else — including fork-injected PI_WEB_* — survives.
  assert.equal(received.env.PATH, HOST_ENVIRONMENT.PATH);
  assert.equal(received.env.OPENROUTER_API_KEY, HOST_ENVIRONMENT.OPENROUTER_API_KEY);
  assert.equal(received.env.PI_USER_SETTING, "preserved");
  assert.equal(received.env.PI_WEB_RUNTIME, "heavy");
});

test("wrapped operations honor win32 casing rules", async () => {
  let received;
  const operations = withProjectCommandEnvironment(
    {
      async exec(_command, _cwd, execOptions) {
        received = execOptions;
        return { exitCode: 0 };
      },
    },
    "win32",
  );

  await operations.exec("echo ready", "/project", {
    onData() {},
    env: { Port: "30141", node_env: "production", Next_Runtime: "nodejs", Path: "C:\\Windows" },
  });

  assert.equal(received.env.Port, undefined);
  assert.equal(received.env.node_env, undefined);
  assert.equal(received.env.Next_Runtime, undefined);
  assert.equal(received.env.Path, "C:\\Windows");
});

test("wrapped operations preserve execution controls and streaming callbacks", async () => {
  const signal = new AbortController().signal;
  let received;
  let streamed = "";
  const operations = withProjectCommandEnvironment({
    async exec(command, cwd, options) {
      received = { command, cwd, options };
      options.onData(Buffer.from("streamed"));
      return { exitCode: 0 };
    },
  });

  await operations.exec("echo ready", "/project", {
    onData: (chunk) => { streamed += chunk.toString(); },
    signal,
    timeout: 12,
    env: { ...HOST_ENVIRONMENT },
  });

  assert.equal(received.command, "echo ready");
  assert.equal(received.cwd, "/project");
  assert.equal(received.options.signal, signal);
  assert.equal(received.options.timeout, 12);
  assert.equal(streamed, "streamed");
});

test("wrapped operations fall back to process.env when no env is provided", async () => {
  const original = process.env.PI_WEB_TEST_MARKER;
  process.env.PI_WEB_TEST_MARKER = "present";
  let received;
  try {
    const operations = withProjectCommandEnvironment({
      async exec(_command, _cwd, execOptions) {
        received = execOptions;
        return { exitCode: 0 };
      },
    });
    await operations.exec("echo ready", "/project", { onData() {} });
    assert.equal(received.env.PI_WEB_TEST_MARKER, "present");
    // NODE_ENV is injected into the host process by electron/main.js; on this
    // machine it may or may not be set, but if set it must be tombstoned.
    if (process.env.NODE_ENV !== undefined) {
      assert.equal(received.env.NODE_ENV, undefined);
    }
  } finally {
    if (original === undefined) delete process.env.PI_WEB_TEST_MARKER;
    else process.env.PI_WEB_TEST_MARKER = original;
  }
});
