# Pi Web - Development Notes

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ──────────▶ running id poll    │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/route.ts          GET snapshot of currently-running session ids
  auth/all-providers/route.ts     GET API-key provider list
  auth/api-key/[provider]/route.ts GET/POST/DELETE provider API key status/storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth provider list
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/test/route.ts     POST test a configured model/provider
  memory-review/route.ts          POST { cwd, sessionId } — background memory review
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  worktrees/route.ts              GET/POST/DELETE git worktrees

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  markdown.ts          shared markdown helpers
  memory-review.ts     every-10th-turn utility-model transcript review → retainMemoryFact
  npx.ts               npx runner used by skill install
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  ensure-builtin-packages.ts  auto-install first-party pi packages into ~/.pi/agent
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  tool-presets.ts     FULL_TOOL_NAMES + getFullToolNames()
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Fork must destroy the wrapper immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `useAgentSession.handleAgentEvent()` (streaming).

### Chat scroll follow
Scroll follow is owned by the `use-stick-to-bottom` package (same as Hermes desktop) — `useAgentSession` creates it with `{ initial: "instant", resize: "instant" }` and exposes `stickToBottom` (= `isAtBottom`), `resumeStickToBottom`, `bindScrollContainer`, `chatContentRef`, `stopScroll`, `stickScrollToBottom`. The library handles at-bottom detection (70px threshold), escape on upward scroll/wheel only, and automatic re-attach when scrolling back down — do not write `scrollTop` from app code except the settle loop, the pagination restore, and the minimap, which are treated as user scrolls by design.

Cold-load performance (ChatWindow): first paint mounts `FIRST_PAINT_RENDER_ITEMS` (20) render items, then backfills to `VISIBLE_PAGE_SIZE` on the next rAF inside `startTransition`; a settle loop (`stopScroll()` + glue `scrollTop = scrollHeight` every rAF until height is stable 2 frames, 15-frame cap, then `scrollToBottom("instant")`) parks the transcript at the true bottom on the empty→non-empty flip, aborting if the user scrolls up mid-settle. `.chat-message-item` rows use `content-visibility: auto`, but the last `LIVE_TAIL_RENDER_ITEMS` (6) render items get `is-live` and are never virtualized — a still-growing row would be remembered at a stale height and drift the scroll lock.

