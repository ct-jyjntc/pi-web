# Session Tool Repair Design — Append Closers for Dangling Tool Calls

**Date:** 2026-08-15  
**Status:** Implemented (see [`../plans/2026-08-15-session-tool-repair.md`](../plans/2026-08-15-session-tool-repair.md))
**Parent:** slice 3 of “steal DSH contracts, keep the Pi SDK.” Inbox and compact human-vs-model are **later specs**.  
**Related:** [`2026-08-15-tool-execute-contract-design.md`](./2026-08-15-tool-execute-contract-design.md), [`AGENTS.md`](../../../AGENTS.md)

## Problem

Pi jsonl can store an assistant `toolCall` with no later `toolResult`. Live Stop only closes some in-flight executes. Crash, Stop mid-stream, or a leftover call in a batch leave a dangling call. The next `convertToLlm` may not end on `user` / `toolResult`, and the provider rejects.

DSH cold-load appends synthetic error results. Pi Web has no load-time pairing. `sanitizeTitleMessages` **strips** unmatched calls (title only) — the opposite of repair.

## Product one-liner

**On open and before the next prompt, append one error `toolResult` per unmatched tool call on the trailing assistant. Idempotent. GET does not write.**

## Goals

1. After repair, the leaf used for the next **`prompt`** has a result for every tool call the **provider will see**. Compact / auto-compact are out of scope.
2. Append-only. Second open adds zero rows.
3. Do not mutate GET / `session-entries` / `convertToLlm`.
4. Do not add a sixth run-lifecycle recovery path.

## Non-goals

- Durable inbox splices.
- Compaction human transcript vs model surface.
- DSH `TOOL_NOT_STARTED` vs `TOOL_OUTCOME_UNKNOWN`.
- Rewriting or truncating assistant rows.
- Side-effecting `GET /api/sessions/[id]`.
- New jsonl `type`.

## Architecture

```
startRpcSession (no live wrapper)
    SessionManager.open
    msgs = sessionManager.buildSessionContext().messages
           (this instance — not the session-entries read cache)
    repair → sessionManager.appendMessage(closer) × N
    createAgentSessionFromServices
           (snapshots context after closers)

prompt (live wrapper)
    existing abort flush + busy reject
           (already prompting / streaming / compacting)
    repair:
      sessionManager.appendMessage(closer)
      AND the same closer onto agent.state.messages
          (push, or replace array from sessionManager.buildSessionContext())
    then promptRunning = true
    then inner.prompt
```

`Agent.prompt` / `convertToLlm` read `agent.state.messages` and do **not** reload from the manager. Disk-only on a live wrapper leaves the next provider call broken. Memory-only leaves the next crash broken.

Both writes happen **before** `promptRunning = true` and **before** `inner.prompt`, so closers parent before the new user row.

Do **not** skip because you just set `promptRunning`. Reuse the existing busy reject; then repair; then set the flag.

Skip the **open** path when `getRpcSession(id)?.isAlive()`.

| Semantic | Owner |
|---|---|
| Pairing + closer object | **new** `lib/session-tool-repair.ts` |
| Persist | `sessionManager.appendMessage` on the start/live manager (never `getSessionManager()` cache) |
| Cold call | `lib/rpc-session-start.ts` after `open`, before `createAgentSessionFromServices` |
| Warm call | `lib/rpc-session-commands.ts` `prompt`, after abort flush + busy reject, before `promptRunning = true` |

## Closer shape

```ts
{
  role: "toolResult",
  toolCallId,
  toolName,
  isError: true,
  timestamp: Date.now(),
  content: [{ type: "text", text: INTERRUPTED_TOOL_RESULT_TEXT }],
}

export const INTERRUPTED_TOOL_RESULT_TEXT =
  "Tool did not finish (session interrupted).";
```

Same role as live abort. Distinct text from `Operation aborted`.

## Pairing (trailing open batch only)

`transformMessages` **drops** assistants with `stopReason === "aborted" | "error"`, and already synthesizes results when a later user-equivalent interrupted a batch. A global set-difference of all ids would append orphan `toolResult`s at the current leaf and can 400 the next call.

After `normalizeToolCalls`:

1. Find the last `assistant` message.
2. If it is missing, or `stopReason` is `aborted` or `error` → **0 closers**.
3. If **any** message after that assistant is not a `toolResult` → **0 closers**. (`bashExecution`, `custom`, `user`, another `assistant`, compaction summaries all count — `convertToLlm` treats several as `user`.)
4. Else, for each `toolCall` on that assistant with no later `toolResult` for that `toolCallId` → one closer.

## Tests

1. Last assistant completed, missing results (nothing after it, or only `toolResult`s) → N closers.
2. Already paired trailing batch → 0.
3. After applying closers, second scan → 0.
4. Last assistant `stopReason: "aborted"` or `"error"` → 0.
5. Unmatched call then a later **user** → 0.
6. Unmatched call then a later **bashExecution** → 0.
7. `shouldRepairOnOpen({ alive: true })` is false.

Warm path: helper returns `{ persist, nextMessages }` so prompt can append then assign `agent.state.messages`.

## Implementation order

1. Pure functions + tests.  
2. Hook `startRpcSession`.  
3. Hook `prompt` (disk + in-memory).

## Error handling

| Case | Behavior |
|---|---|
| `appendMessage` throws | Propagate; start/prompt fails loud |
| GET before first RPC | May still show pending cards |
| Empty / balanced / aborted / already-continued | No-op |
| Prompt while streaming | Existing busy reject; no repair |

## Self-check

1. **Invariant:** before the next `prompt`, every tool call the provider will see has a result on disk and in `agent.state.messages`.
2. **Single owner:** `lib/session-tool-repair.ts`.
3. **Path count:** still 5. Repair is prepare-for-convert.
4. **Size:** start/commands gain a few lines.
5. **Legacy:** no dual-path.

## Later specs

- Inbox: `custom` splices (not `custom_message`).
- Compact: human transcript from full leaf; model still uses `buildContextEntries`.
