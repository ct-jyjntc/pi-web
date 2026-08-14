# Presentation Layer Design — Host Cards, Transcript Nodes, Host Projections

**Date:** 2026-08-14  
**Status:** Approved (conversation) — pending spec review  
**Parent:** [`2026-08-02-declutter-design.md`](./2026-08-02-declutter-design.md)  
**Related:** [`AGENTS.md` § AI Coding Constraints](../../../AGENTS.md), [`2026-08-02-agent-run-lifecycle.md`](./2026-08-02-agent-run-lifecycle.md)

This is slice 1 of a three-slice “steal DSH contracts, keep the Pi SDK” program. Later slices (tool execute waterfall, durable inbox / surface-vs-human transcript) are **out of scope** and must not start in this change.

## Problem

The transcript and chrome reconstruct meaning that the host already knows:

- `ToolCallBlock` / `tool-run-meta.ts` classify tools with name regex (`isCardToolName`, `isEditToolName`, `runCategory`, `toolDisplayMeta`).
- `ChatWindow` builds a `RenderPlanItem` list with index keys, then special-cases a sidecar streaming bubble.
- Todos chrome has two sources: the live extension widget and `deriveTodoWidgetLines` (regex over the current turn).
- Token totals are walked from `messages` in `useAgentSession`; context pressure is already host-side.

DeepSeek Harness does this with three contracts we will copy as **types and owners**, not as Cordis: `presentCall`/`presentResult`, a conversation-node assembler, and host-folded projections.

## Product one-liner

**Renderer does not guess.** Tools declare a card. The transcript is an assembled node list. Todos / title / tokens / context pressure arrive as a host snapshot.

## Goals

1. One owner each for presentation, transcript assembly, and session chrome snapshots.
2. No jsonl schema change. `presentation` and `projections` exist only on the UI / RPC projection.
3. Same PR deletes the name-regex classifiers and the client todo/usage scans. Unknown and MCP tools use the default `generic` card — not a leftover heuristic.
4. No sixth agent-run recovery path. Projections ride existing `GET /api/sessions/[id]`, `GET .../context`, and `get_state`.
5. `ChatWindow.tsx` and `rpc-session-wrapper.ts` do not grow. Extract first, then swap.

## Non-goals

- Replacing `@earendil-works/pi` or the session jsonl tree.
- Durable inbox, crash-repair synthetic tool results, `request/header`, compaction surface-vs-human split.
- A `pre-execute → approval → execute → post` tool pipeline.
- Storing `ConversationNode[]` in `useAgentSession` instead of `messages[]`.
- A new SSE event type, poller, or `visibilitychange` listener.
- Client-side `present*()` for live args (rejected: dual-path).
- Sandbox, permission rewrite, or MCP per-tool registration.
- Visual redesign of Hermes scaffold / edit cards. Only the **classification source** changes.

## Architecture

```
jsonl / live AgentSession
        │
        ├─ attachPresentationToMessages()   session-entries + agent-event-wire
        ├─ foldProjections()                get_state + session GET + /context
        └─ messages + entryIds
                │
                ▼
        assembleTranscript()                renderer, pure, no SDK
                │
                ▼
        Transcript renders by node.kind
        session-metrics-store receives projections
```

| Owner | File | One-sentence responsibility |
|---|---|---|
| Tool presentation | `lib/tool-presentation.ts` | Card union, name→presenter registry, default `generic`, `attachPresentationToMessages` |
| Presenters | `lib/tool-presenters/*.ts` | Pure `presentCall` / `presentResult` per first-party tool name |
| Conversation nodes | `lib/conversation-nodes.ts` | `messages + entryIds + stream → ConversationNode[]` with stable ids |
| Session projections | `lib/session-projections.ts` | Fold `todos` / `title` / `tokenUsage` / `contextPressure` |
| Transcript UI | `components/conversation/Transcript.tsx` | Window the node list and dispatch renderers |

Presenters are SDK-free and import no `fs`. The renderer **does not import the registry**. It only reads `block.presentation` already attached on the heavy read/SSE path.

Light runtime: session **list** does not attach presentation or fold projections.

## Types

### Card

