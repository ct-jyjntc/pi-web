# Lean Mode Design — Anti-Bloat for Product Users

**Date:** 2026-08-02  
**Status:** Approved (spec) — implementation plan: [`../plans/2026-08-02-lean-mode-implementation.md`](../plans/2026-08-02-lean-mode-implementation.md)  
**Related:** [`AGENTS.md` § AI Coding Constraints](../../../AGENTS.md) (Pi-Web **repo** self-discipline only); [declutter blueprint](./2026-08-02-declutter-design.md) (internal cleanup, not user product)

## Problem

Coding agents under iterative self-repair tend to accumulate defensive and patch-style code:

- Stacked fallback / retry / reconcile / grace paths for the same failure mode
- Widened `try/catch`, blind optional chaining, or ignored errors that silence symptoms without naming the broken invariant
- The same semantic duplicated across UI + hook + API + service layers
- Dual implementations “for compatibility” with no removal condition
- Large files grown by another 30–100 lines of guards instead of extract-or-merge

Pi Web already encodes hard anti-bloat rules for **its own** repository in `AGENTS.md`, plus a declutter roadmap. Those do **not** ship as a product capability for end users. Users of Pi Web still get unconstrained agent edits that can bloat *their* codebases over time.

## Product one-liner

**Lean Mode (opt-in):** when enabled, Pi Web constrains agent edits with portable engineering discipline (soft) plus a high-signal post-change lean review (review / hard). Default off — zero behavior change until the user opts in.

## Goals

1. **Opt-in product surface** — Settings toggle; off path identical to today.
2. **Layered intensity** — `soft` → `review` (recommended default when enabled) → `hard` (v1 = stricter prompt + review only).
3. **Portable policy** — general engineering rules, not Pi-Web hot-path trivia (SSE, fork, hashline, …).
4. **Explainable** — shared vocabulary: invariant / single owner / recovery path count / dual-path / file bloat.
5. **Low noise** — report only high-signal smells; silent when clean.
6. **Reserve per-project override** — merge function and types in v1; UI may be global-only at first.

## Non-goals (v1)

- Auto-refactoring user code for “declutter”
- Replacing the user’s project `AGENTS.md`, lint, or CI
- Writing lean policy into global `~/.pi/agent/AGENTS.md` (must not affect pi CLI / users who never enabled the switch)
- Full architecture scores, complexity dashboards, or continuous repo health scans
- Mechanical hard gates in the edit tool (defined as extension point only)
- Weakening path security, auth, or project trust
- A fourth live-state recovery path (poll / SSE / visibility) for lean review

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Primary audience | Product users (not only Pi-Web dogfood) |
| Default | **Off** (`enabled: false`) |
| Intensity when on | Default **`review`** |
| Hard in v1 | Available; **stricter prompt + stricter review**, not tool reject |
| Appearance | Settings opt-in switch (not auto-by-repo, not Git-Review-only button) |
| Global vs project | Global in Settings; **per-project override reserved** via merge helper |
| Success signal priority | Low noise + perceived restraint → cleaner change shape → explainable discipline → file growth as secondary |

## Settings model

Stored in `~/.pi/agent/pi-web.json` via existing `lib/web-settings.ts`.

```ts
leanMode: {
  enabled: boolean;              // default false
  intensity: "soft" | "review" | "hard";  // when enabled; default "review"
  reviewOnAgentEnd: boolean;     // default true; only meaningful for review|hard
  // Reserved for post-v1 mechanical gates (read/ignore in v1 OK):
  // hardGates?: {
  //   maxNetGrowthOnLargeFile?: number;
  //   largeFileLineThreshold?: number;
  // }
}
```

### UI (Settings)

- Toggle: **Keep codebase lean** / 保持代码库精简
- Intensity: Soft | Review (recommended) | Hard
- Short help: when on, the agent edits more conservatively and (review/hard) runs a post-edit leanness check
- Optional: “Review after each edit turn” bound to `reviewOnAgentEnd`

### Scope / activation timing

- Global web setting (same tier as model roles / advisor).
- Applies to **new sessions and subsequent prompts** after enable; no requirement to hot-patch an in-flight stream’s system prompt mid-run.

### Per-project override (reserved)

Suggested project file (pick one path in implementation plan and stick to it), e.g. `<cwd>/.pi-web.json`:

```ts
{
  leanMode?: {
    enabled?: boolean;
    intensity?: "soft" | "review" | "hard";
    reviewOnAgentEnd?: boolean;
  }
}
```

**Merge rule:** project field present → overrides that field; absent → inherit global.  
**Single owner:** `lib/lean-settings.ts` (or equivalent) — no second merge in UI/API/rpc.

