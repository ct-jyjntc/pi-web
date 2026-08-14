# Session Tool Repair Design — Append Closers for Dangling Tool Calls

**Date:** 2026-08-15  
**Status:** Conversation-approved — pending spec review  
**Parent:** slice 3 of “steal DSH contracts, keep the Pi SDK.” Inbox and compact human-vs-model are **later specs**.  
**Related:** [`2026-08-15-tool-execute-contract-design.md`](./2026-08-15-tool-execute-contract-design.md), [`AGENTS.md`](../../../AGENTS.md)

## Problem

Pi jsonl can store an assistant `toolCall` with no later `toolResult`. Live Stop only closes some in-flight executes. Crash, Stop mid-stream, or a leftover call in a batch leave a dangling call. The next `convertToLlm` may not end on `user` / `toolResult`, and the provider rejects.

DSH cold-load appends synthetic error results. Pi Web has no load-time pairing. `sanitizeTitleMessages` **strips** unmatched calls (title only) — the opposite of repair.

## Product one-liner

**On open and before the next prompt, append one error `toolResult` per unmatched `toolCall`. Idempotent. GET does not write.**

## Goals

1. After repair, the leaf used for the next model request has a result for every tool call.
2. Append-only. Second open adds zero rows.
3. Do not mutate GET / `session-entries` / `convertToLlm`.
4. Do not add a sixth run-lifecycle recovery path.

## Non-goals

- Durable inbox splices.
- Compaction human transcript vs model surface.
- DSH `TOOL_NOT_STARTED` vs `TOOL_OUTCOME_UNKNOWN` (no `tool/call` start event on this jsonl).
- Rewriting or truncating assistant rows.
- Side-effecting `GET /api/sessions/[id]`.
- New jsonl `type`.

## Architecture

```
SessionManager.open
    │
    ├─ live wrapper? → skip
    ├─ messages = buildSessionContext().messages
    ├─ unmatchedToolCallIds(messages)
    └─ appendMessage(error toolResult) × N
         then createAgentSessionFromServices

prompt
    │
    ├─ streaming / prompt running? → skip
    └─ same repair on agent.state.messages
```

| Semantic | Owner |
|---|---|
| Pairing + append | **new** `lib/session-tool-repair.ts` |
| Cold call | `lib/rpc-session-start.ts` after `open`, before `createAgentSessionFromServices` |
| Warm call | `lib/rpc-session-commands.ts` `prompt` case, before `inner.prompt` |

Skip repair when `getRpcSession(id)?.isAlive()` on the **open** path (do not rewrite a live turn). Skip on **prompt** when `inner.isStreaming` or `isPromptRunning`.

## Closer shape

```ts
{
  role: "toolResult",
  toolCallId,
  toolName, // copied from the unmatched toolCall
  isError: true,
  content: [{ type: "text", text: INTERRUPTED_TOOL_RESULT_TEXT }],
}

export const INTERRUPTED_TOOL_RESULT_TEXT =
  "Tool did not finish (session interrupted).";
```

Same role as live abort results. Distinct text so tests and humans can tell load-repair from `Operation aborted`.

Pairing: `normalizeToolCalls` first; a `toolResult.toolCallId` closes the `toolCall` with that id (including an existing error result).

## File plan

**New**

- `lib/session-tool-repair.ts` — `unmatchedToolCallIds`, `repairUnmatchedToolCalls`, constant text.
- `lib/session-tool-repair.test.mjs`

**Modified**

- `lib/rpc-session-start.ts` — one call after open; skip if live wrapper.
- `lib/rpc-session-commands.ts` — one call at `prompt`; skip if streaming.

`appendMessage` goes through the SDK `SessionManager` already opened in start (write-capable). Do not use the read-only entries cache.

## Tests

1. Unmatched call → one append, id/name/`isError`/fixed text.
2. Already paired → 0.
3. After simulated append, second `repairUnmatchedToolCalls` → 0.
4. Two unmatched → 2.
5. Live-wrapper skip: if the start path is hard to unit-test, test a `shouldRepairOnOpen({ alive })` helper or document the skip in the start test if one exists.

Optional: temp jsonl + `SessionManager.open` → last `convertToLlm` message is `toolResult`. Skip if the SDK harness is too heavy for this slice.

## Implementation order

1. Pure functions + tests.
2. Hook `startRpcSession`.
3. Hook `prompt`.

## Error handling

| Case | Behavior |
|---|---|
| `appendMessage` throws | Propagate; start/prompt fails loud |
| GET before first RPC | May still show pending cards |
| Empty / balanced leaf | No-op |

## Self-check

1. **Invariant:** leaf tool calls have results before the next model request.
2. **Single owner:** `lib/session-tool-repair.ts`.
3. **Path count:** still 5 run recoveries. Repair is prepare-for-convert, not a poller.
4. **Size:** start/commands gain one call each.
5. **Legacy:** no dual-path. Disk is the source of truth after append.

## Later specs

- Inbox: persist steer/follow-up as `custom` splices (not `custom_message`).
- Compact: human transcript from full leaf; model still uses `buildContextEntries`.