```ts
type ToolCardKind = "generic" | "terminal" | "diff" | "read" | "search" | "web" | "ask";

type ToolPresentation = {
  card: ToolCardKind;
  title: string;
  preview?: string;
  locations?: string[];
  hoist?: boolean;
  patch?: string;
  command?: string;
  query?: string;
};

type ToolPresenter = {
  presentCall(args: Record<string, unknown>): ToolPresentation;
  presentResult(
    args: Record<string, unknown>,
    result: { content: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean },
  ): ToolPresentation;
};
```

`ToolCallContent` gains an in-memory-only field:

```ts
presentation?: ToolPresentation;
```

jsonl stays `{ type, toolCallId, toolName, input }` (plus SDK on-disk aliases, still normalized by `lib/normalize.ts`).

### Presenter map (exact names)

| Tool name(s) | Module | `card` |
|---|---|---|
| `edit` | `tool-presenters/edit.ts` | `diff` (always; empty `patch` if missing) |
| `write` | `tool-presenters/write.ts` | `diff` when `details.patch`/`details.diff` exist, else `generic` |
| `read` | `tool-presenters/read.ts` | `read` |
| `bash` | `tool-presenters/bash.ts` | `terminal` |
| `grep`, `find`, `ls`, `glob` | `tool-presenters/explore.ts` | `search` |
| `web_fetch`, `web_search` | `tool-presenters/web.ts` | `web` |
| `ask_user_question` | `tool-presenters/ask.ts` | `ask` |
| `todo` | `tool-presenters/todo.ts` | `generic` + `hoist: true` |
| everything else (MCP, `lsp`, `github`, memory, debug, `subagent`, …) | `tool-presenters/default.ts` | `generic` |

Lookup is an exact `Record<string, ToolPresenter>`. No regex. Unknown name → default presenter.

`attachPresentationToMessages(messages)` builds a `toolCallId → toolResult` map, then writes `presentation` on every `toolCall` block (`presentResult` if a result exists, else `presentCall`). That function is the only place presenters run on a message list.

### Nodes

```ts
type ConversationNode =
  | { kind: "user"; id: string; idx: number }
  | {
      kind: "process";
      id: string;
      userIdx: number;
      finalAssistantIdx: number;
      processIndices: number[];
      processCount: number;
      hasAnswer: boolean;
      live?: boolean;
    }
  | { kind: "answer"; id: string; idx: number; message: AssistantMessage }
  | { kind: "compaction"; id: string; idx: number }
  | { kind: "custom"; id: string; idx: number }
  | { kind: "bash"; id: string; idx: number }
  | { kind: "stream"; id: string };
```

Id rules:

- Settled rows: `entry:${entryIds[idx]}` (process nodes use `entry:${entryIds[userIdx]}:process`).
- Live bubble: `stream:${promptRunId}`.
- Hidden context (`isHiddenContextMessage`) is omitted.

`assembleTranscript({ messages, entryIds, stream, promptRunId, busy })` owns today’s plan heuristics: `findFinalAssistantIndex`, live tail stays flat (no process grouping), process/answer split via `getFinalAssistantParts`. Those helpers move out of `ChatWindow` into `lib/conversation-nodes.ts` or stay imported from `chat-window-helpers.ts` if they remain display-pure.

`groupRunBlocks` groups consecutive tool calls whose `presentation.card` is not `diff` or `ask`. `hoist: true` is skipped. No name tests.

### Projections

```ts
type SessionProjections = {
  todos: TodoItem[] | null;
  title: string | null;
  tokenUsage: SessionStatsInfo;
  contextPressure: ContextUsage | null;
};
```

| Field | Fold |
|---|---|
| `todos` | If the todo in-memory store has this session id, use it. Else take `details.tasks` from the last `todo` `toolResult` after the last user message on the branch. No text regex. Empty → `null`. |
| `title` | Session header `name`, else `null`. |
| `tokenUsage` | Same counters `useAgentSession` walks today (`assistant.usage` + role counts). |
| `contextPressure` | Existing `resolveSessionContextUsage` (live) / `estimateSessionContextUsage` (cold). |

`foldProjections(input)` is the only fold. `get_state`, `GET /api/sessions/[id]`, and `GET /api/sessions/[id]/context` each include `projections`.

