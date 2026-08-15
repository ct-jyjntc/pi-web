# Session Tool Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the next `prompt`, every tool call the provider will see has an error `toolResult` if it was left dangling on the trailing assistant.

**Architecture:** Pure pairing in `lib/session-tool-repair.ts`. Cold open appends on the write-capable `SessionManager` before `createAgentSessionFromServices`. Warm `prompt` appends to disk **and** `agent.state.messages` after the existing busy reject and **before** `promptRunning = true`. GET does not write.

**Tech Stack:** TypeScript, Node `node --test`, existing `SessionManager.appendMessage`.

**Spec:** [`docs/superpowers/specs/2026-08-15-session-tool-repair-design.md`](../specs/2026-08-15-session-tool-repair-design.md)

---

## File structure

| File | Responsibility |
|---|---|
| `lib/session-tool-repair.ts` | Pairing, closer objects, open/live apply helpers |
| `lib/rpc-session-start.ts` | Call repair after `SessionManager.open` if no live wrapper |
| `lib/rpc-session-commands.ts` | Call live repair after busy reject, before `promptRunning = true` |

Do not touch `session-entries.ts`, GET routes, or `convertToLlm`.

---

### Task 1: Pure pairing + closer (TDD)

**Files:**
- Create: `lib/session-tool-repair.ts`
- Create: `lib/session-tool-repair.test.mjs`

- [ ] **Step 1: Write failing tests** (jiti, like other lib tests)

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  unmatchedToolCallsOnTrailingAssistant,
  applyRepairToMessages,
  shouldRepairOnOpen,
  INTERRUPTED_TOOL_RESULT_TEXT,
} = await jiti.import("./session-tool-repair.ts");

function assistantWithCalls(ids, stopReason) {
  return {
    role: "assistant",
    model: "m",
    provider: "p",
    stopReason,
    content: ids.map((id) => ({ type: "toolCall", toolCallId: id, toolName: "bash", input: {} })),
  };
}

test("trailing completed assistant missing results → N", () => {
  const calls = unmatchedToolCallsOnTrailingAssistant([assistantWithCalls(["a", "b"])]);
  assert.deepEqual(calls.map((c) => c.toolCallId), ["a", "b"]);
});

test("already paired → 0", () => {
  const msgs = [
    assistantWithCalls(["a"]),
    { role: "toolResult", toolCallId: "a", toolName: "bash", content: [{ type: "text", text: "ok" }] },
  ];
  assert.equal(unmatchedToolCallsOnTrailingAssistant(msgs).length, 0);
});

test("second scan after apply → 0", () => {
  const msgs = [assistantWithCalls(["a"])];
  const { nextMessages } = applyRepairToMessages(msgs);
  assert.equal(unmatchedToolCallsOnTrailingAssistant(nextMessages).length, 0);
  assert.equal(nextMessages.at(-1).content[0].text, INTERRUPTED_TOOL_RESULT_TEXT);
  assert.equal(nextMessages.at(-1).isError, true);
});

test("aborted last assistant → 0", () => {
  assert.equal(unmatchedToolCallsOnTrailingAssistant([assistantWithCalls(["a"], "aborted")]).length, 0);
  assert.equal(unmatchedToolCallsOnTrailingAssistant([assistantWithCalls(["a"], "error")]).length, 0);
});

test("later user → 0", () => {
  const msgs = [assistantWithCalls(["a"]), { role: "user", content: "go on" }];
  assert.equal(unmatchedToolCallsOnTrailingAssistant(msgs).length, 0);
});

test("later bashExecution → 0", () => {
  const msgs = [assistantWithCalls(["a"]), { role: "bashExecution", command: "ls", output: "" }];
  assert.equal(unmatchedToolCallsOnTrailingAssistant(msgs).length, 0);
});

test("shouldRepairOnOpen skips live wrapper", () => {
  assert.equal(shouldRepairOnOpen({ alive: true }), false);
  assert.equal(shouldRepairOnOpen({ alive: false }), true);
});
```

Also cover SDK-shaped blocks `{ type: "toolCall", id, name }` via `normalizeToolCalls`.

- [ ] **Step 2: Run — expect FAIL** (module missing)

`node --test lib/session-tool-repair.test.mjs`

- [ ] **Step 3: Implement**

```ts
/** Append error toolResults for the trailing open tool-call batch. */
import { normalizeToolCalls } from "./normalize";
import type { AgentMessage, AssistantMessage, ToolCallContent, ToolResultMessage } from "./types";

export const INTERRUPTED_TOOL_RESULT_TEXT =
  "Tool did not finish (session interrupted).";

export function shouldRepairOnOpen(opts: { alive: boolean }): boolean {
  return !opts.alive;
}

export function buildInterruptedToolResult(toolCallId: string, toolName: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    isError: true,
    timestamp: Date.now(),
    content: [{ type: "text", text: INTERRUPTED_TOOL_RESULT_TEXT }],
  };
}

