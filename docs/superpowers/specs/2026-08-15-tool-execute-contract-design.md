# Tool Execute Contract Design — Name the Existing Waterfall

**Date:** 2026-08-15  
**Status:** Implemented (see [`../plans/2026-08-15-tool-execute-contract.md`](../plans/2026-08-15-tool-execute-contract.md))
**Parent:** [`2026-08-14-presentation-layer-design.md`](./2026-08-14-presentation-layer-design.md) (slice 1 done)  
**Related:** [`AGENTS.md` § AI Coding Constraints](../../../AGENTS.md)

This is slice 2 of “steal DSH contracts, keep the Pi SDK.” Slice 3 (durable inbox, crash-repair tool results, compact surface vs human) stays out of scope.

## Problem

DSH documents a tool waterfall. Pi Web already *has* one, owned by the SDK, but the host pretends otherwise:

- Approval is a single `pi.on("tool_call")` in `createPermissionInlineExtension`.
- Execute is `definition.execute(id, args, signal)`.
- `pi.on("tool_result")` is unused.
- Plan mode applies **three** belts: strip `edit`/`write` from the active list, overlay-deny those names in permission policy, and a hidden mode brief.
- Several tools ignore the session `AbortSignal` (`debug_run` uses only `timeoutMs`).
- `lib/rpc-session-wrapper.ts` is 1377 lines. Any “pipeline” dumped there violates the size cap.

Building `wrapExecute()` or `lib/tool-pipeline.ts` would be a **second** execute path and would miss factory-registered tools (`todo`, `mcp`, `subagent`, `ask_user_question`).

## Product one-liner

**Name the SDK hook pair as the contract. Extract the wrapper. Stop can cancel `debug_run`. Plan keeps two belts, not three.**

## Goals

1. One documented execute path: `tool_call` → `execute` → `tool_result` (post empty).
2. `rpc-session-wrapper.ts` shrinks via extract before any behavior change.
3. Session abort reaches `debug_run`.
4. Plan overlay deny is deleted. Strip + brief remain.
5. No new recovery path, no new SSE type, no jsonl change.

## Non-goals

- A `ToolPipeline` class, Cordis, or wrapping `customTools.execute` in `startRpcSession`.
- Host-wide `AbortSignal.timeout` (would kill PTY background bash).
- Moving journal / hashline / todo widget onto `tool_result`.
- Presentation / projections (slice 1).
- Child-session `customTools`, user `!bash` permission, sandbox.
- Wiring `signal` into github / lsp / diagnostics / edit (follow-up PRs).
- Deleting auto’s `{ edit, write: allow }` overlay.

## Architecture

```
beforeToolCall  →  pi.on("tool_call")     only createPermissionInlineExtension
execute(...)    →  tool body; session AbortSignal
afterToolCall   →  pi.on("tool_result")   unused (no result rewrite yet)
```

| Semantic | Owner |
|---|---|
| Tool assembly | `lib/rpc-session-start.ts` |
| Approval | `lib/first-party/permission/` (sole `tool_call` handler) |
| Plan: hide mutating tools | `AgentSessionWrapper.applyModeToTools` / `adoptBaseToolNames` |
| Plan: tell the model | `agent-mode-brief` |
| Command switch | **new** `lib/rpc-session-commands.ts` |
| Session lifecycle | `lib/rpc-session-wrapper.ts` (subscribe, idle, destroy, fork→shutdown) |

`set_mode` strips in the same turn. **Resume does not:** `POST /api/agent/[id]` and event reconnect call `startRpcSession(id, file, cwd)` with no `toolNames`, so `adoptBaseToolNames` never runs until a later client `set_tools`. Today the overlay is the only plan deny on that path.

**Prerequisite before deleting overlay deny:** `startRpcSession` with omitted/`undefined` `toolNames` must still `adoptBaseToolNames(getFullToolNames())` and apply the wrapper’s current mode strip. New-session explicit `toolNames` (including `[]` = all off) is unchanged.