Chrome reads `projections.todos` from `session-metrics-store`. `todo-extension` may still `setWidget("rpiv-todos", formatTodoWidgetLines(items))` so other widget consumers do not break; ChatWindow / top bar **must not** parse widget lines or call `deriveTodoWidgetLines` to build the checklist. Widget text is a view, not a source.

## Data flow

### Cold load

1. Heavy `buildSessionContext` → `attachPresentationToMessages`.
2. Same handler → `foldProjections`.
3. `loadSession` sets `messages` (already presented) and writes projections into `session-metrics-store`.
4. `Transcript` calls `assembleTranscript` and windows nodes (`FIRST_PAINT_RENDER_ITEMS`, `VISIBLE_PAGE_SIZE`, `LIVE_TAIL_RENDER_ITEMS` unchanged).

### Live stream

1. `toClientAgentEvent` attaches presentation:
   - `toolcall_start`: `presentCall(name, {})` (args often empty).
   - `toolcall_end`: `presentCall(name, args)`.
   - outbound `toolResult` / `message_end` with a tool result: `presentResult`.
2. `agent-session-stream-state` copies `event.presentation` onto the matching `toolCall` block. It does not call `present*`.
3. `Transcript` appends `{ kind: "stream", id: "stream:${promptRunId}" }`.
4. Existing settle / `loadSession` rebase drops the stream node; historical nodes use entry ids.

`promptRunId` still gates late SSE. A stale event that happens to carry `presentation` is dropped like any other stale event.

### Live projections

No new SSE type. After todo mutations the next `get_state` (settle, existing reconcile, mid-stream reconnect) carries `projections.todos`. Until then the todo store + widget view may already show the list in-process; the **authoritative** client chrome snapshot is whatever last arrived as `projections`.

### Session switch, idle destroy, fork

- Wrapper gone: cold fold from disk `details.tasks`.
- Fork still destroys the wrapper in the same turn; the new session GET folds its own projections.
- `assembleTranscript` is pure and must not cache across session ids.

## Error handling

| Failure | Behavior |
|---|---|
| Unknown / MCP tool | Default `generic` (`title = toolName`, `preview` = first string arg if any). |
| `edit`/`write` missing patch | Still `card: "diff"` for `edit`; `write` without patch is `generic`. Card does not fall back to scaffold via name. |
| Presenter throws | `attachPresentationToMessages` / wire attach catch **that presenter only**, emit `generic` + `title = toolName`, `console.warn` once. Session GET stays 200. |
| Partial `toolcall_start` | `presentCall(name, {})`; `toolcall_end` overwrites. |
| `foldProjections` throws on one field | That field `null`; other fields still returned; GET 200. |
| Old in-memory messages without `presentation` | Treat as `generic` at render (`presentation?.card ?? "generic"`). Do not revive name regex. Desktop ships renderer + runtime together. |

Empty `catch` comments must name the invariant: “one presenter/fold must not fail the whole hydrate.”

## Deletions (same change set, not a later cleanup)

Remove after the new owners exist:

- `isCardToolName`, `isEditToolName`, `runCategory`, and name branches in `toolDisplayMeta`
- `deriveTodoWidgetLines`
- `useAgentSession` walk of `messages` used only to build chrome `SessionStatsInfo` (host `projections.tokenUsage` replaces it)
- `ChatWindow` plan `useMemo` once `assembleTranscript` is wired
- `getResultDiff` usage in `ToolCallBlock` — the edit/write presenter reads `details.patch` / `details.diff`; the block reads `presentation.patch`

Keep:

- `formatTodoWidgetLines` (widget view only)
- `lib/normalize.ts`
- Scroll exceptions documented in `AGENTS.md`
- Run lifecycle paths 1–5

## File plan

**New**

- `lib/tool-presentation.ts`
- `lib/tool-presenters/{edit,write,read,bash,explore,web,ask,todo,default,index}.ts`
- `lib/conversation-nodes.ts`
- `lib/session-projections.ts`
- `components/conversation/Transcript.tsx`

**Tests (new)**

- `lib/tool-presentation.test.mjs` — each mapped name → card/title/locations; unknown → generic; thrown presenter → generic
- `lib/conversation-nodes.test.mjs` — user+tools+answer → user/process/answer; live tail flat; hidden custom omitted; stream id; entry ids stable
- `lib/session-projections.test.mjs` — `details.tasks` without live store; no todo → null; usage sum; single-field fold failure → null field

