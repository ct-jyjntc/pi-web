# Tool Execute Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name the existing SDK tool waterfall, shrink the wrapper, make plan two belts (strip + brief), and let Stop cancel `debug_run`.

**Architecture:** Do not build a pipeline class. Approval stays the sole `pi.on("tool_call")`. Resume must `adoptBaseToolNames(getFullToolNames())` before overlay deny is deleted. `debug_run` takes the session `AbortSignal`; no host-wide timeout.

**Tech Stack:** TypeScript, Node test runner (`node --test`), existing Pi SDK `AgentSession`.

**Spec:** [`docs/superpowers/specs/2026-08-15-tool-execute-contract-design.md`](../specs/2026-08-15-tool-execute-contract-design.md)

---

## File structure

| File | Responsibility |
|---|---|
| `lib/rpc-session-commands.ts` | `send()` command `switch` only |
| `lib/rpc-session-wrapper.ts` | Lifecycle + `send` preamble; `send` delegates to dispatch |
| `lib/rpc-session-start.ts` | Omitted `toolNames` still adopts full list + mode strip |
| `lib/agent-mode.ts` | `plan: {}` overlay |
| `lib/permission-policy.ts` | Comments match two-belt plan |
| `lib/agent-advanced-tools.ts` | `debug_run` honors `signal` |

Do **not** create `lib/tool-pipeline.ts`. Do **not** wrap `customTools.execute`.

Per-commit footer:

```text
Invariant: one SDK execute path; plan = strip + brief after resume adopt
Owner module: rpc-session-commands.ts | rpc-session-start.ts | permission/
Recovery paths after change: 5 (was 5)
Files >800 lines touched: yes/no; net lines: ...
New dual-path?: no
```

Tests: `node --test <file>.test.mjs`  
Typecheck: `node_modules/.bin/tsc --noEmit`

---

### Task 1: Extract command switch (behavior freeze)

**Files:**
- Create: `lib/rpc-session-commands.ts`
- Modify: `lib/rpc-session-wrapper.ts` (`send` ~390–810)

- [ ] **Step 1: Move the `switch (type)` only**

Header: `RPC command dispatch for AgentSessionWrapper.`

`wrapper.send` **keeps** (do not move):
- `!this._alive` throw
- `resetIdleTimer`
- `abortRequested` / `prompt` reset
- `shouldWaitForExtensions` + `waitForExtensionsBound`
- image validation for prompt/steer/follow_up

Then:

```ts
return dispatchRpcSessionCommand(this, type, command);
```

```ts
export async function dispatchRpcSessionCommand(
  wrapper: AgentSessionWrapper,
  type: string,
  command: Record<string, unknown>,
): Promise<unknown>
```

Copy the existing `switch` cases verbatim. If TypeScript blocks private fields, add the **narrowest** `/** @internal */` public method or getter on the wrapper (e.g. `getInner()`, already-public `currentMode`). Do **not** use `as any`. Do **not** invent a public command API beyond `dispatchRpcSessionCommand`.

- [ ] **Step 2: Typecheck + existing tests**

Run: `node_modules/.bin/tsc --noEmit`  
Run: `node --test lib/rpc-manager.test.mjs` (and any wrapper test files that exist)  
Expected: PASS. `wc -l lib/rpc-session-wrapper.ts` drops by roughly the switch size (~350+).

- [ ] **Step 3: Commit**

```bash
git add lib/rpc-session-commands.ts lib/rpc-session-wrapper.ts
git commit -m "refactor: extract RPC session command switch"
```

---

### Task 2: Resume adopt + strip

**Files:**
- Modify: `lib/rpc-session-start.ts` (~199–213)
- Test: `lib/rpc-session-start.test.mjs` (create if missing) **or** a tiny helper test file

Today:

```ts
if (toolNames && toolNames.length > 0) {
  wrapper.adoptBaseToolNames(toolNames);
}
```

Omitted `toolNames` leaves `baseToolNames` null → `applyModeLocally` no-ops → plan resume still has SDK `edit`/`write`.

- [ ] **Step 1: Write the failing helper test**

Extract the branch into a pure function in `rpc-session-start.ts` (or `lib/rpc-session-tool-adoption.ts` if you must not grow start by more than ~20 lines):

```ts
/** How startRpcSession seeds the allow-list. `[]` = all tools off. */
export function resolveToolAdoption(toolNames?: string[]):
  | { kind: "all-off" }
  | { kind: "adopt"; names: string[] } {
  if (toolNames?.length === 0) return { kind: "all-off" };
  if (toolNames && toolNames.length > 0) return { kind: "adopt", names: toolNames };
  return { kind: "adopt", names: getFullToolNames() };
}
```

Test (`lib/rpc-session-tool-adoption.test.mjs`):

```js
test("omitted toolNames adopts the full coding list", () => {
  const r = resolveToolAdoption(undefined);
  assert.equal(r.kind, "adopt");
  assert.ok(r.names.includes("edit"));
  assert.ok(r.names.includes("bash"));
});

test("empty toolNames means all off", () => {
  assert.deepEqual(resolveToolAdoption([]), { kind: "all-off" });
});

test("explicit list is kept", () => {
  assert.deepEqual(resolveToolAdoption(["read"]), { kind: "adopt", names: ["read"] });
});
```

TDD: add test first (export missing → fail), then add the helper.

- [ ] **Step 2: Wire startRpcSession**

```ts
const adoption = resolveToolAdoption(toolNames);
if (adoption.kind === "all-off") {
  wrapper.setForceEmptySystemPrompt(true);
} else {
  wrapper.adoptBaseToolNames(adoption.names);
}
```

