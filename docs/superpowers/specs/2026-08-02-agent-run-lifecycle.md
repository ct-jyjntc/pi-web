# Agent Run Lifecycle — Single Primary Path

**Date:** 2026-08-02  
**Owner (client):** `hooks/useAgentSession.ts`  
**Owner (timing constants):** `lib/agent-run-lifecycle.ts`  
**Owner (server session):** `lib/rpc-manager.ts` (`AgentSessionWrapper`)  
**Parent blueprint:** [`2026-08-02-declutter-design.md`](./2026-08-02-declutter-design.md)

This document must stay in sync with the implementation. If code and this diagram disagree, **fix the doc in the same PR** or stop the behavior change.

## State machine

```text
                    ┌──────────────────────────────────────────┐
                    │                                          │
                    ▼                                          │
                 idle ──send / mid-stream reconnect──► prompting
                    ▲                                     │
                    │                                     │ agent_start / first stream token
                    │                                     ▼
                    │                                 streaming
                    │                                     │
                    │                          prompt_done / agent_end evidence
                    │                                     ▼
                    │                                 settling
                    │                                     │
                    │                          server idle (finishRun)
                    │                                     ▼
                    │                                   grace
                    │                                     │
                    │              late work? ──yes──► prompting / streaming
                    │                     │
                    └─────────────────────┴── still idle ──► idle (SSE soft-close)
```

| Phase | Client signals | Server signals | Who advances |
|-------|----------------|----------------|--------------|
| **idle** | `agentRunning=false`, no stream bubble | wrapper may exist; not streaming/prompting | user send, bash, compact, or cold reconnect while busy |
| **prompting** | `agentRunning=true`, phase often `running_command` / `waiting_model` | `isPromptRunning` | `agent_start` / stream update → streaming |
| **streaming** | `streamState.isStreaming`, coalesced message updates | `isStreaming` | end evidence → settling |
| **settling** | still `agentRunning` until finish | may already be idle | **single exit** `finishPromptWithoutStream` (finishRun) |
| **grace** | UI idle; SSE held open | idle unless late extension/queue work | timer + one idle check → close SSE, or revive to prompting |

## Single finish exit

**Invariant:** only one function mutates “run finished for UI”:

- Today: `finishPromptWithoutStream(sid, runId?)` in `useAgentSession`
- Callers may only submit **evidence** that the run is done; they must not invent a parallel idle flip.

### Evidence sources (recovery paths)

| # | Source | Role | Notes |
|---|--------|------|-------|
| 1 | **SSE** (`handleAgentEvent`) | **Primary** | `prompt_done`, `agent_end`, `session_destroyed`, stream tokens |
| 2 | **Settlement poll** (`waitForPromptSettlement`) | Backup for end-of-prompt | One loop per `runId`; skipped if already active; uses `/api/agent/[id]` |
| 3 | **Post-settle grace** (`scheduleEventStreamClose`) | Late extension events | **Single** grace owner (`EVENT_STREAM_IDLE_GRACE_MS`); no stacked timers |
| 4 | **Reconcile** (interval + visibility + online) | Missed SSE net while `agentRunning` | Skipped while settlement loop owns the run; **audit before delete** (Phase 1b) |
| 5 | **Monotonic `promptRunId`** | Anti-stale | All late SSE / settle / reconcile / loadSession must no-op when `runId !== current` |

**Do not add path #6.** If #4 is insufficient, fix #1–#3 or document why #4 must stay — never add another poller.

## Run id rules

- `promptRunIdRef` increments when a new user-owned prompt run starts (including mid-stream reconnect binding).
- `streamAcceptRunIdRef` gates which run may update the streaming bubble.
- `promptSettleRunIdRef` ensures one settlement loop per run key.
- `finishPromptWithoutStream(..., runId)` bails if `runId` is provided and does not match current.

## Grace rules

