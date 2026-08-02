# Lean Mode Implementation Plan

**Date:** 2026-08-02  
**Spec:** [`docs/superpowers/specs/2026-08-02-lean-mode-design.md`](../specs/2026-08-02-lean-mode-design.md)  
**Status:** Implemented (v1 + follow-ups: turn-scoped diff, idle session reset, manual re-run, hard gates, project override UI)  
**Constraint bible:** `AGENTS.md` § AI Coding Constraints

## Outcome

Ship opt-in **Keep codebase lean** for product users:

1. Settings toggle + intensity (`soft` | `review` | `hard`)
2. Session system-prompt inject of portable lean policy (Pi Web only)
3. Post-edit Lean Review (utility model, high-signal card)
4. Effective-config merge helper with **project override reserved** (reader + merge in v1; Settings UI global-only OK)

Default remains **off** — zero behavior change until enabled.

## Non-goals in this plan

- Mechanical edit-tool hard gates
- Rewriting `~/.pi/agent/AGENTS.md` for lean policy
- Merging Advisor / Git Reviewer into Lean Review
- Declutter Phase 1+ of Pi Web’s own hot path (separate blueprint)

## Size & ownership guardrails (must obey while coding)

| File today | Rule |
|------------|------|
| `SettingsPage.tsx` ~2023 | **Do not** dump a large form inline. Extract `components/settings/LeanModeSettingsSection.tsx` (or similar). Net SettingsPage growth ≤ ~25 lines of import + mount. |
| `ChatWindow.tsx` ~1932 | **Do not** add another 80-line review block. Prefer `hooks/useLeanReviewOnAgentEnd.ts` or a ≤40-line call into a helper that mirrors memory-review fire-and-forget. |
| `rpc-manager.ts` ~1533 | Only compose an extra system-prompt chunk next to `buildMemoryInjectBlock`; policy text lives in `lib/lean-policy.ts`. |
| New modules | One concern each; file-header one-liner. No new `utils.ts`. |

Per-PR self-check in the commit body:

```text
Invariant: ...
Owner module: ...
Recovery paths after change: N (was M)
Files >800 lines touched: yes/no; net lines: ...
New dual-path?: no
```

---

## Phase 0 — Types & settings persistence

**Goal:** `leanMode` round-trips in `pi-web.json` with safe defaults.

### Steps

1. **`lib/web-settings.ts`**
   - Add types:

     ```ts
     export type LeanIntensity = "soft" | "review" | "hard";
     export type LeanModeSettings = {
       enabled: boolean;
       intensity: LeanIntensity;
       reviewOnAgentEnd: boolean;
     };
     ```

   - Extend `WebSettings` with `leanMode: LeanModeSettings`.
   - Defaults:

     ```ts
     leanMode: {
       enabled: false,
       intensity: "review",
       reviewOnAgentEnd: true,
     }
     ```

   - Parse in `normalizeWebSettings`:
     - `enabled` / `reviewOnAgentEnd` via `asBool`
     - `intensity` allow-list; invalid → `"review"`
   - Ensure `writeWebSettings` / partial patch paths already deep-merge or replace whole object consistently with other nested prefs (match `projectMemory` pattern).

2. **Client settings types** (if SettingsPage duplicates a local prefs shape) — add the same fields so GET/PATCH `/api/...` settings route does not drop them. Grep for `advisorEnabled` in API + SettingsPage and mirror.

3. **Smoke**
   - Read missing key → defaults.
   - Write `{ leanMode: { enabled: true } }` → re-read has intensity `review`, reviewOnAgentEnd `true`.

### Done when

- [ ] `readWebSettings().leanMode` always defined
- [ ] Enabling does not require other fields to be present in JSON
- [ ] No `as any` / lint disable

---

## Phase 1 — Effective config + portable policy

**Goal:** single owner for “is lean on for this cwd?” and policy text.

### New files

