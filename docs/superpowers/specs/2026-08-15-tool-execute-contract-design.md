# Tool Execute Contract Design — Name the Existing Waterfall

**Date:** 2026-08-15  
**Status:** Conversation-approved — pending spec review  
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

`set_mode` / startup `adoptBaseToolNames` already strip in the same turn as the mode write. That is why overlay deny is removable (it existed for “before first `set_tools`”).

## File plan

**New**

- `lib/rpc-session-commands.ts` — `send()` command switch; calls methods on the wrapper. Header: `RPC command dispatch for AgentSessionWrapper.`

**Modified**

- `lib/rpc-session-wrapper.ts` — `send` becomes `return dispatchRpcSessionCommand(this, command)`. No new behavior.
- `lib/agent-mode.ts` — `plan: {}` in `AGENT_MODE_PERMISSION_OVERLAY`. Update the comment. Keep `auto: { edit, write: allow }`.
- `lib/first-party/permission/evaluate.ts` — no new compose; overlay empty for plan means user policy applies, then strip still removes the tools.
- `lib/agent-advanced-tools.ts` — `debug_run.execute(id, args, signal)` passes `signal` into `execFile` (`AbortSignal` is supported on Node 22). Keep `timeoutMs`.
- Stale comments in `lib/agent-mode.ts` (and any `before_agent_start` / `tool-call-gate-pipeline.ts` references) deleted.

**Tests**

- Existing wrapper / rpc tests still pass after the extract.
- New/updated `lib/agent-mode.test.mjs` (or permission evaluate tests): plan overlay is empty; auto still allows edit/write via overlay; `evaluatePermission` for edit under plan is **not** deny solely because of overlay (base policy may still deny).
- New `debug_run` test: aborted `signal` returns an error result without waiting `timeoutMs`.

## Implementation order

1. Extract `rpc-session-commands.ts` (behavior freeze). Typecheck.
2. Delete plan overlay deny + stale comments. Tests for evaluate/overlay.
3. `debug_run` honors `signal`. Test.

Each step is a committable unit. The slice is not done until all three land.

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