Child sessions already strip in `createChildRun` (`agentModeStripsWriteTools`). They do not depend on the overlay. Do not expand child `customTools` in this slice.

`dispatchRpcSessionCommand(wrapper, command)` keeps today’s private helpers on the wrapper (`waitForExtensionsBound`, prompt/brief injection, queue, emit). The extract moves the `switch` only — it does not invent a public command API.

## File plan

**New**

- `lib/rpc-session-commands.ts` — `send()` command switch; calls methods on the wrapper. Header: `RPC command dispatch for AgentSessionWrapper.`

**Modified**

- `lib/rpc-session-wrapper.ts` — `send` becomes `return dispatchRpcSessionCommand(this, command)`. No new behavior.
- `lib/rpc-session-start.ts` — omitted `toolNames` still adopts the full coding list, then mode-strips.
- `lib/agent-mode.ts` — `plan: {}` in `AGENT_MODE_PERMISSION_OVERLAY`. Update the comment. Keep `auto: { edit, write: allow }`.
- `lib/permission-policy.ts` — header/comment no longer says plan layers `edit/write: deny`.
- `lib/agent-advanced-tools.ts` — `debug_run.execute(id, args, signal)` passes `signal` into `execFile` (Node 22). Keep `timeoutMs`.
- Stale comments (`before_agent_start`, `tool-call-gate-pipeline.ts`) deleted.

**Tests**

- Existing wrapper / rpc tests still pass after the extract.
- `lib/permission-policy.test.mjs` — drop “plan denies writes even before the tool filter lands”; assert plan overlay no longer writes `edit/write: deny`. Auto overlay tests stay.
- New/updated mode tests: plan overlay is empty; auto still allows edit/write via overlay; `evaluatePermission` for edit under plan is **not** deny solely because of overlay (user base policy may still deny).
- `debug_run`: aborted `signal` returns `isError` in well under `timeoutMs`. Abort may surface as `killed`; the test must not require the existing `"(timeout)"` string. Distinguishing abort from a full 30s wait is enough.

## Implementation order

1. Extract `rpc-session-commands.ts` (behavior freeze). Typecheck.
2. Resume adopt+strip (`startRpcSession` omitted `toolNames`). Test that a plan-mode wrapper without a client `set_tools` does not expose `edit`/`write`.
3. Delete plan overlay deny + update `permission-policy` comments/tests + stale comments.
4. `debug_run` honors `signal`. Test.

Each step is a committable unit. The slice is not done until all four land. Resume adopt+strip uses `wrapper.mode` from `readGlobalAgentMode()` (already the constructor default).

## Error handling

| Case | Behavior |
|---|---|
| Permission deny / no UI | `{ block: true, reason }` — unchanged |
| Plan model emits `edit` | Tool not in the allow-list; SDK does not dispatch |
| Stop during `debug_run` | `signal` aborts `execFile`; tool result `isError` via existing path |
| PTY background bash | Still ignores model timeout |
| Presenter / projections | Untouched |

Empty `catch` in permission UI already names “select failed → confirm.” Do not widen it.

## Acceptance

- Manual: plan mode — edit/write absent from the picker; a forced call does not need overlay deny.
- Manual: start `debug_run` of `sleep 30`, press Stop — returns promptly.
- Manual: `npm run dev` via background bash still survives.
- Automated: extract + overlay + signal tests; `tsc --noEmit`.

## Self-check

1. **Invariant:** one execute path (SDK hooks); plan = strip + brief; Stop cancels `debug_run`.
2. **Single owner:** permission hook; `rpc-session-start` assembly; `rpc-session-commands` dispatch.
3. **Path count:** run recovery still 5. Execute path 1.
4. **Size:** wrapper extracted first; not grown.
5. **Legacy:** no dual-path. Overlay deny deleted in this change.

## Later (not this spec)

- Slice 3: durable inbox, load-time tool-result repair, compact human transcript.
- Follow-up: `signal` on github / lsp / diagnostics / edit.
- Child sessions getting Pi Web `customTools`.
- User bash on `user_bash` permission.
