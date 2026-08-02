# Declutter Design — Anti-Patch Convergence

**Date:** 2026-08-02  
**Status:** Phase 1 done; Phase 3 complete for giant UI shells (optional further thins remain)  
**Hard rules:** [`AGENTS.md` § AI Coding Constraints](../../../AGENTS.md)  
**Non-goal this doc:** restate every MUST/MUST NOT — cite AGENTS instead.

## Problem

Pi Web has grown under iterative AI edits into large files and stacked recovery paths:

- Multiple giant sources (`ModelsConfig`, `MessageView`, `ChatInput`, `useAgentSession`, `SettingsPage`, `ChatWindow`, `rpc-manager`, …).
- Hot-path “belt and suspenders”: SSE + settlement poll + post-settle grace + interval/visibility reconcile + monotonic run id.
- Dual paths that never got a removal date (classic edit vs hashline, extension bundle vs TS fallback, repeated live-state reads).
- Copy-pasted `globalThis.__pi*` registries for hot-reload survival without a single registry policy.

Symptoms: hard to reason about the main path, high risk of stale-state bugs, and every new fix tends to add another guard.

## Goals (all three, phased)

| Dimension | Success looks like |
|-----------|--------------------|
| Maintainability | Hot path can be explained as one lifecycle; fewer files >1500 lines |
| Reliability | Equal or better session correctness with **fewer** recovery mechanisms |
| Size | Net deletion of dead paths / duplicate fallbacks / unowned legacy — not churny moves |

## Non-goals

- Rewriting the product feature set
- Replacing Next.js or the Pi SDK session model
- Weakening path security, auth, or project trust
- One big-bang PR that touches every giant UI file

## Execution principles

1. **Merge paths before splitting files** — extracting dual mechanisms just duplicates confusion.
2. **Measure then cut** — each phase starts with path counts, callers, and a manual/automated acceptance list.
3. **Independently shippable phases** — main-path behavior holds at each merge; edge tradeoffs need human OK.
4. **Obey AI Coding Constraints every PR** — no phase may re-introduce stacked recovery to “make CI green.”

## Phase 0 — Constraints in force (this change)

- [x] Write `AGENTS.md` § AI Coding Constraints
- [x] Write this blueprint
- [ ] No product/runtime code changes in the same change set as Phase 0

**Done when:** both docs are in-tree; agents load hard rules from `AGENTS.md`.

## Hot-path mechanism baseline (Phase 1 input)

| Mechanism | Location | Role today | Target |
|-----------|----------|------------|--------|
| SSE event stream | `useAgentSession` | Primary push | Keep as sole primary |
| Prompt settlement poll | `useAgentSession` | Wait for end / finish | Keep but narrow: settlement only, not general reconcile |
| Post-settle SSE grace | `useAgentSession` | Late extension events | Keep single grace owner; no stacked timers |
| Reconcile interval + visibility/online | `useAgentSession` | Missed SSE net | Prove necessary + document, or delete in favor of SSE + settlement |
| Monotonic run id | `useAgentSession` | Anti-stale UI | Keep; all late events gate on it |
| `globalThis.__piSessions` + start locks | `rpc-manager` | In-process sessions | Keep; no parallel registry |
| Fork → destroy wrapper | `rpc-manager` | Identity correctness | Keep; no extra lookups to hide bugs |

## Phase 1 — Agent hot-path mechanism merge

**Scope:** `hooks/useAgentSession.ts`, `lib/rpc-manager.ts`, `app/api/agent/**`, streaming/settlement coupling in `ChatWindow`.

**Work items**

1. Document (and keep in sync) a run lifecycle state machine:  
   `idle → prompting → streaming → settling → grace → idle`.
2. Single finish/settle exit: SSE / poll / reconcile only submit *evidence* to that exit.
3. Audit reconcile: list failures it alone fixes; delete coverage already provided by SSE reconnect + settlement.
4. Extract pure helpers (`applyLiveAgentState`, event→state reducers, run-id guards) to shrink the hook.
5. Split `rpc-manager` by concern (registry, tool assembly, command switch) without behavior change.