## Pre-prompt: portable lean policy

### Injection rules

- Only when effective `leanMode.enabled === true`.
- Inject via Pi Web session start path (same family as `appendSystemPromptOverride` in `startRpcSession`) so **CLI / non–Pi-Web** sessions are unaffected.
- **Do not** rewrite user or global `AGENTS.md` for this feature.
- Coexist with project `AGENTS.md`: project domain/safety rules win on conflict; lean only constrains *change shape*.

### Policy content (portable)

Short MUST-style discipline for arbitrary user repos:

1. **No stacked recovery** — if a failure mode already has retry/fallback/poll/reconcile, merge or replace before adding another.
2. **No nameless swallow** — do not fix bugs only by widening `try/catch`, blind `?.`, or ignoring errors; name the invariant that failed.
3. **Single owner** — one module owns a semantic; UI/hook/API call it rather than reimplement.
4. **Prefer delete/merge over new guards** when both would silence the symptom.
5. **No dual-path without exit** — classic+new / compat shims need an explicit removal condition.
6. **Size discipline** — prefer extract-then-edit on already-large files; avoid another pile of guards.
7. **Self-check before finishing** (briefly in the final assistant reply when the turn edited code):
   - Invariant?
   - Single owner?
   - Path count (which recovery path number is this)?
   - Dual-path? (no | yes + removal condition)

### Intensity modulation

| Intensity | Prompt tone | Post-turn review |
|-----------|-------------|------------------|
| `soft` | Guidance + self-check | None (unless manual later) |
| `review` | Discipline + “you will be lean-reviewed” | Auto if `reviewOnAgentEnd` and turn wrote files |
| `hard` | MUST/MUST NOT; unfinished if patch-stacked without user override | Same trigger; stricter rubric (see below) |

## Post-turn: Lean Review

### Boundaries vs existing features

| Mechanism | Reviews | When |
|-----------|---------|------|
| **Advisor** (existing) | Reply *content* risk | Each `agent_end` if enabled |
| **Git Reviewer** | Diff *correctness* bugs | Explicit Git Review |
| **Lean Review** (new) | Diff *shape* (bloat smells) | Lean on + intensity ≠ soft + writes this turn |

Do **not** merge these into one model call (different jobs). Lean UI must stay quiet when there are no findings so it does not double-spam with Advisor.

### Trigger (all required)

1. Effective `enabled === true`
2. `intensity` is `review` or `hard`
3. `reviewOnAgentEnd === true` (or explicit manual “Check leanness”)
4. This turn actually wrote files (successful edit/write-class tools and/or non-empty worktree diff vs turn start)
5. Skip pure Q&A / read-only turns

v1 does **not** need a 10-turn cadence (unlike memory-review): write-gated triggers are naturally rarer. Optional coalescing can wait.

### Inputs (bounded)

- Unified diff for the turn (cap ~12–16KB; if truncated, include file list + truncated note)
- Optional: assistant self-check snippet if present
- **Not** full transcript (advisor owns that)

Utility model chain: reuse memory-review style **smol → plan → default** (`resolveUtilityModel`), single completion, no tool loop.

### Output schema (fixed)

```json
{
  "verdict": "lean" | "bloated" | "unclear",
  "summary": "1-2 sentences",
  "findings": [
    {
      "kind": "stacked_recovery" | "swallow_error" | "missing_owner" | "dual_path" | "file_bloat" | "patch_without_invariant",
      "severity": "P1" | "P2" | "P3",
      "title": "short title",
      "body": "what + why + better shape",
      "file_path": "/absolute/or/repo/path",
      "suggestion": "merge path X / extract Y / name invariant Z"
    }
  ],
  "self_check": {
    "invariant_stated": true,
    "owner_stated": true,
    "path_count_ok": true
  }
}
```

### Rubric strictness

- **`review`:** emit P1–P2 only; drop P3; empty findings + lean → **UI silent**
- **`hard`:** may include P3 (hard cap, e.g. max 5 findings); failed `self_check` fields become at least one finding; still **non-blocking** for the next turn
- Dual-path findings require naming old vs new path; otherwise do not report (reduce false positives)

### UI

- Lightweight session notice/card (Advisor-adjacent visual language; label `Lean` / 精简)
- P1 or `verdict=bloated` → concern styling; P2-only → subtle
- Manual “Check leanness” when lean is enabled
- v1 may keep report in client state only (lost on refresh is OK if documented); optional session custom message is a later nicety
- **Never** write lean results into the user’s git tree as a product side effect

### API