**Existing tests to update**

- `lib/agent-event-wire` — `toolcall_end` includes `presentation`
- `lib/todo-from-transcript.test.mjs` — drop `deriveTodoWidgetLines` cases; keep format cases
- tool-run-meta / message-view tests — grouping by `card`

**Modified (call sites only; no logic piles)**

- `lib/types.ts` — optional `presentation`
- `lib/session-entries.ts` — attach after UI messages are built
- `lib/agent-event-wire.ts` — attach on toolcall start/end and tool results
- `lib/agent-session-stream-state.ts` — copy `presentation`
- `lib/rpc-session-wrapper.ts` — `get_state` adds `projections: foldProjections(...)` only
- `lib/agent-live-state.ts` / `lib/agent-session-live-apply.ts` — pass projections through
- `app/api/sessions/[id]/route.ts` and `.../context/route.ts` — include `projections`
- `hooks/useAgentSession.ts` — apply host tokenUsage; delete local chrome walk (net shrink)
- `components/ChatWindow.tsx` — render `Transcript`; delete plan/todo derive (net shrink)
- `components/message/tool-run-meta.ts` — group by card
- `components/message/blocks/ToolCallBlock.tsx` — switch on `presentation.card`
- `lib/todo-from-transcript.ts` — delete `deriveTodoWidgetLines`
- `AGENTS.md` file map — add the three owners; stop saying `rpc-manager.ts` owns the wrapper

Do not add a `globalThis.__pi*` bag.

## Implementation order (one spec, four committable steps)

1. **Extract:** move current plan + list from `ChatWindow` into `Transcript.tsx` with `RenderPlanItem` unchanged. Behavior freeze.
2. **Cards:** presenters + `attachPresentationToMessages` + wire attach + delete name classifiers + `ToolCallBlock` reads `presentation`.
3. **Nodes:** replace `RenderPlanItem` construction with `assembleTranscript`; stream becomes a node; keep pagination/scroll constants.
4. **Projections:** `foldProjections` on GET/`get_state`; delete client todo/usage scans.

Typecheck must pass after each step. The feature is not done until step 4 deletions are gone.

## Acceptance

Manual (existing chat smoke, no new recovery):

- Send a turn that uses read / bash / edit / ask / todo. Cards match the table. Todo appears in the top bar from `projections`, not from a transcript regex.
- Refresh mid-stream: stream node returns; after settle, entry ids replace `stream:${runId}`.
- Open an old session (no `presentation` on disk): cards still correct (attached on read).
- Fork: child transcript and projections do not show the parent’s todo store.
- Compact: compaction node still renders; no name-regex regressions.
- Unknown MCP tool: one generic scaffold row.

Automated: the three new test files plus updated wire/todo/grouping tests. `node_modules/.bin/tsc --noEmit` and `npm run lint` on touched files. `npm run smoke:ipc` only if an existing `get_state` fixture asserts an exact key set and turns red.

## Risk and rollback

- Step 1 is revert-safe (move only).
- Steps 2–4 do not change jsonl; revert is a renderer + heavy projection revert.
- If a presenter is wrong, the user sees a generic row, not a failed hydrate.
- Do not “fix” a missing card by restoring name regex.

## Self-check

1. **Invariant:** display intent is declared next to the tool; chrome snapshots are folded on the host; the renderer does not classify by tool name or scan the transcript for todos/tokens.
2. **Single owner:** `lib/tool-presentation.ts`, `lib/conversation-nodes.ts`, `lib/session-projections.ts`.
3. **Path count:** still SSE + settlement + grace + reconcile + `promptRunId` (5). Projections are payload on existing GETs.
4. **Size:** `ChatWindow` extracted before behavior change; wrapper gains one field assignment.
5. **Legacy:** no dual-path. Heuristics and `deriveTodoWidgetLines` are deleted in this change.

## Later slices (do not implement here)

- Slice 2: tool execute waterfall (`pre-execute` / approval / timeout / `post-execute`) in the heavy runtime.
- Slice 3: durable inbox splices, load-time tool-result repair, compaction surface vs human transcript — still on the Pi jsonl tree, not a DSH event log.