1. **`lib/lean-policy.ts`**  
   Responsibility: *Build intensity-modulated portable lean policy markdown/text for system prompt append.*

   - Export `buildLeanPolicyText(intensity: LeanIntensity): string`
   - Content per spec § portable policy (stacked recovery, swallow error, single owner, prefer delete/merge, dual-path exit, size discipline, self-check questions)
   - Soft = guidance tone; review = + “you will be lean-reviewed”; hard = MUST/MUST NOT + unfinished-if-patch-stacked

2. **`lib/lean-settings.ts`**  
   Responsibility: *Resolve effective lean mode from global web settings ⊕ optional project file.*

   - Export `PROJECT_LEAN_FILE = ".pi-web.json"` (lock this name in code + spec open item)
   - Export `readProjectLeanOverride(cwd: string): Partial<LeanModeSettings> | null`  
     - Read `<cwd>/.pi-web.json` if exists; parse only `leanMode` object; ignore rest; never throw (missing/invalid → null)
   - Export `resolveLeanMode(cwd: string | null | undefined, global?: WebSettings): LeanModeSettings`  
     - Start from `global?.leanMode ?? defaults`
     - Overlay project fields that are present
   - **No UI required** for project file in v1; tests/manual: drop `.pi-web.json` and confirm override

### Integration — inject at session start

3. **`lib/rpc-manager.ts`** (`startRpcSession` only)
   - After `buildMemoryInjectBlock(cwd)`:
     - `const lean = resolveLeanMode(cwd)`
     - if `lean.enabled && !toolsFullyDisabled` → `leanBlock = buildLeanPolicyText(lean.intensity)`
   - Compose `appendSystemPromptOverride`:

     ```ts
     const extras = [memoryBlock, leanBlock].filter(Boolean) as string[];
     appendSystemPromptOverride: extras.length
       ? (base) => [...base, ...extras]
       : undefined
     ```

   - **Invariant:** lean never rewrites AGENTS.md; only session append.
   - **Path count:** extend existing override hook; do not add a second system-prompt mechanism.

### Done when

- [ ] Lean off → system prompt unchanged vs baseline
- [ ] Lean on → policy text present (system prompt viewer / debug)
- [ ] Project `.pi-web.json` `{ "leanMode": { "enabled": true } }` enables even if global off
- [ ] Tools fully disabled still skips lean inject (same as memory)

---

## Phase 2 — Settings UI

**Goal:** opt-in switch visible and patchable.

### Steps

1. **`lib/i18n/messages.ts`** — EN + ZH keys, e.g.:
   - `settings.leanSection` — Lean Mode / 精简模式
   - `settings.leanMode` — Keep codebase lean / 保持代码库精简
   - `settings.leanModeDesc` — short opt-in explanation
   - `settings.leanIntensity` — Intensity / 强度
   - `settings.leanIntensitySoft|Review|Hard` + Hard helper (“stricter review in this version; no mechanical block yet”)
   - `settings.leanReviewOnEnd` — Review after edit turns
   - `lean.reviewTitle` / `lean.verdictBloated` / etc. for card

2. **`components/settings/LeanModeSettingsSection.tsx`** (new)  
   Responsibility: *Render lean mode toggles; call parent `patchPref`.*

   Props: current `leanMode`, `patchPref`, `t` (or useI18n inside).

3. **`components/SettingsPage.tsx`**
   - Extend local prefs default + hydrate from API (mirror advisor block pattern near advisor section — place Lean **near Advisor** so “second opinion” features cluster)
   - Mount `<LeanModeSettingsSection />` only; avoid large inline JSX

4. **API** — confirm existing web-settings GET/PATCH accepts nested `leanMode` without stripping (fix if a allow-list exists).

### Done when

- [ ] Toggle off by default in UI
- [ ] Enable + set Hard + disable reviewOnAgentEnd persists across reload
- [ ] Hard copy does not claim edit-tool blocking

---

## Phase 3 — Lean review pipeline (server)

**Goal:** `POST /api/lean-review` returns skipped or structured report.

### New files