export function unmatchedToolCallsOnTrailingAssistant(
  messages: AgentMessage[],
): Array<{ toolCallId: string; toolName: string }> {
  const msgs = messages.map((m) => normalizeToolCalls(m));
  let lastAssistantIdx = -1;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i]?.role === "assistant") lastAssistantIdx = i;
  }
  if (lastAssistantIdx < 0) return [];
  const assistant = msgs[lastAssistantIdx] as AssistantMessage;
  const stop = assistant.stopReason;
  if (stop === "aborted" || stop === "error") return [];
  for (let i = lastAssistantIdx + 1; i < msgs.length; i++) {
    if (msgs[i]?.role !== "toolResult") return [];
  }
  const closed = new Set<string>();
  for (let i = lastAssistantIdx + 1; i < msgs.length; i++) {
    const m = msgs[i];
    if (m?.role === "toolResult" && m.toolCallId) closed.add(m.toolCallId);
  }
  const out: Array<{ toolCallId: string; toolName: string }> = [];
  for (const block of assistant.content ?? []) {
    if (block.type !== "toolCall") continue;
    const tc = block as ToolCallContent;
    if (!tc.toolCallId || closed.has(tc.toolCallId)) continue;
    out.push({ toolCallId: tc.toolCallId, toolName: tc.toolName || "unknown" });
  }
  return out;
}

export function applyRepairToMessages(messages: AgentMessage[]): {
  persist: ToolResultMessage[];
  nextMessages: AgentMessage[];
} {
  const persist = unmatchedToolCallsOnTrailingAssistant(messages).map((c) =>
    buildInterruptedToolResult(c.toolCallId, c.toolName),
  );
  return { persist, nextMessages: persist.length ? [...messages, ...persist] : messages };
}
```

- [ ] **Step 4: Tests PASS + tsc. Commit**

```bash
git commit -m "feat: pair trailing unmatched tool calls for repair"
```

---

### Task 2: Hook cold open

**Files:**
- Modify: `lib/rpc-session-start.ts` after `SessionManager.open` / `create` (~86–88), **before** `createAgentSessionFromServices` (~148)

- [ ] **Step 1: Wire**

Immediately after `sessionManager` is created, if `sessionFile` is non-empty:

```ts
if (sessionFile && shouldRepairOnOpen({ alive: Boolean(getRpcSession(sessionId)?.isAlive()) })) {
  const msgs = sessionManager.buildSessionContext().messages as AgentMessage[];
  const { persist } = applyRepairToMessages(msgs);
  for (const closer of persist) sessionManager.appendMessage(closer);
}
```

Use the **same** `sessionManager` instance. Never `getSessionManager()` from `session-entries`.

Skip when a live wrapper already exists (early return at the top of `startRpcSession` already happens — still guard repair).

New empty sessions (`SessionManager.create`) have no dangling calls; `applyRepairToMessages` is a no-op. Calling it is fine.

- [ ] **Step 2: tsc. Existing start tests still pass.**

`node --test lib/rpc-manager.test.mjs lib/rpc-session-tool-adoption.test.mjs`

- [ ] **Step 3: Commit**

```bash
git commit -m "fix: append interrupted tool results on session open"
```

---

### Task 3: Hook warm prompt

**Files:**
- Modify: `lib/rpc-session-commands.ts` `case "prompt"` after the busy reject (~51–53), **before** memory/brief inject and **before** `promptRunning = true` (~97)

Repair must run **after**:
- abort flush (~41–45)
- bash-running reject (~46–48)
- busy reject (`promptRunning || isStreaming || isCompacting`) (~51–53)

And **before** `promptRunning = true`.

- [ ] **Step 1: Wire**

```ts
{
  const msgs = (wrapper.inner.agent.state.messages ?? []) as AgentMessage[];
  const { persist, nextMessages } = applyRepairToMessages(msgs);
  const sm = wrapper.inner.sessionManager;
  for (const closer of persist) sm.appendMessage(closer);
  if (persist.length) wrapper.inner.agent.state.messages = nextMessages;
}
```

If `appendMessage` throws, do not set `promptRunning`; let the error propagate.

Do not skip solely because you are about to set `promptRunning`.

- [ ] **Step 2: tsc + `node --test lib/session-tool-repair.test.mjs`**

- [ ] **Step 3: Commit**

```bash
git commit -m "fix: repair dangling tool calls before prompt"
```

---

### Task 4: Docs

- Spec status → `Implemented (see ../plans/2026-08-15-session-tool-repair.md)`
- `AGENTS.md` file map: `lib/session-tool-repair.ts` — append error toolResults for trailing unmatched tool calls

```bash
git commit -m "docs: mark session-tool-repair implemented"
```

---

## Manual acceptance

- Crash or Stop mid-stream leaving a completed assistant with toolCalls and no results → next send succeeds; jsonl has the fixed closer text; second send adds none.
- Aborted assistant (`stopReason` aborted) → no extra closer.
- User `!bash` after a dangling call → no closer (already continued).
- GET-only view of a crashed session may still show pending cards until the first RPC start.

## Spec coverage

| Spec | Task |
|---|---|
| Trailing-batch pairing + tests 1–7 | 1 |
| Cold open | 2 |
| Warm persist + `agent.state.messages` | 3 |
| GET / convertToLlm untouched | (forbidden) |
| Inbox / compact | (later specs) |
