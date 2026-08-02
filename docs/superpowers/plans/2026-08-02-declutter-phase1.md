# Declutter Phase 1 — Agent Hot-Path Mechanism Merge

**Date:** 2026-08-02  
**Spec:** [`docs/superpowers/specs/2026-08-02-declutter-design.md`](../specs/2026-08-02-declutter-design.md)  
**Lifecycle:** [`docs/superpowers/specs/2026-08-02-agent-run-lifecycle.md`](../specs/2026-08-02-agent-run-lifecycle.md)  
**Constraint bible:** `AGENTS.md` § AI Coding Constraints  
**Status:** Phase 1 size goal met (`useAgentSession` &lt;1500); optional PR-1c settle kick still open

## Baseline (Phase 0 snapshot → remeasured)

| File | Phase 0 | Now | Target trend |
|------|--------:|----:|--------------|
| `hooks/useAgentSession.ts` | ~2043 | ~1427 | break 1500 → ~1000 ✓ |
| `lib/rpc-manager.ts` | ~1533 | 28 façade (+ wrapper 1234 / start 251 / registry 77) | split by concern, no behavior change |
| Recovery mechanisms | 5 (SSE, settle poll, grace, reconcile+vis/online, run id) | same (give-up → settle) | only decrease or keep with written “why” |

## Outcome

One run lifecycle that can be explained in one diagram; all finish evidence (SSE / settle / reconcile) submits to a **single exit**; pure helpers leave the hook; `rpc-manager` splits without dual registries.

## Non-goals

- Changing grace duration, fork→parent chain, or session `.jsonl` format
- Fully deleting visibility/online reconcile without human OK
- Giant UI splits (Phase 3) or dual-path product cleanup (Phase 2)

## PR series (independently shippable)

### PR-1a — Docs + pure extracts (this PR)

**Goal:** shrink the hook without touching recovery semantics.

| Work | Concrete |
|------|----------|
| Lifecycle doc | `docs/superpowers/specs/2026-08-02-agent-run-lifecycle.md` + constants owner `lib/agent-run-lifecycle.ts` |
| Live-state apply | `lib/agent-session-live-apply.ts` — `applyLiveAgentStateFields`, queue normalize/equal |
| Notices | `lib/agent-session-notices.ts` — types + reducer |
| Message key / compact parse / stream reducer | `lib/agent-session-message-key.ts`, `lib/agent-session-compact-parse.ts`, `lib/agent-session-stream-state.ts` |
| Hook | re-export public types; import pure modules only |

**Acceptance**

- [x] Manual: open session, send, stream tokens, stop — unchanged (extract-only; behavior freeze)
- [x] `tsc --noEmit` clean for touched files
- [x] `useAgentSession.ts` 2043 → ~1791; no recovery path added
- [x] Self-check block in notes (below)

**Recovery paths after:** 5 (was 5) — docs/extract only.

```text
Invariant: pure helpers / timing constants have single owners; hook re-exports public types
Owner module: lib/agent-run-lifecycle.ts + lib/agent-session-*.ts; finish still useAgentSession
Recovery paths after change: 5 (was 5)
Files >800 lines touched: yes (useAgentSession); net ~-252 lines in hook
New dual-path?: no
```

### PR-1b — Reconcile audit + optional narrow

**Goal:** prove what reconcile alone fixes; keep or delete with written justification.

1. Inventory call sites of `reconcileAgentState` / interval / `visibilitychange` / `online`.
2. Map failures: missed `agent_end`, stuck compacting UI, queue drift, mid-stream refresh.
3. For each, mark covered by: SSE reconnect | settlement poll | grace | **reconcile only**.
4. If no “reconcile only” failures remain under normal product use → delete interval + listeners in a follow-up (human OK required).
5. If needed, keep **one** of: interval **or** visibility/online — not both new systems; never add a third.

**Human confirmation before:** fully removing visibility/online reconcile.

**Acceptance:** written audit table in lifecycle doc or this plan; path count ≤ baseline.

**Result (2026-08-02):** audit filled in lifecycle doc. **Keep path #4** (interval + visibility/online as accelerators of the same `reconcileAgentState`). Unique coverage: half-open SSE without settlement kick; settlement max timeout; compact/queue mirrors. Optional narrow deferred to PR-1c (reconnect give-up → finish; optional “kick settlement if running without loop”). Path count stays **5**.

### PR-1c — Single finish/settle exit (evidence only)

**Goal:** SSE `prompt_done` / `agent_end`, settlement poll, and reconcile only *submit evidence* into one `finishPromptWithoutStream` (or renamed `finishRun`) owner.

1. Document which callers may call finish (table in lifecycle doc).
2. Ensure every caller passes `runId`; late evidence no-ops when `runId !== current`.
3. No new timer/grace stacked on `EVENT_STREAM_IDLE_GRACE_MS`.

**Acceptance:** manual mid-stream refresh, background tab, stop, compact, late extension widget.

### PR-1d — Extract event→state / remaining pure from hook

**Goal:** continue line-count trend (handleAgentEvent reducers, slash helpers) without behavior change.

Target: `useAgentSession.ts` **&lt; 1500** after this PR if not already.

**Result:** 1796 → ~1741. Extracted `agent-session-phase`, `message-merge`, `slash-parse`, `extension-ui`. Still above 1500 — more event wiring remains in the hook for a follow-up.

### PR-1e — Split `rpc-manager` by concern

**Goal:** file size only; same public API.

| Module | Responsibility |
|--------|----------------|
| `lib/rpc-registry.ts` | `globalThis.__piSessions` / start locks / destroy-for-cwd / idle destroy |
| `lib/rpc-session-wrapper.ts` | `AgentSessionWrapper` class (send switch + extension UI) |
| `lib/rpc-session-start.ts` | `startRpcSession` + tool assembly / system-prompt extras |
| `lib/rpc-manager.ts` | façade re-exports + boot side effects so existing imports stay stable |

**Must not:** add a second session Map; fork→destroy stays in wrapper send path.

**Acceptance:** smoke send/fork/compact; `getRpcSession` / `startRpcSession` / `getRunningRpcSessionIds` call sites unchanged.

**Result:** façade 28 lines; single registry still in `rpc-registry.ts`; tests updated; `tsc` + `rpc-manager.test.mjs` green.

```text
Invariant: one session Map; public API via rpc-manager façade; pure session UI helpers leave the hook
Owner module: rpc-registry / rpc-session-wrapper / rpc-session-start; useAgentSession still owns finish
Recovery paths after change: 5 (was 5)
Files >800 lines touched: yes (useAgentSession net down; wrapper 1234 from 1553 monolith)
New dual-path?: no
```

## Manual acceptance checklist (all Phase 1 PRs)

- [ ] Send message → stream → idle
- [ ] Refresh mid-stream → reconnect + finish
- [ ] Tab background/foreground during run
- [ ] Fork user message → new session + correct parent chain
- [ ] Stop / abort
- [ ] Compact (manual + auto if available)
- [ ] Late extension status/widget after settle (grace window)
- [ ] Bash run settle if used

## Per-PR self-check template

```text
Invariant: ...
Owner module: ...
Recovery paths after change: N (was M)
Files >800 lines touched: yes/no; net lines: ...
New dual-path?: no | yes + removal condition
```

## Risk / rollback

- Prefer pure extracts first; behavior edits isolated in PR-1b/c.
- Each PR reverts independently; no session file format changes.
- If SSE alone is insufficient after audit, **keep** existing reconcile with a “why we cannot delete” note — never add a third recovery system.