### New session tools
Every session uses the full built-in tool set (`getFullToolNames()` → `toolNames[]` on `POST /api/agent/new` and `set_tools` on mount). When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` passes an empty tool allow-list and forces `agent.state.systemPrompt = ""` after startup/reload/resource discovery.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` preferring Pi Web **model roles** (`pi-web.json` → `modelRoles.default`) then `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions.

### Model roles / Git Review / project memory (Phase A)
- **Roles** (`default` / `smol` / `plan`) live in `~/.pi/agent/pi-web.json` via `lib/web-settings.ts` + Settings UI. Changing roles rewrites managed agent frontmatter (`Explore`/`Plan`/`Reviewer`) through `syncAgentModelsFromRoles()`.
- **Git Review**: `POST /api/git/review` builds a prompt; GitPanel starts a new session with the plan-role model and the managed `Reviewer` subagent. Assistant JSON is rendered by `ReviewSummaryCard`.
- **Edit (hashline-first)**: `createPiWebEditToolDefinition` prefers omp-style `{ input: "[path#TAG]\nSWAP…" }` (`lib/hashline-edit.ts`); classic `{ path, edits }` still works (strict then SDK fuzzy). Failures get kind/excerpt recovery (`lib/edit-failure.ts`).
- **LSP health**: catalog + PATH discovery in `lib/lsp-health.ts`; `GET /api/lsp?cwd=`; Settings → Tools; agent tool `lsp({ action })` (servers|hover|definition|references|rename) includes install hints. TS/JS keeps built-in service fallback.
- **GitHub thin layer**: `lib/github.ts` + agent tool `github` (gh CLI, read-only). Virtual paths `pr://N`, `pr://N/diff`, `issue://N` work via `read` and `github({ action:"read" })`. API: `GET/POST /api/github`.
- **Project memory**: project-only store under `~/.pi/agent/project-memory/<key>/facts.jsonl` with a hard char budget (`projectBudgetChars` default 4000; usage = Σ text.length + 20/fact). Overflow rejects with current entries + a consolidate instruction. `memory_retain` supports an atomic `operations[]` batch (add/replace/remove by unique substring, all-or-nothing); `memory_recall` searches project facts; `memory_reflect` is heuristic + optional utility-model synthesis. When auto-inject is on, top-K facts go into the system prompt via `appendSystemPromptOverride` in `startRpcSession`. Per-prompt, `send("prompt")` also recalls query-relevant facts (`buildQueryMemoryContext`, ≤800 chars, excluding facts already in the system top-K) as a hidden `memory-context` custom message (`sendCustomMessage(..., { deliverAs: "nextTurn" })`). `isMemoryContextMessage` keeps them out of the transcript. API: `POST /api/project-memory` with `{ action: "reflect" }`.
- **Background memory review** (`lib/memory-review.ts` + `POST /api/memory-review`): ChatWindow fires it fire-and-forget after every agent-end; a per-session counter (`globalThis.__piMemoryReviewTurnCounts`, resets on restart) runs the actual review only every 10th user turn. One utility-model JSON completion (smol → plan → default role chain) over the last ~10 transcript snippets (~6KB); validated facts are written via `retainMemoryFact` (secret guard / dedupe / budget are the safety net). Saved facts surface as a subtle info notice.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Running state polling + reconciliation
- The sidebar polls `GET /api/agent/running` while the tab is visible (avoids one long-lived SSE per multi-window tab). Server state still uses `subscribeRunningSessions()` in `lib/rpc-manager.ts`.
- `useAgentSession` treats per-session SSE as primary for chat events, but while a run is active it also reconciles via `GET /api/agent/[id]` on a slow interval and on `visibilitychange`/`online` (skipped while prompt settlement is already polling). This fixes missed `agent_end` events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.

### Built-in packages and skills
- First-party pi packages are auto-installed into `~/.pi/agent` on boot via `lib/ensure-builtin-packages.ts` (permission, subagents, todo, ask-user, better-compaction). TUI-only / unused packages (btw, markdown-preview, simplify, tool-display, rtk-optimizer) are pruned.
- Extension runtime UI (confirm/select/input/editor, widgets, status chips, custom panels) is handled by `rpc-manager` + `ChatWindow` — there is no user-facing package manager UI.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border --bg-subtle
--text --text-muted --text-dim
--accent --accent-hover --accent-fg --user-bg --assistant-bg --tool-bg
--success --destructive --ring
--success-bg --success-border --destructive-bg --destructive-border   (status tints)
--diff-add-bg --diff-del-bg --diff-hunk-bg                           (single diff recipe)
--overlay-bg --shadow-sm --shadow-md --shadow-lg                     (per-theme values)
--radius-xs(4) --radius-sm(6) --radius-md(8) --radius-lg(10) --radius-pill(999)
--font-mono
```

**Styling rules**: no raw hex/rgba colors or numeric borderRadius in components — use the tokens above.
Shared classes for common controls (defined at the end of globals.css):
`.btn-primary` (accent pill), `.btn-ghost` (bordered rect), `.btn-danger`,
`.icon-btn` (size via `--icon-btn-size`), `.input-base`, `.menu-card` (floating dropdown),
`.modal-backdrop`, `.modal-shell`.
Font-size scale: 11 micro labels / 12 tool+meta / 13 secondary UI / 14 body; code 12.5.
Uppercase micro-headers: `letterSpacing: 0.06em`; headings/labels use `fontWeight: 600` (not 650).