1. **`lib/lean-review.ts`**  
   Responsibility: *Given session + cwd + intensity, collect bounded diff, run utility model, parse LeanReport or skip.*

   Suggested exports:

   ```ts
   export type LeanFindingKind =
     | "stacked_recovery" | "swallow_error" | "missing_owner"
     | "dual_path" | "file_bloat" | "patch_without_invariant";

   export type LeanReport = { /* schema from spec */ };

   export type LeanReviewResult = {
     skipped: boolean;
     reason?: string;
     report?: LeanReport;
     model?: string;
   };

   export async function runLeanReview(opts: {
     cwd: string;
     sessionId: string;
     intensity?: LeanIntensity;
     mode: "auto" | "manual";
   }): Promise<LeanReviewResult>;
   ```

2. **Diff collection (single helper inside lean-review or `lib/lean-diff.ts` if >80 lines)**
   - Prefer `git diff` / `git diff --stat` in `cwd` when `.git` exists (read-only bash via `execFile`, not shell string concat)
   - Cap raw diff ~14KB; if truncated set flag for prompt
   - If no git or empty diff → `skipped: true, reason: "no-diff"`
   - **v1 write detection:** empty diff ⇒ skip auto review (client may also skip call). Manual mode may still attempt and skip cleanly.
   - Optional later: tool-event “hadWrites” from client; do not invent a second server poller

3. **Model call**
   - Reuse `resolveUtilityModel` / `bindUtilityComplete` pattern from `lib/memory-review.ts`
   - Chain: smol → plan → default
   - System prompt = lean rubric (JSON only); user content = intensity + diff (+ truncated note)
   - One completion; no tool loop; no retries beyond model-resolve fallthrough

4. **Parse / filter**
   - Strip fences; brace-slice JSON
   - Validate enums; drop invalid findings
   - `review`: drop P3
   - `hard`: keep P3 up to max 5 findings; if `self_check` fields false, ensure ≥1 synthetic finding of `patch_without_invariant` when model omitted it
   - Dual-path: if body lacks two distinct path-ish tokens, drop finding (simple heuristic OK)

5. **`app/api/lean-review/route.ts`**
   - Mirror `app/api/advisor/route.ts` style: absolute `cwd`, `sessionId` required
   - Resolve effective lean via `resolveLeanMode(cwd)`
   - If `!enabled` → `{ skipped: true, reason: "disabled" }`
   - If intensity soft and mode auto → skip (`soft-no-auto`); manual may still run review for power users **or** skip both — **lock: soft never runs model** (manual button hidden when soft)
   - Call `runLeanReview`; never throw raw stacks to client

### Done when

- [ ] Disabled → skipped
- [ ] No git / clean tree → skipped silent
- [ ] Fixture diff with obvious double-fallback comment → `bloated` + finding (manual curl/test)
- [ ] Bad model JSON → skipped, not 500 spam

---

## Phase 4 — Client wiring + LeanReviewCard

**Goal:** auto review after edit turns; quiet when clean.

### New files

1. **`components/LeanReviewCard.tsx`**  
   Responsibility: *Render a lean review report (verdict + findings).*  
   Visual: reuse Advisor banner tokens (`--border`, `--destructive-*`, `--bg-subtle`); no raw hex.

2. **`hooks/useLeanReviewOnAgentEnd.ts`** (recommended)  
   Responsibility: *Fire lean-review fetch on agent end; expose report state + clear + manualRun.*

   Inputs: `enabled`, `intensity`, `reviewOnAgentEnd`, `cwd`, `sessionId`, `hadWritesHint?`  
   - Client-side prefilter: if intensity soft or !enabled → no-op  
   - If !reviewOnAgentEnd && auto → no-op  
   - Best-effort `hadWrites`: scan recent assistant toolCalls for edit/write names (same loop style as advisor tools list); if clearly read-only tools only, skip fetch  
   - `fetch("/api/lean-review", { sessionId, cwd, mode: "auto" })`  
   - Set report only when `!skipped && report.findings.length` (or verdict bloated)  
   - `.catch(() => {})` — no toast on network fail