- After UI settle, `scheduleEventStreamClose(sid)` holds SSE for `EVENT_STREAM_IDLE_GRACE_MS`.
- On timer: one server idle check; if prompt active again → revive `agentRunning` (extension/queue); if compacting → re-arm short poll; else soft-close SSE.
- `cancelEventStreamGrace` / hard `closeEvents` on unmount, session switch, or `session_destroyed`.
- **MUST NOT** stack a second grace timer for the same failure mode.

## Reconcile audit (Phase 1b — 2026-08-02)

Evidence sources for finish remain #1 SSE primary, #2 settlement, #4 reconcile backup. All three call the same exit (`finishPromptWithoutStream`).

| Failure mode | SSE reconnect | Settlement | Grace | Reconcile only? | Decision |
|--------------|---------------|------------|-------|-----------------|----------|
| Missed `agent_end` / `prompt_done` after they already kicked settlement | n/a | **yes** (owns idle flip) | n/a | no | keep settlement |
| Half-open EventSource (stays CONNECTING; no CLOSED; no end events; settlement **never started**) | browser auto-retry only | no (never kicked) | n/a | **yes** (interval sees idle) | **keep interval reconcile** |
| Settlement hit `PROMPT_SETTLE_MAX_MS` while still busy, then server later idles | n/a | exhausted | n/a | **yes** | **keep interval reconcile** |
| Tab frozen; late SSE flush after finish | run-id drop | may finish first | n/a | secondary | keep run id; reconcile harmless if idle |
| Stuck compacting UI (`compaction_end` missed) | if event arrives | busy includes compact → no finish | compact re-arm in grace | **yes** (`setIsCompacting`) | keep compact mirror on reconcile; do not delete without folding into settle snapshot |
| Queue panel drift while running | status events | no | no | **yes** (queuedMessages equal-check) | keep or fold into settle GET later (PR-1c); not a reason for a new poller |
| Network restore mid-run | reconnect path | if already settling | n/a | online → same `reconcileAgentState` | **keep** as accelerator of #4, not a 6th system |
| Tab foreground mid-run | same | same | n/a | visibility → same fn | **keep** as accelerator of #4 |
| SSE reconnect max attempts | hand off to settlement (keep `agentRunning`) | **yes** (kicked on give-up) | cancelled | interval remains backup | **fixed PR-1a/c:** no local idle invent; single settle→finish exit |

### Why we cannot delete path #4 yet

1. Settlement is **not** always started (depends on SSE end events, slash, failed POST, or mid-stream reconnect binding). Silent half-open streams never enter #2.
2. Settlement is **time-capped** (20s). Long tool runs that go idle after the cap need another idle observer while `agentRunning` remains true.
3. Compaction + queue mirrors on the 15s tick have no other owner today.

### What we will not do

- Add a third poller, a second grace timer, or a parallel finish function.
- Delete visibility/online without human OK — they share `reconcileAgentState` (path #4), they are not a separate recovery mechanism.
- Fold queue/compact into settlement and narrow reconcile in a later PR only after the half-open + settle-cap cases still have an owner (likely: “if agentRunning && no settle loop → start settlement” as evidence, still one exit).

**Phase 1b decision:** **keep** interval + visibility/online reconcile with the table above as the written justification. Deletion/narrow is blocked until PR-1c closes the reconnect-give-up gap and optionally unifies “kick settlement if running without a loop.”

## Server coupling

- Live snapshot: `lib/agent-live-state.ts` → `GET /api/agent/[id]` (and sessions alias). One reader module.
- In-process registry: `globalThis.__piSessions` only; start locks `globalThis.__piStartLocks`.
- Fork: wrapper mutates id in place → `send("fork")` must destroy wrapper under old id before return.

## Related constants (code owner)

See `lib/agent-run-lifecycle.ts`:

- `PROMPT_SETTLE_INITIAL_DELAY_MS`, `PROMPT_SETTLE_POLL_MS`, `PROMPT_SETTLE_MAX_MS`
- `EVENT_STREAM_IDLE_GRACE_MS`
- `AGENT_STATE_RECONCILE_MS`, `BASH_STATE_RECONCILE_MS`
- SSE connect/reconnect backoff constants