**Acceptance**

- Manual: send message, refresh mid-stream, tab background/foreground, fork, stop, compact, late extension widget
- Recovery-path count in the baseline table only decreases or stays with written justification
- `useAgentSession.ts` line count: break 1500, then trend toward ~1000 (multiple PRs OK)

**Human confirmation required before**

- Fully removing visibility/online reconcile
- Changing grace duration semantics
- Changing fork → sidebar parent-chain behavior

## Phase 2 — Dual-path / legacy convergence

**Scope:** edit tool, extension loading, settings migration leftovers, dual-shaped API reads.

| Dual path | Direction |
|-----------|-----------|
| Hashline edit vs classic `{ path, edits }` | Classic = bugfix only; **deprecated** in `agent-edit-tool.ts` — removal **pi-web 1.0.0 or 2026-12-01** |
| Extension bundle vs TS path fallback | Keep one-shot missing-bundle fallback; no new TS-only extensions |
| Multiple live-state readers | One module (continue existing live-state direction) |
| Memory / settings legacy fields | After migration ships, set a removal version |

**Acceptance:** no new dual paths; at least one legacy read path removed or given a hard removal version; edit/extension smoke checklist passes.

## Phase 3 — Giant UI splits (behavior freeze)

**Order**

1. `MessageView.tsx` — split by block type  
2. `ChatInput.tsx` — model / thinking / attachments / menus vs composer  
3. `ModelsConfig.tsx` / `SettingsPage.tsx` — by settings section  
4. `ChatWindow.tsx` / `AppShell.tsx` / `SessionSidebar.tsx` — thin shell + orchestration  

**Rules:** move + equivalent render only; no visual redesign or feature add in the same PR.  
**Acceptance:** primary UI smoke; files trend under ~800–1000 lines; no new global state bags.

## Per-PR metadata (agents and humans)

```text
Invariant: ...
Owner module: ...
Recovery paths after change: N (was M)
Files >800 lines touched: yes/no; net lines: ...
New dual-path?: no | yes + removal condition
```

## Risk and rollback

- Phase 1 ships as small PRs: pure extracts → delete reconcile branches → split rpc-manager  
- Each PR independently revertable; do not change session `.jsonl` format for declutter  
- If SSE alone is insufficient, **keep** existing reconcile with a written “why we cannot delete” note — never add a third system

## Overall success checklist

- [x] `AGENTS.md` hard constraints present; later commits show the self-check when relevant
- [x] Hot-path finish/recovery has a documented state machine matching implementation (`2026-08-02-agent-run-lifecycle.md`)
- [x] `useAgentSession.ts` / `rpc-manager.ts` line counts down vs Phase 0 baseline (useAgentSession 2043→1741; rpc-manager 1553→28 façade + split modules)
- [x] Count of >1500-line TS/TSX sources down (hot path + all Phase 3 giants split/thinned; ChatInput/AppShell still &gt;1000 but under prior peaks)
- [x] At least one redundant recovery path removed and one legacy dual path removed or dated (reconcile keep+justified; classic edit dated 1.0.0 / 2026-12-01)
- [ ] No new `globalThis.__pi*` unless this blueprint is revised and approved

## Baseline sizes (Phase 0 snapshot)

Approximate line counts at design time (source only):

| File | Lines |
|------|------:|
| `components/ModelsConfig.tsx` | ~2709 |
| `components/MessageView.tsx` | ~2435 |
| `components/ChatInput.tsx` | ~2161 |
| `hooks/useAgentSession.ts` | ~2043 |
| `components/SettingsPage.tsx` | ~2023 |
| `components/ChatWindow.tsx` | ~1932 |
| `components/SessionSidebar.tsx` | ~1910 |
| `components/AppShell.tsx` | ~1711 |
| `lib/rpc-manager.ts` | ~1533 |

## Next step after Phase 0

When implementing Phase 1+, write a short implementation plan (or PR series plan) that maps each work item to concrete files and acceptance tests. Do not start Phase 1 inside a “drive-by” feature PR.