`adoptBaseToolNames` already runs `applyModeToTools` using `wrapper.mode` (`readGlobalAgentMode()` in the constructor). Plan global mode → edit/write stripped on resume without client `set_tools`.

Do **not** pass `tools: getFullToolNames()` into `createAgentSessionFromServices` (that drops extension tools). Adoption stays on the wrapper after create.

- [ ] **Step 3: Run tests + tsc**

`node --test lib/rpc-session-tool-adoption.test.mjs`  
`tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: adopt full tools and mode-strip on session resume"
```

---

### Task 3: Delete plan overlay deny

**Files:**
- Modify: `lib/agent-mode.ts` (`AGENT_MODE_PERMISSION_OVERLAY`)
- Modify: `lib/permission-policy.ts` (file header ~16–18)
- Modify: `lib/permission-policy.test.mjs` (the `plan denies writes even before the tool filter lands` case ~59)
- Grep: `before_agent_start` / `tool-call-gate-pipeline` in `lib/` — delete stale comments (`lib/agent-mode.ts`, `lib/global-agent-mode.ts`)

**Do this only after Task 2 is merged on the branch.**

- [ ] **Step 1: Update tests first (they fail on old overlay)**

Replace the plan-deny test with:

```js
it("plan overlay does not write edit/write deny", () => {
  mod.writePermissionPolicy(mod.defaultPermissionPolicy(), "plan");
  const enforced = readEnforced();
  // strip owns plan mutations; overlay must not add deny
  assert.notEqual(enforced.permission?.edit, "deny");
  assert.notEqual(enforced.permission?.write, "deny");
});
```

Keep auto-allow tests.

If `lib/agent-mode.test.mjs` exists, assert `agentModePermissionOverlay("plan")` is `{}` and `agentModePermissionOverlay("auto")` still has `edit`/`write` `"allow"`.

- [ ] **Step 2: Run tests — expect FAIL** on the new plan assertion (old code writes deny).

- [ ] **Step 3: Implement**

```ts
plan: {},
```

Update comments: plan = tool strip + brief; auto still overlays allow.

- [ ] **Step 4: Tests + tsc PASS. Commit**

```bash
git commit -m "refactor: drop plan permission overlay deny"
```

---

### Task 4: `debug_run` honors session signal

**Files:**
- Modify: `lib/agent-advanced-tools.ts` (`debug_run.execute` ~74–110)
- Test: `lib/agent-advanced-tools.test.mjs` (create)

- [ ] **Step 1: Failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("debug_run aborted signal returns promptly", async () => {
  const { createAdvancedTools } = await jiti.import("./agent-advanced-tools.ts");
  const [debugRun] = createAdvancedTools({ cwd: process.cwd() }).filter((t) => t.name === "debug_run");
  const ac = new AbortController();
  ac.abort();
  const t0 = Date.now();
  const result = await debugRun.execute("id", { command: "sleep 30", timeoutMs: 30_000 }, ac.signal);
  assert.ok(Date.now() - t0 < 3_000);
  assert.equal(result.isError, true);
});
```

Run: expect FAIL or hang until timeout (if it hangs, Ctrl-path is the bug — implement before waiting 30s by using a 2s timeoutMs in an extra control test). Prefer abort-already-true so current code still returns after `execFile` starts… aborted signal should reject immediately once wired.

If current `execute` only takes `(id, args)`, the test calling with 3 args still hits the old body (signal ignored) → `sleep 30` + 30s timeout. **Use `timeoutMs: 2000` in the test command env only if needed; the assertion is wall-clock < 3s with pre-aborted signal.** If the old code waits for `timeoutMs`, set `timeoutMs: 8000` and assert `< 3000` after the fix; before the fix skip running the full wait — implement after confirming `execute` arity ignores signal.

Practical TDD: first assert `execute.length >= 3` or that the function references `signal` — too weak. Write the abort test with `timeoutMs: 5000` and a 3s test timeout via `test(..., { timeout: 4000 })` so FAIL = timeout (old) vs PASS = quick error (new).

- [ ] **Step 2: Implement**

```ts
async execute(_id, args, signal?: AbortSignal) {
  // ...
  const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
    cwd: options.cwd,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    env: process.env,
    signal,
  });
```

Keep `timeoutMs`. Map abort/`killed` to `isError: true`. Do **not** require the string `"(timeout)"`.

- [ ] **Step 3: Tests + tsc. Commit**

```bash
git commit -m "fix: abort debug_run on session signal"
```

---

### Task 5: Spec status + AGENTS mention

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-tool-execute-contract-design.md` status → `Implemented (see ../plans/2026-08-15-tool-execute-contract.md)`
- Optional: `AGENTS.md` file map — `rpc-session-commands.ts` dispatch

- [ ] **Step 1: Commit**

```bash
git commit -m "docs: mark tool-execute contract implemented"
```

---

## Manual acceptance (after Task 4)

- Plan mode: edit/write absent from the tool picker; resume an existing plan session without waiting for `set_tools` — still no edit/write.
- `debug_run` `sleep 30` + Stop returns promptly.
- Background bash `npm run dev` still survives.
- Auto mode still auto-allows edit/write (overlay kept).

## Self-review (spec coverage)

| Spec | Task |
|---|---|
| Extract command switch | 1 |
| Resume adopt+strip | 2 |
| Delete plan overlay deny + policy tests | 3 |
| `debug_run` signal | 4 |
| Docs | 5 |
| No ToolPipeline / wrapExecute | (forbidden) |
| No child customTools / user bash gate | (out of scope) |