`POST /api/lean-review`  
Body: `{ sessionId, cwd, intensity?, mode: "auto" | "manual" }`  
Response: `{ skipped: boolean, reason?: string, report?: LeanReport }`

### Failure policy

- No model / empty diff / timeout / bad JSON → `skipped`, no user toast storm
- Single attempt; no retry cascade
- **Must not** add poll/SSE/visibility machinery for lean review lifecycle

## Hard intensity (v1 + later)

**v1 Hard** = stricter policy wording + stricter review only.

Reserved (implement later; single future owner = edit-tool wrapper):

```ts
hardGates?: {
  maxNetGrowthOnLargeFile?: number; // e.g. 30
  largeFileLineThreshold?: number;  // e.g. 800
}
```

If mechanical gates ship later: structured failure kinds (same spirit as hashline edit failures); one owner module; no duplicate checks in UI + hook + API.

## Architecture

```
Settings (leanMode global)
    │
    ├─ lean-settings: merge global ⊕ project override
    │
    ├─ startRpcSession:
    │     enabled? → append portable policy (intensity-modulated)
    │
    └─ ChatWindow onAgentEnd (existing fire-and-forget pattern):
           soft? → stop
           else if reviewOnAgentEnd && hadWrites
             → POST /api/lean-review
             → lib/lean-review.ts
             → LeanReviewCard (findings only)
```

### Module owners

| Module | One-sentence responsibility |
|--------|------------------------------|
| `lib/web-settings.ts` | Persist/parse `leanMode` defaults with other web prefs |
| `lib/lean-policy.ts` | Build portable policy text for a given intensity |
| `lib/lean-settings.ts` | Resolve effective lean config (global ⊕ project) |
| `lib/lean-review.ts` | Collect diff, call utility model, parse/validate report, skip rules |
| `app/api/lean-review/route.ts` | HTTP entry for lean review |
| Settings UI section | Toggle + intensity + short copy |
| `components/ChatWindow.tsx` | Thin trigger + state wiring only |
| `components/LeanReviewCard.tsx` | Render lean findings |

Follow AI Coding Constraints: do not grow already-huge files by large net lines without extract; prefer a small Settings subsection component if `SettingsPage` is over the soft cap.

## Relationship to repo AGENTS.md / declutter

- **Repo `AGENTS.md` constraints** remain the law for contributing to Pi Web itself; they are denser and product-specific.
- **Lean Mode** is the **user-facing portable subset** plus review UX.
- **Declutter blueprint** continues to clean Pi Web’s own hot path; it is not the user feature.

Dogfooding: developers may enable Lean Mode while working on Pi Web; that does not replace reading `AGENTS.md`.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Double banners with Advisor | Silent when no findings; write-gated trigger |
| False dual-path reports | Require old+new path in finding body |
| Truncated diff misses smells | Mark truncated; manual re-run |
| Users expect hard block in v1 | Copy states hard is stricter review until gates exist |
| Prompt ignored | Review layer makes violations visible without blocking |

## Acceptance (v1)

1. Default off: no policy inject, no lean-review API calls, no Lean UI.
2. `soft`: policy present in session system attachment; no auto lean-review.
3. `review`: after a turn that edits files with an intentional stacked-fallback smell, a finding appears; a clean small edit stays silent.
4. `hard`: same trigger path; stricter findings / self_check handling.
5. Disabling the switch: subsequent new sessions do not inject policy.
6. Enabling never rewrites `~/.pi/agent/AGENTS.md` for lean policy.
7. No new agent lifecycle poller/SSE for lean review.
8. Effective config merge helper exists even if project file UI is deferred.

## Implementation phases (for planning skill)

1. **Settings + types** — `leanMode` in web-settings, Settings UI, i18n  
2. **Policy inject** — `lean-policy` + `startRpcSession` append when enabled  
3. **Lean review pipeline** — diff collect, API, utility completion, parse  
4. **UI card + ChatWindow wiring** — auto + manual  
5. **Project override reader** — merge helper + documented file path (UI optional)  
6. **Hard mechanical gates** — separate later spec; not v1

## Per-PR self-check (agents implementing this)

```text
Invariant: ...
Owner module: ...
Recovery paths after change: N (was M)
Files >800 lines touched: yes/no; net lines: ...
New dual-path?: no | yes + removal condition
```

## Open items (resolved / residual)

| Item | Resolution |
|------|------------|
| Project override filename | **Locked:** `<cwd>/.pi-web.json` (`leanMode` partial) — see implementation plan |
| “Had writes” detection | Client toolCall heuristic + server empty-diff skip |
| Lean card persistence | **v1 client-only** (refresh clears) |
| i18n / Hard helper copy | Finalized in implementation Phase 2 |