### Wire

3. **`components/ChatWindow.tsx`**
   - Use hook inside `wrappedOnAgentEnd` **or** call `leanOnAgentEnd()` from the existing callback (keep net lines small)
   - Render card above advisor banner or below notices — only when report non-null
   - Clear report on new user send (avoid stale card)

4. **Manual entry (minimal v1)**  
   - Optional: small text button on the card area / session chrome when lean enabled && intensity ≠ soft  
   - If time-boxed, **defer manual button** to Phase 4b; auto path is required

### Done when

- [ ] Lean off: no fetch in network panel
- [ ] Lean review + clean edit: no card
- [ ] Lean review + smelly synthetic edit: card with kind + suggestion
- [ ] Soft: no auto fetch
- [ ] Hard: may show stricter findings for same diff
- [ ] No new SSE/poll/visibility for lean

---

## Phase 5 — Hardening, docs, dogfood

1. Update design open items that are now locked (project filename `.pi-web.json`).
2. Short user-facing note in Settings description only (no new marketing page required).
3. Dogfood: enable Lean Mode on Pi Web repo for one session; confirm policy inject + no AGENTS.md mutation (`grep` / mtime).
4. Typecheck: `node_modules/.bin/tsc --noEmit`  
   Lint touched files: `npm run lint` (do not `next build`).
5. Acceptance checklist from spec § Acceptance — tick all 8.

---

## Suggested PR slice order (independently shippable)

| PR | Phases | Risk |
|----|--------|------|
| **PR1** | 0 + 1 (settings + inject only) | Low — feature inert without UI if default off; still testable via JSON edit |
| **PR2** | 2 (Settings UI) | Low |
| **PR3** | 3 + 4 (review + card) | Medium — model cost / prompt quality |
| **PR4** | 5 polish + manual button if deferred | Low |

Prefer **PR1→PR2→PR3** over one megacommit so inject can ship even if review prompt needs iteration.

---

## Test matrix (manual)

| # | Setup | Action | Expect |
|---|--------|--------|--------|
| 1 | Default settings | New session, send message | No lean in system prompt; no `/api/lean-review` |
| 2 | `enabled=true`, soft | New session | Policy in system prompt; no lean-review on end |
| 3 | review + reviewOnAgentEnd | Edit a file cleanly | Request may run; UI silent if lean |
| 4 | review | Introduce stacked try/catch fallback in a patch | Finding card |
| 5 | hard | Same patch | ≥ review strictness; self_check pressure |
| 6 | reviewOnAgentEnd=false | Edit file | No auto request |
| 7 | Global off, `.pi-web.json` enabled | New session in that cwd | Policy on |
| 8 | Toggle off | New session | No policy |
| 9 | Enable lean | `stat ~/.pi/agent/AGENTS.md` before/after | Unchanged by lean feature |

---

## Risk register (implementation)

| Risk | Handling |
|------|----------|
| `appendSystemPromptOverride` only one callback | Compose memory + lean in one function (Phase 1) |
| ChatWindow/Settings size | Extract section + hook (guardrails above) |
| False positive reviews | Silent default; drop weak dual_path; cap findings |
| `git diff` includes unrelated dirty tree | v1 accept whole worktree diff; prompt says “focus on recent agent-shaped changes”; improve later with turn baseline if needed |
| Cost of double utility calls (advisor + lean) | Both opt-in; lean write-gated |

---

## Out of scope follow-ups (do not sneak into v1 PRs)

- Edit-tool `hardGates` net-line reject
- Persisting lean reports into session jsonl
- Per-project Settings UI editor
- Auto-enable when repo has AGENTS.md
- Merging declutter Phase 1 with Lean Mode

---

## Implementation start checklist

When coding begins:

1. Mark this plan’s Phase 0 in progress.
2. Open spec + this plan side-by-side.
3. First commit: types + defaults only (or PR1 full inject).
4. Answer AGENTS self-check on every PR.
5. Never run `next build` during dev.

**Ready to implement when user says go** — start at Phase 0.
