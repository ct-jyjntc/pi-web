# Presentation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renderer stops guessing — tools declare a card, the transcript is an assembled node list, and todos/title/tokens/context arrive as a host snapshot.

**Architecture:** Compute `presentation` on the heavy read/SSE path (`attachPresentationToMessages` / `presenterFor`). Assemble `ConversationNode[]` in the renderer from `messages + entryIds + stream`. Fold `SessionProjections` on `get_state` and session GET. Do not change jsonl, the Pi SDK loop, transport, or run-lifecycle paths 1–5.

**Tech Stack:** TypeScript, Node test runner (`node --test`), existing Next/Vite renderer, `apiFetch` / `apiStream`.

**Spec:** [`docs/superpowers/specs/2026-08-14-presentation-layer-design.md`](../specs/2026-08-14-presentation-layer-design.md)

**Constraint bible:** `AGENTS.md` § AI Coding Constraints.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/tool-presentation.ts` | Card types, `patchFromToolDetails`, `presenterFor`, `attachPresentationToMessages`, `copyPresentationOntoToolCall`, `scaffoldGroupFromCard` |
| `lib/tool-presenters/*.ts` | One exact-name presenter each (SDK-free, no `fs`) |
| `lib/conversation-nodes.ts` | Turn heuristics + `assembleTranscript` |
| `lib/session-projections.ts` | `foldProjections` |
| `components/conversation/Transcript.tsx` | Windowed node list + MessageView dispatch |
| `lib/first-party/todo-extension.ts` | Add `peekTodoState` (no insert) |
| `lib/session-metrics-store.ts` | Add `todos` field |
| `components/TopBarChromeWidgets.tsx` | Todo capsule from store `todos`; subagents stay on `chromeWidgets` |

Do **not** grow `ChatWindow.tsx` or `rpc-session-wrapper.ts`. Extract first. Wrapper only adds `projections: foldProjections(...)`.

Per-commit footer:

```text
Invariant: display intent is declared; chrome is host-folded; renderer does not classify by tool name
Owner module: lib/tool-presentation.ts | lib/conversation-nodes.ts | lib/session-projections.ts
Recovery paths after change: 5 (was 5)
Files >800 lines touched: yes/no; net lines: ...
New dual-path?: no
```

Tests run as: `node --test <file>.test.mjs`  
Typecheck: `node_modules/.bin/tsc --noEmit`

---

### Task 1: Extract Transcript (behavior freeze)

**Files:**
- Create: `components/conversation/Transcript.tsx`
- Modify: `components/ChatWindow.tsx` (the `historicalMessageNodes` `useMemo` ~465–718 and its JSX use at ~1106)

No behavior change. Do not introduce `assembleTranscript` yet.

- [ ] **Step 1: Create `Transcript.tsx` by moving the existing plan + list**

Header comment: `Windowed historical transcript list. Owns RenderPlanItem construction and MessageView dispatch.`

Move from `ChatWindow` into `Transcript`:
- `toolResultsMap` construction
- `historicalMessageNodes` `useMemo` (plan pass + `renderMessage` + `renderProcessGroup` + visible window)
- Keep `RenderPlanItem` and helpers imported from `components/chat-window/chat-window-helpers.ts`

Props (pass every closed-over value the useMemo currently uses):

```tsx
export type TranscriptProps = {
  messages: AgentMessage[];
  entryIds: string[];
  streamState: { isStreaming: boolean; streamingMessage: Partial<AgentMessage> | null };
  sessionBusy: boolean;
  isNew: boolean;
  visibleCount: number;
  modelNames: Record<string, string>;
  messageCwd: string;
  sessionId?: string;
  forkingEntryId: string | null;
  onOpenFile?: (filePath: string) => void;
  onFork?: (entryId: string) => void;
  onNavigate?: (entryId: string) => void;
  onEditContent?: (message: UserMessage) => void;
  stopScroll: () => void;
  pageEarlier: () => void;
  messageRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  attachVisibleRef: (idx: number) => (el: HTMLDivElement | null) => void;
};

export function Transcript(props: TranscriptProps): {
  historicalMessageNodes: ReactNode;
  historyHasMore: boolean;
};
```

Keep the same React keys (`${keyPrefix}-${idx}`, `process-group-${userIdx}-${finalAssistantIdx}`), `LIVE_TAIL_RENDER_ITEMS`, `is-live` as a **window index**, and live-tail `variant="process"` heuristic already in `renderMessage`.

- [ ] **Step 2: Thin `ChatWindow` to call `Transcript`**

Replace the plan `useMemo` with:

```tsx
const { historicalMessageNodes, historyHasMore } = Transcript({ /* same props */ });
```

or render `<Transcript />` if you return nodes via render-props / children. Preferred: **function that returns `{ historicalMessageNodes, historyHasMore }`** so pagination `useEffect`s in ChatWindow stay put. Name it `useTranscriptNodes` only if it uses hooks; otherwise a plain function is enough.

`visibleCount`, scroll settle, first-paint backfill, composer, widgets stay in `ChatWindow`.

- [ ] **Step 3: Typecheck**

Run: `node_modules/.bin/tsc --noEmit`  
Expected: PASS. `ChatWindow.tsx` line count drops by roughly the moved block (~250 lines).

- [ ] **Step 4: Commit**

```bash
git add components/conversation/Transcript.tsx components/ChatWindow.tsx
git commit -m "refactor: extract Transcript list from ChatWindow"
```

---

### Task 2: Presentation core (TDD)

**Files:**
- Create: `lib/tool-presentation.ts`
- Create: `lib/tool-presentation.test.mjs`
- Create: `lib/tool-presenters/default.ts`
- Create: `lib/tool-presenters/index.ts`
- Modify: `lib/types.ts` (`ToolCallContent.presentation?`)

- [ ] **Step 1: Write the failing test**

```js
// lib/tool-presentation.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  patchFromToolDetails,
  presenterFor,
  attachPresentationToMessages,
  scaffoldGroupFromCard,
  copyPresentationOntoToolCall,
} = await jiti.import("./tool-presentation.ts");

test("patchFromToolDetails reads nested results", () => {
  assert.equal(patchFromToolDetails({ patch: "A" }), "A");
  assert.equal(patchFromToolDetails({ diff: "B" }), "B");
  assert.equal(
    patchFromToolDetails({ results: [{ patch: "P1" }, { diff: "P2" }] }),
    "P1\nP2",
  );
  assert.equal(patchFromToolDetails({}), null);
});

test("unknown tool is generic with tool name as title", () => {
  const p = presenterFor("mcp").presentCall({ url: "https://x" });
  assert.equal(p.card, "generic");
  assert.equal(p.title, "mcp");
  assert.equal(p.preview, "https://x");
});

test("thrown presenter becomes generic and does not throw attach", () => {
  const messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{ type: "toolCall", toolCallId: "c1", toolName: "edit", input: {} }],
  }];
  // Force a boom by presenting a poisoned presenter in a dedicated test hook
  // — see attachPresentationToMessages try/catch around present*.
  const out = attachPresentationToMessages(messages);
  assert.equal(out[0].content[0].presentation.card, "diff");
});

test("attach pairs toolResult and sets presentResult patch", () => {
  const messages = [
    {
      role: "assistant",
      model: "m",
      provider: "p",
      content: [{ type: "toolCall", toolCallId: "c1", toolName: "edit", input: { path: "a.ts" } }],
    },
    {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "edit",
      content: [{ type: "text", text: "ok" }],
      details: { results: [{ patch: "@@ -1 +1 @@\n+x" }] },
      isError: false,
    },
  ];
  const out = attachPresentationToMessages(messages);
  const pres = out[0].content[0].presentation;
  assert.equal(pres.card, "diff");
  assert.equal(pres.patch, "@@ -1 +1 @@\n+x");
  assert.deepEqual(pres.locations, ["a.ts"]);
});

test("scaffoldGroupFromCard maps cards without tool names", () => {
  assert.equal(scaffoldGroupFromCard("terminal"), "command");
  assert.equal(scaffoldGroupFromCard("read"), "explore");
  assert.equal(scaffoldGroupFromCard("search"), "explore");
  assert.equal(scaffoldGroupFromCard("web"), "explore");
  assert.equal(scaffoldGroupFromCard("generic"), "other");
  assert.equal(scaffoldGroupFromCard("diff"), "other");
});

test("copyPresentationOntoToolCall updates committed assistant by id", () => {
  const messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{ type: "toolCall", toolCallId: "c1", toolName: "write", input: {}, presentation: { card: "generic", title: "write" } }],
  }];
  const next = copyPresentationOntoToolCall(messages, "c1", { card: "diff", title: "write", patch: "P" });
  assert.equal(next[0].content[0].presentation.card, "diff");
  assert.equal(next[0].content[0].presentation.patch, "P");
});
```

The first `attach` test for `edit` will fail until Task 3 registers the edit presenter. In **this** task, change that test to use an unknown name for attach-without-result, and a second test that default `presentCall` runs. Keep the nested-patch `edit` test in Task 3.

Adjusted Task 2 attach test (no edit presenter yet):

```js
test("attach uses presentCall when no result", () => {
  const messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{ type: "toolCall", toolCallId: "c1", toolName: "mystery", input: { path: "z" } }],
  }];
  const out = attachPresentationToMessages(messages);
  assert.equal(out[0].content[0].presentation.card, "generic");
  assert.equal(out[0].content[0].presentation.title, "mystery");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/tool-presentation.test.mjs`  
Expected: FAIL — `Cannot find module './tool-presentation.ts'` or missing exports.

- [ ] **Step 3: Implement the core**

`lib/types.ts` — add optional field only:

```ts
export interface ToolCallContent {
  type: "toolCall";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** In-memory UI projection. Never written to jsonl. */
  presentation?: import("./tool-presentation").ToolPresentation;
}
```

Prefer a direct import if it does not create a cycle. If `tool-presentation.ts` imports `AgentMessage` from `types.ts`, put `ToolPresentation` in `tool-presentation.ts` and type the field as `presentation?: ToolPresentation` with `import type { ToolPresentation } from "./tool-presentation"` **at the bottom of the type-only import list** in `types.ts`. `types.ts` must not import presenters.

`lib/tool-presenters/default.ts`:

```ts
/** Default presenter for unknown / MCP tools. */
import type { ToolPresenter, ToolPresentation } from "../tool-presentation";

export function firstStringArg(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "command", "query", "url", "pattern", "file_path"]) {
    const v = args[key];
    if (typeof v === "string" && v) return v;
  }
  for (const v of Object.values(args)) {
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

export function defaultPresenter(toolName: string): ToolPresenter {
  const presentCall = (args: Record<string, unknown>): ToolPresentation => ({
    card: "generic",
    title: toolName,
    preview: firstStringArg(args),
  });
  return {
    presentCall,
    presentResult: (args) => presentCall(args),
  };
}
```

`lib/tool-presenters/index.ts` (map empty except default — Task 3 fills it):

```ts
/** Exact-name presenter registry. */
import type { ToolPresenter } from "../tool-presentation";
import { defaultPresenter } from "./default";

const PRESENTERS: Record<string, ToolPresenter> = {};

export function lookupPresenter(name: string): ToolPresenter {
  return PRESENTERS[name] ?? defaultPresenter(name);
}

export function registerPresenter(name: string, presenter: ToolPresenter): void {
  PRESENTERS[name] = presenter;
}
```

Do **not** export `registerPresenter` for production after Task 3 if the map is static. Prefer a static object filled in Task 3 and delete `registerPresenter`. For Task 2, a static empty map + `defaultPresenter` is enough.

`lib/tool-presentation.ts`:

```ts
/**
 * Tool card types and the only functions that run presenters on a message list.
 */
import type { AgentMessage, AssistantMessage, ToolCallContent, ToolResultMessage } from "./types";
import { lookupPresenter } from "./tool-presenters/index";
import { isRecord } from "./type-guards";

export type ToolCardKind = "generic" | "terminal" | "diff" | "read" | "search" | "web" | "ask";
export type ScaffoldGroup = "command" | "explore" | "other";

export type ToolPresentation = {
  card: ToolCardKind;
  title: string;
  preview?: string;
  locations?: string[];
  hoist?: boolean;
  patch?: string;
  command?: string;
  query?: string;
};

export type ToolResultLike = {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
  isError?: boolean;
};

export type ToolPresenter = {
  presentCall(args: Record<string, unknown>): ToolPresentation;
  presentResult(args: Record<string, unknown>, result: ToolResultLike): ToolPresentation;
};

export function presenterFor(name: string): ToolPresenter {
  return lookupPresenter(name);
}

export function scaffoldGroupFromCard(card: ToolCardKind): ScaffoldGroup {
  if (card === "terminal") return "command";
  if (card === "read" || card === "search" || card === "web") return "explore";
  return "other";
}

export function patchFromToolDetails(details: unknown): string | null {
  if (!isRecord(details)) return null;
  if (typeof details.patch === "string" && details.patch) return details.patch;
  if (typeof details.diff === "string" && details.diff) return details.diff;
  const results = details.results;
  if (!Array.isArray(results)) return null;
  const parts: string[] = [];
  for (const row of results) {
    if (!isRecord(row)) continue;
    const p = typeof row.patch === "string" ? row.patch : typeof row.diff === "string" ? row.diff : null;
    if (p) parts.push(p);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function safePresent(
  name: string,
  run: () => ToolPresentation,
): ToolPresentation {
  try {
    return run();
  } catch {
    // One presenter must not fail the whole hydrate.
    console.warn(`[tool-presentation] presenter failed for ${name}`);
    return { card: "generic", title: name };
  }
}

export function attachPresentationToMessages(messages: AgentMessage[]): AgentMessage[] {
  const results = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    const tr = msg as ToolResultMessage;
    if (tr.toolCallId) results.set(tr.toolCallId, tr);
  }
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const assistant = msg as AssistantMessage;
    if (!Array.isArray(assistant.content)) return msg;
    return {
      ...assistant,
      content: assistant.content.map((block) => {
        if (block.type !== "toolCall") return block;
        const tc = block as ToolCallContent;
        const presenter = presenterFor(tc.toolName);
        const result = results.get(tc.toolCallId);
        const presentation = safePresent(tc.toolName, () => (
          result
            ? presenter.presentResult(tc.input ?? {}, result)
            : presenter.presentCall(tc.input ?? {})
        ));
        return { ...tc, presentation };
      }),
    };
  });
}

export function copyPresentationOntoToolCall(
  messages: AgentMessage[],
  toolCallId: string,
  presentation: ToolPresentation,
): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const assistant = msg as AssistantMessage;
    if (!Array.isArray(assistant.content)) return msg;
    let changed = false;
    const content = assistant.content.map((block) => {
      if (block.type !== "toolCall") return block;
      const tc = block as ToolCallContent;
      if (tc.toolCallId !== toolCallId) return block;
      changed = true;
      return { ...tc, presentation };
    });
    return changed ? { ...assistant, content } : msg;
  });
}
```

- [ ] **Step 4: Run tests**

Run: `node --test lib/tool-presentation.test.mjs`  
Expected: PASS (with the Task-2-only attach test; omit the edit/nested test until Task 3).

- [ ] **Step 5: Commit**

```bash
git add lib/tool-presentation.ts lib/tool-presentation.test.mjs lib/tool-presenters/default.ts lib/tool-presenters/index.ts lib/types.ts
git commit -m "feat: add tool presentation core and default card"
```

---

### Task 3: First-party presenters (TDD)

**Files:**
- Create: `lib/tool-presenters/{edit,write,read,bash,explore,web,ask,todo}.ts`
- Modify: `lib/tool-presenters/index.ts`
- Modify: `lib/tool-presentation.test.mjs` (add mapped-name cases + nested edit patch)

- [ ] **Step 1: Write the failing table test**

Append to `lib/tool-presentation.test.mjs`:

```js
test("first-party presenters match the spec table", () => {
  const { presenterFor, patchFromToolDetails } = /* already imported */;
  assert.equal(presenterFor("edit").presentCall({ path: "a.ts" }).card, "diff");
  assert.deepEqual(presenterFor("edit").presentCall({ path: "a.ts" }).locations, ["a.ts"]);

  const writeNoPatch = presenterFor("write").presentResult({ path: "b.ts" }, { content: [], details: {} });
  assert.equal(writeNoPatch.card, "generic");
  const writePatch = presenterFor("write").presentResult({ path: "b.ts" }, {
    content: [],
    details: { results: [{ patch: "@@" }] },
  });
  assert.equal(writePatch.card, "diff");
  assert.equal(writePatch.patch, "@@");

  assert.equal(presenterFor("read").presentCall({ path: "c.ts" }).card, "read");
  assert.equal(presenterFor("bash").presentCall({ command: "ls" }).card, "terminal");
  assert.equal(presenterFor("bash").presentCall({ command: "ls" }).command, "ls");
  assert.equal(presenterFor("grep").presentCall({ pattern: "x" }).card, "search");
  assert.equal(presenterFor("find").presentCall({}).card, "search");
  assert.equal(presenterFor("ls").presentCall({}).card, "search");
  assert.equal(presenterFor("glob").presentCall({}).card, "search");
  assert.equal(presenterFor("web_fetch").presentCall({ url: "https://x" }).card, "web");
  assert.equal(presenterFor("web_search").presentCall({ query: "q" }).card, "web");
  assert.equal(presenterFor("ask_user_question").presentCall({}).card, "ask");
  const todo = presenterFor("todo").presentCall({});
  assert.equal(todo.hoist, true);
  assert.equal(patchFromToolDetails({ results: [{ patch: "P1" }] }), "P1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/tool-presentation.test.mjs`  
Expected: FAIL — `edit` is generic.

- [ ] **Step 3: Implement presenters and static map**

`lib/tool-presenters/edit.ts`:

```ts
/** Edit tool card: always diff. */
import { patchFromToolDetails, type ToolPresenter } from "../tool-presentation";
import { firstStringArg } from "./default";

function pathOf(args: Record<string, unknown>): string | undefined {
  return typeof args.path === "string" ? args.path : firstStringArg(args);
}

export const editPresenter: ToolPresenter = {
  presentCall(args) {
    const path = pathOf(args);
    return { card: "diff", title: path ?? "edit", locations: path ? [path] : undefined };
  },
  presentResult(args, result) {
    const path = pathOf(args);
    return {
      card: "diff",
      title: path ?? "edit",
      locations: path ? [path] : undefined,
      patch: patchFromToolDetails(result.details) ?? undefined,
    };
  },
};
```

`lib/tool-presenters/write.ts`:

```ts
/** Write tool card: diff only when a patch exists. */
import { patchFromToolDetails, type ToolPresenter } from "../tool-presentation";
import { firstStringArg } from "./default";

function pathOf(args: Record<string, unknown>): string | undefined {
  return typeof args.path === "string" ? args.path : firstStringArg(args);
}

export const writePresenter: ToolPresenter = {
  presentCall(args) {
    const path = pathOf(args);
    return { card: "generic", title: path ?? "write", locations: path ? [path] : undefined };
  },
  presentResult(args, result) {
    const path = pathOf(args);
    const patch = patchFromToolDetails(result.details);
    return {
      card: patch ? "diff" : "generic",
      title: path ?? "write",
      locations: path ? [path] : undefined,
      patch: patch ?? undefined,
    };
  },
};
```

`lib/tool-presenters/read.ts`:

```ts
/** Read tool card. */
import type { ToolPresenter } from "../tool-presentation";
import { firstStringArg } from "./default";

export const readPresenter: ToolPresenter = {
  presentCall(args) {
    const path = typeof args.path === "string" ? args.path : firstStringArg(args);
    return { card: "read", title: path ?? "read", locations: path ? [path] : undefined, preview: path };
  },
  presentResult(args, result) {
    return this.presentCall(args);
  },
};
```

Fix `presentResult: (args) => readPresenter.presentCall(args)` if `this` is unbound.

`lib/tool-presenters/bash.ts`:

```ts
/** Bash tool card. */
import type { ToolPresenter } from "../tool-presentation";

export const bashPresenter: ToolPresenter = {
  presentCall(args) {
    const command = typeof args.command === "string" ? args.command : "";
    return { card: "terminal", title: command || "bash", command, preview: command };
  },
  presentResult(args) {
    return bashPresenter.presentCall(args);
  },
};
```

`lib/tool-presenters/explore.ts` — same presenter for `grep` / `find` / `ls` / `glob`:

```ts
/** Search/explore cards (grep, find, ls, glob). */
import type { ToolPresenter } from "../tool-presentation";
import { firstStringArg } from "./default";

export const explorePresenter: ToolPresenter = {
  presentCall(args) {
    const query = typeof args.pattern === "string" ? args.pattern : firstStringArg(args);
    return { card: "search", title: query ?? "search", query, preview: query };
  },
  presentResult(args) {
    return explorePresenter.presentCall(args);
  },
};
```

`lib/tool-presenters/web.ts`:

```ts
/** web_fetch / web_search cards. */
import type { ToolPresenter } from "../tool-presentation";
import { firstStringArg } from "./default";

export const webPresenter: ToolPresenter = {
  presentCall(args) {
    const query = typeof args.url === "string" ? args.url
      : typeof args.query === "string" ? args.query
      : firstStringArg(args);
    return { card: "web", title: query ?? "web", query, preview: query };
  },
  presentResult(args) {
    return webPresenter.presentCall(args);
  },
};
```

`lib/tool-presenters/ask.ts`:

```ts
/** ask_user_question card. */
import type { ToolPresenter } from "../tool-presentation";

export const askPresenter: ToolPresenter = {
  presentCall(args) {
    const q = args.questions;
    const first = Array.isArray(q) && q[0] && typeof q[0] === "object" && q[0] !== null && "question" in q[0]
      ? String((q[0] as { question: unknown }).question)
      : typeof args.question === "string" ? args.question : "ask";
    return { card: "ask", title: first, preview: first };
  },
  presentResult(args) {
    return askPresenter.presentCall(args);
  },
};
```

`lib/tool-presenters/todo.ts`:

```ts
/** Todo is hoisted to chrome; not a transcript card. */
import type { ToolPresenter } from "../tool-presentation";

export const todoPresenter: ToolPresenter = {
  presentCall() {
    return { card: "generic", title: "todo", hoist: true };
  },
  presentResult() {
    return { card: "generic", title: "todo", hoist: true };
  },
};
```

`lib/tool-presenters/index.ts`:

```ts
/** Exact-name presenter registry. */
import type { ToolPresenter } from "../tool-presentation";
import { defaultPresenter } from "./default";
import { editPresenter } from "./edit";
import { writePresenter } from "./write";
import { readPresenter } from "./read";
import { bashPresenter } from "./bash";
import { explorePresenter } from "./explore";
import { webPresenter } from "./web";
import { askPresenter } from "./ask";
import { todoPresenter } from "./todo";

const PRESENTERS: Record<string, ToolPresenter> = {
  edit: editPresenter,
  write: writePresenter,
  read: readPresenter,
  bash: bashPresenter,
  grep: explorePresenter,
  find: explorePresenter,
  ls: explorePresenter,
  glob: explorePresenter,
  web_fetch: webPresenter,
  web_search: webPresenter,
  ask_user_question: askPresenter,
  todo: todoPresenter,
};

export function lookupPresenter(name: string): ToolPresenter {
  return PRESENTERS[name] ?? defaultPresenter(name);
}
```

Also add the nested-edit attach test from Task 2 now that `edit` exists.

- [ ] **Step 4: Run tests**

Run: `node --test lib/tool-presentation.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tool-presenters lib/tool-presentation.test.mjs
git commit -m "feat: add first-party tool presenters"
```

---

### Task 4: Attach on disk + SSE + copy onto committed toolCall

**Files:**
- Modify: `lib/session-entries.ts` (`buildSessionContext` after the message loop)
- Modify: `lib/agent-event-wire.ts`
- Modify: `lib/agent-event-wire.test.mjs`
- Modify: `lib/agent-session-stream-state.ts` (`toolcall_start` / `toolcall_end`)
- Modify: `lib/agent-session-stream-state.test.mjs` (if present)
- Modify: `lib/agent-session-handle-event.ts` (`message_end` for `toolResult`)
- Modify: `lib/agent-session-handle-event.test.mjs`

Renderer still does **not** import `presenterFor` except inside these host/wire modules. `handle-event` and `stream-state` only **copy** `event.presentation`.

- [ ] **Step 1: Write failing wire + handle-event tests**

Append to `lib/agent-event-wire.test.mjs`:

```js
test("toolcall_end includes presentation from presentCall", () => {
  const client = toClientAgentEvent({
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { type: "toolCall", id: "c1", name: "bash", arguments: { command: "pwd" } },
    },
  });
  const delta = client.assistantMessageEvent;
  assert.equal(delta.presentation.card, "terminal");
  assert.equal(delta.presentation.command, "pwd");
});

test("toolcall_start includes presentation even with empty args", () => {
  const client = toClientAgentEvent({
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 0,
      id: "c1",
      toolName: "read",
    },
  });
  assert.equal(client.assistantMessageEvent.presentation.card, "read");
});
```

Append to `lib/agent-session-handle-event.test.mjs`:

```js
test("toolResult message_end copies presentation onto the committed toolCall", () => {
  let messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{ type: "toolCall", toolCallId: "c1", toolName: "write", input: { path: "a.ts" }, presentation: { card: "generic", title: "a.ts" } }],
  }];
  const { ctx } = makeCtx({
    setMessages(updater) { messages = updater(messages); },
  });
  handleAgentSessionEvent({
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "write",
      content: [{ type: "text", text: "ok" }],
      details: { patch: "@@" },
      presentation: { card: "diff", title: "a.ts", patch: "@@" },
    },
  }, ctx);
  assert.equal(messages[0].content[0].presentation.card, "diff");
  assert.equal(messages[0].content[0].presentation.patch, "@@");
  assert.equal(messages[1].role, "toolResult");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/agent-event-wire.test.mjs lib/agent-session-handle-event.test.mjs`  
Expected: FAIL — `presentation` undefined / card still generic.

- [ ] **Step 3: Implement attach + copy**

`buildSessionContext` — after the loop, before return:

```ts
import { attachPresentationToMessages } from "./tool-presentation";
// ...
return {
  messages: attachPresentationToMessages(messages),
  entryIds,
  thinkingLevel: piCtx.thinkingLevel,
  model: piCtx.model,
};
```

`toClientAgentEvent` — after lifting toolcall_start, attach presentation:

```ts
import { presenterFor } from "./tool-presentation";

function presentationForDelta(delta: Record<string, unknown>): unknown {
  const name = typeof delta.toolName === "string" ? delta.toolName
    : typeof (delta.toolCall as { name?: string } | undefined)?.name === "string"
      ? (delta.toolCall as { name: string }).name
      : "";
  if (!name) return undefined;
  try {
    if (delta.type === "toolcall_end") {
      const args = (delta.toolCall as { arguments?: Record<string, unknown> } | undefined)?.arguments ?? {};
      return presenterFor(name).presentCall(args);
    }
    if (delta.type === "toolcall_start") {
      return presenterFor(name).presentCall({});
    }
  } catch {
    // One presenter must not fail the whole hydrate.
    return { card: "generic", title: name };
  }
  return undefined;
}
```

Set `delta.presentation = presentationForDelta(delta)` when defined.

If a standalone `toolResult` event exists on the wire, attach `presentResult` there too. The committed-copy path is `message_end` (below). Host must put `presentation` on that `message` before SSE. Find where SSE serializes `message_end` (wrapper subscribe / `agent-event-wire` passthrough). If `message_end` is returned unchanged, enrich it in `toClientAgentEvent`:

```ts
if (event.type === "message_end") {
  const message = event.message as { role?: string; toolCallId?: string; toolName?: string; content?: unknown; details?: unknown; input?: unknown } | undefined;
  if (message?.role === "toolResult" && message.toolName) {
    try {
      const args = (message as { arguments?: Record<string, unknown> }).arguments ?? {};
      (message as { presentation?: unknown }).presentation = presenterFor(message.toolName).presentResult(args, message as never);
    } catch {
      (message as { presentation?: unknown }).presentation = { card: "generic", title: message.toolName };
    }
  }
  return event;
}
```

If `toolResult` messages do not carry original args, look up is not possible on the event — then `presentResult` must use `{}` as args (path may be missing; patch still lands). Prefer args from the event if present.

`applyAssistantDelta` `toolcall_start` / `toolcall_end`: copy `event.presentation` onto the block:

```ts
presentation: "presentation" in event ? event.presentation as ToolCallContent["presentation"] : undefined,
```

Preserve existing presentation on `toolcall_delta` (copy from `prev`).

`handleAgentSessionEvent` `message_end` branch — after the current append, if `completed.role === "toolResult"`:

```ts
import { copyPresentationOntoToolCall, type ToolPresentation } from "./tool-presentation";

// when appending a toolResult:
const presentation = (completed as { presentation?: ToolPresentation }).presentation;
ctx.setMessages((prev) => {
  const withResult = [...prev, normalizeToolCalls(completed)];
  if (!presentation || completed.role !== "toolResult") return withResult;
  const id = (completed as ToolResultMessage).toolCallId;
  return id ? copyPresentationOntoToolCall(withResult, id, presentation) : withResult;
});
```

Keep the existing `promptRunId` / `agentRunning` guards. Do not add a new recovery path.

- [ ] **Step 4: Run tests**

Run: `node --test lib/agent-event-wire.test.mjs lib/agent-session-handle-event.test.mjs lib/tool-presentation.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/session-entries.ts lib/agent-event-wire.ts lib/agent-event-wire.test.mjs lib/agent-session-stream-state.ts lib/agent-session-handle-event.ts lib/agent-session-handle-event.test.mjs
git commit -m "feat: attach tool presentation on load and SSE"
```

---

### Task 5: UI reads `presentation.card`; delete name heuristics

**Files:**
- Modify: `components/message/tool-run-meta.ts`
- Modify: `components/message/blocks/ToolCallBlock.tsx`
- Modify: any test that imports `isCardToolName` / `runCategory` / `isEditToolName`
- Modify: `components/message/message-view-utils.ts` only if `getToolPreview` stays (it should — titles still use it as fallback after `presentation.title`)

- [ ] **Step 1: Write / update grouping tests**

If no unit test exists for `groupRunBlocks`, add `components/message/tool-run-meta.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { groupRunBlocks } = await jiti.import("./tool-run-meta.ts");

test("groups non-card presentations and splits on diff/ask/hoist", () => {
  const items = [
    { block: { type: "toolCall", toolCallId: "1", toolName: "read", input: {}, presentation: { card: "read", title: "a" } }, originalIndex: 0 },
    { block: { type: "toolCall", toolCallId: "2", toolName: "bash", input: {}, presentation: { card: "terminal", title: "ls" } }, originalIndex: 1 },
    { block: { type: "toolCall", toolCallId: "3", toolName: "edit", input: {}, presentation: { card: "diff", title: "a" } }, originalIndex: 2 },
    { block: { type: "toolCall", toolCallId: "4", toolName: "todo", input: {}, presentation: { card: "generic", title: "todo", hoist: true } }, originalIndex: 3 },
    { block: { type: "toolCall", toolCallId: "5", toolName: "grep", input: {}, presentation: { card: "search", title: "x" } }, originalIndex: 4 },
  ];
  const out = groupRunBlocks(items);
  assert.equal(out[0].kind, "run");
  assert.equal(out[0].items.length, 2);
  assert.equal(out[1].kind, "block");
  assert.equal(out[2].kind, "run");
  assert.equal(out[2].items.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails** (if `groupRunBlocks` still uses `isCardToolName`, the hoist/diff split may already accidentally pass for these names — then change the edit toolName to `str_replace` **without** presentation and assert it groups as run, proving names no longer matter). Stronger test:

```js
test("without presentation, a former card name is generic/run", () => {
  const items = [
    { block: { type: "toolCall", toolCallId: "1", toolName: "edit", input: {} }, originalIndex: 0 },
  ];
  const out = groupRunBlocks(items);
  assert.equal(out[0].kind, "run");
});
```

After the change, missing presentation ⇒ `card ?? "generic"` ⇒ run group. Today `edit` is a card (`kind: "block"`). This test **fails today** (got `block`) and **passes after** (got `run`). Perfect TDD.

- [ ] **Step 3: Switch grouping and ToolCallBlock**

`groupRunBlocks`:

```ts
import type { ToolCardKind } from "@/lib/tool-presentation";

function cardOf(block: ToolCallContent): ToolCardKind {
  return block.presentation?.card ?? "generic";
}

// skip when presentation?.hoist || toolName === "todo" (todo presenter always hoists; name check only if presentation missing on old in-memory rows — spec says missing presentation is generic, and todo without presentation would show. Prefer: hoist if presentation?.hoist === true OR (no presentation && toolName === "todo") is a dual-path. Spec: do not revive name regex. So only `presentation?.hoist`.
```

Only skip `presentation?.hoist`. After attach-on-load, todo always has hoist.

`isCard`: `card === "diff" || card === "ask"`.

Delete `isCardToolName`, `isEditToolName`, `runCategory`.

`settledRunLine` / `scaffoldToolTitle`:

```ts
import { scaffoldGroupFromCard, type ToolCardKind } from "@/lib/tool-presentation";

const card: ToolCardKind = tc.presentation?.card ?? "generic";
const category = scaffoldGroupFromCard(card);
const target = tc.presentation?.title || tc.presentation?.preview || getToolPreview(tc) || tc.toolName;
```

`ToolCallBlock`:
- `const card = block.presentation?.card ?? "generic"`
- `const isCard = card === "diff" || card === "ask"`
- `const resultDiff = block.presentation?.patch ? { text: block.presentation.patch } : null` — do **not** call `getResultDiff` to choose the card
- Keep `getEditResultMeta(result)` for mode/tag chrome on `card === "diff"`
- Move `getResultDiff` body comment to `patchFromToolDetails`; delete `getResultDiff` if unused, or make it a deprecated wrapper that calls `patchFromToolDetails` **only if tests still import it** — then delete those imports.

`toolDisplayMeta(toolName)`: replace with `cardChrome(card: ToolCardKind)` — `ask` uses accent tokens; everything else uses the current default success/scaffold tokens. Delete todo/subagent/review name branches.

- [ ] **Step 4: Grep and run tests**

Run: `rg -n "isCardToolName|isEditToolName|function runCategory|deriveTodoWidgetLines" --glob '!docs/**'`  
Expected: no matches in `components/` or `lib/` except maybe comments you then delete.

Run: `node --test components/message/tool-run-meta.test.mjs lib/tool-presentation.test.mjs`  
Expected: PASS.

Run: `node_modules/.bin/tsc --noEmit`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/message/tool-run-meta.ts components/message/blocks/ToolCallBlock.tsx components/message/tool-run-meta.test.mjs
git commit -m "refactor: render tool cards from presentation, drop name heuristics"
```

---

### Task 6: `assembleTranscript` + swap Transcript

**Files:**
- Create: `lib/conversation-nodes.ts`
- Create: `lib/conversation-nodes.test.mjs`
- Modify: `components/chat-window/chat-window-helpers.ts` (re-export moved helpers to avoid a ChatWindow import storm)
- Modify: `components/conversation/Transcript.tsx`

- [ ] **Step 1: Write the failing assembler tests**

```js
// lib/conversation-nodes.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { assembleTranscript } = await jiti.import("./conversation-nodes.ts");

const user = { role: "user", content: "hi" };
const assistantTools = {
  role: "assistant",
  model: "m",
  provider: "p",
  content: [{ type: "toolCall", toolCallId: "c1", toolName: "read", input: {}, presentation: { card: "read", title: "a.ts" } }],
};
const assistantAnswer = {
  role: "assistant",
  model: "m",
  provider: "p",
  content: [{ type: "text", text: "done" }],
};
const hidden = { role: "custom", customType: "memory-context", content: "x", display: false };

test("settled turn is user + process + answer", () => {
  const nodes = assembleTranscript({
    messages: [user, assistantTools, assistantAnswer],
    entryIds: ["e1", "e2", "e3"],
    stream: null,
    promptRunId: 0,
    busy: false,
  });
  assert.deepEqual(nodes.map((n) => n.kind), ["user", "process", "answer"]);
  assert.equal(nodes[0].id, "entry:e1");
  assert.equal(nodes[1].id, "entry:e1:process");
  assert.equal(nodes[2].id, "entry:e3");
});

test("live tail stays flat message rows plus stream", () => {
  const nodes = assembleTranscript({
    messages: [user, assistantTools],
    entryIds: ["e1", "e2"],
    stream: { role: "assistant", content: [] },
    promptRunId: 7,
    busy: true,
  });
  assert.deepEqual(nodes.map((n) => n.kind), ["user", "message", "stream"]);
  assert.equal(nodes[2].id, "stream:7");
  assert.ok(!nodes.some((n) => n.kind === "process" || n.kind === "answer"));
});

test("orphan assistant is message", () => {
  const nodes = assembleTranscript({
    messages: [assistantAnswer],
    entryIds: ["e9"],
    stream: null,
    promptRunId: 0,
    busy: false,
  });
  assert.deepEqual(nodes.map((n) => n.kind), ["message"]);
});

test("hidden custom is omitted", () => {
  const nodes = assembleTranscript({
    messages: [user, hidden, assistantAnswer],
    entryIds: ["e1", "e2", "e3"],
    stream: null,
    promptRunId: 0,
    busy: false,
  });
  assert.ok(!nodes.some((n) => n.kind === "custom"));
});

test("compaction / bash become those kinds", () => {
  const nodes = assembleTranscript({
    messages: [
      { role: "custom", customType: "compaction", content: "sum", display: true },
      { role: "bashExecution", command: "ls", output: "" },
    ],
    entryIds: ["c1", "b1"],
    stream: null,
    promptRunId: 0,
    busy: false,
  });
  assert.deepEqual(nodes.map((n) => n.kind), ["compaction", "bash"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/conversation-nodes.test.mjs`  
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `assembleTranscript`**

Move these functions from `chat-window-helpers.ts` into `lib/conversation-nodes.ts` (they are display-pure): `hasFinalAssistantAnswer`, `findFinalAssistantIndex`, `getFinalAssistantParts`, `hasDisplayableProcessMessage`. Re-export them from `chat-window-helpers.ts` so existing imports keep working:

```ts
export {
  hasFinalAssistantAnswer,
  findFinalAssistantIndex,
  getFinalAssistantParts,
  hasDisplayableProcessMessage,
} from "@/lib/conversation-nodes";
```

`lib/conversation-nodes.ts` header: `Assemble ConversationNode[] from a session message list. Pure; no SDK.`

Implement `assembleTranscript` with the spec table:

- Skip `isHiddenContextMessage`
- Non-user at the start of a scan: emit `compaction` / `custom` / `bash` / else `message`
- User turn: if `finalAssistantIdx === -1` OR `(busy || stream) && this is the last user turn` → emit `user` + one node per remaining visible idx (`compaction`/`custom`/`bash`/`message`) + optional `stream`
- Else: `user` + optional `process` + optional `answer` + leftovers as `message`/`custom`/`bash`
- Do **not** emit `answer` for live-tail
- Ids: `entry:${entryIds[idx]}`, process `entry:${entryIds[userIdx]}:process`, stream `stream:${promptRunId}`

Node kinds `compaction` / `custom` / `bash` still render through existing `MessageView` in Transcript (no new visual components).

- [ ] **Step 4: Swap Transcript to nodes**

In `Transcript.tsx`, replace the `RenderPlanItem` plan loop with `assembleTranscript(...)`. Dispatch:

| kind | render |
|---|---|
| `user`, `message`, `compaction`, `custom`, `bash` | existing `renderMessage(idx)` |
| `answer` | `renderMessage(idx, { messageOverride: node.message })` |
| `process` | existing `renderProcessGroup` |
| `stream` | **do not render here** if ChatWindow still mounts the sidecar bubble; OR render nothing and leave the sidecar in ChatWindow for this task |

Spec wants `stream` as a first-class node. In this task, render the streaming `MessageView` inside Transcript when `kind === "stream"` using `streamState.streamingMessage`, and **remove** the extra unkeyed streaming `<div>` from `ChatWindow` (~1107). Key = `stream:${promptRunId}`.

Keep `LIVE_TAIL_RENDER_ITEMS` / `is-live` as window index on the assembled list.

Keep the live-tail `variant="process"` rule inside `renderMessage` (row type ≠ variant).

- [ ] **Step 5: Run tests + typecheck**

Run: `node --test lib/conversation-nodes.test.mjs`  
Expected: PASS.

Run: `node_modules/.bin/tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/conversation-nodes.ts lib/conversation-nodes.test.mjs components/chat-window/chat-window-helpers.ts components/conversation/Transcript.tsx components/ChatWindow.tsx
git commit -m "feat: assemble transcript nodes with stable entry ids"
```

---

### Task 7: `peekTodoState` + `foldProjections` (TDD)

**Files:**
- Modify: `lib/first-party/todo-extension.ts`
- Create: `lib/session-projections.ts`
- Create: `lib/session-projections.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// lib/session-projections.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("peekTodoState does not insert", async () => {
  const todo = await jiti.import("./first-party/todo-extension.ts");
  assert.equal(todo.peekTodoState("missing-session"), undefined);
  assert.equal(todo.peekTodoState("missing-session"), undefined);
});

test("fold todos from last todo toolResult details.tasks", async () => {
  const { foldProjections } = await jiti.import("./session-projections.ts");
  const tasks = [{ id: 1, subject: "A", status: "pending" }];
  const folded = foldProjections({
    sessionId: "s1",
    title: "Hello",
    messages: [
      { role: "user", content: "go" },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "todo",
        content: [{ type: "text", text: "ok" }],
        details: { action: "list", params: {}, tasks, nextId: 2 },
      },
    ],
    contextPressure: { tokens: 10, contextWindow: 100, percent: 10 },
  });
  assert.deepEqual(folded.todos, tasks);
  assert.equal(folded.title, "Hello");
  assert.equal(folded.tokenUsage.userMessages, 1);
  assert.equal(folded.contextPressure?.tokens, 10);
});

test("no todo result yields null todos", async () => {
  const { foldProjections } = await jiti.import("./session-projections.ts");
  const folded = foldProjections({
    sessionId: "s1",
    title: null,
    messages: [{ role: "user", content: "x" }],
    contextPressure: null,
  });
  assert.equal(folded.todos, null);
});

test("one field failure does not fail the fold", async () => {
  const { foldProjections } = await jiti.import("./session-projections.ts");
  const folded = foldProjections({
    sessionId: "s1",
    title: "t",
    messages: null, // foldTokenUsage must catch
    contextPressure: null,
  });
  assert.equal(folded.title, "t");
  assert.equal(folded.todos, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/session-projections.test.mjs`  
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement peek + fold**

In `todo-extension.ts`, next to `getState`:

```ts
/** Non-creating read. Do not use getState() here — it inserts an empty list. */
export function peekTodoState(sessionId: string): TaskState | undefined {
  return store.get(sessionId);
}
```

`lib/session-projections.ts` header: `Fold todos, title, token usage, and context pressure for session GET and get_state.`

```ts
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "./types";
import type { ContextUsage, SessionStatsInfo } from "./pi-types";
import { peekTodoState } from "./first-party/todo-extension";
import { isRecord } from "./type-guards";

export type ProjectionTodo = {
  id: number;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  activeForm?: string;
};

export type SessionProjections = {
  todos: ProjectionTodo[] | null;
  title: string | null;
  tokenUsage: SessionStatsInfo;
  contextPressure: ContextUsage | null;
};

export type FoldProjectionsInput = {
  sessionId: string;
  title: string | null;
  messages: AgentMessage[] | null | undefined;
  contextPressure: ContextUsage | null;
  sessionFile?: string;
};

function asTodos(value: unknown): ProjectionTodo[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: ProjectionTodo[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== "number" || typeof row.subject !== "string") continue;
    const status = row.status;
    if (status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "deleted") continue;
    out.push({
      id: row.id,
      subject: row.subject,
      status,
      activeForm: typeof row.activeForm === "string" ? row.activeForm : undefined,
    });
  }
  return out.length > 0 ? out : null;
}

function foldTodos(sessionId: string, messages: AgentMessage[]): ProjectionTodo[] | null {
  const live = peekTodoState(sessionId);
  if (live && live.tasks.length > 0) return asTodos(live.tasks);
  let lastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") lastUser = i;
  }
  const turn = lastUser >= 0 ? messages.slice(lastUser) : messages;
  for (let i = turn.length - 1; i >= 0; i--) {
    const msg = turn[i];
    if (msg?.role !== "toolResult") continue;
    const tr = msg as ToolResultMessage;
    if (tr.toolName && tr.toolName !== "todo") continue;
    if (!isRecord(tr.details)) continue;
    const todos = asTodos(tr.details.tasks);
    if (todos) return todos;
  }
  return null;
}

function foldTokenUsage(
  sessionId: string,
  title: string | null,
  messages: AgentMessage[],
  sessionFile: string | undefined,
  contextPressure: ContextUsage | null,
): SessionStatsInfo {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  let toolCalls = 0;
  for (const msg of messages) {
    if (msg.role === "user") userMessages += 1;
    if (msg.role === "toolResult") toolResults += 1;
    if (msg.role !== "assistant") continue;
    assistantMessages += 1;
    const assistant = msg as AssistantMessage;
    toolCalls += assistant.content.filter((c) => c.type === "toolCall").length;
    const u = assistant.usage;
    if (!u) continue;
    tokens.input += u.input ?? 0;
    tokens.output += u.output ?? 0;
    tokens.cacheRead += u.cacheRead ?? 0;
    tokens.cacheWrite += u.cacheWrite ?? 0;
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return {
    sessionFile,
    sessionId,
    sessionName: title ?? undefined,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages: messages.length,
    tokens,
    ...(contextPressure ? { contextUsage: contextPressure } : {}),
  };
}

export function foldProjections(input: FoldProjectionsInput): SessionProjections {
  const title = input.title;
  let todos: ProjectionTodo[] | null = null;
  let tokenUsage: SessionStatsInfo = {
    sessionId: input.sessionId,
    sessionName: title ?? undefined,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  try {
    todos = foldTodos(input.sessionId, Array.isArray(input.messages) ? input.messages : []);
  } catch {
    // One fold field must not fail the whole hydrate.
    todos = null;
  }
  try {
    tokenUsage = foldTokenUsage(
      input.sessionId,
      title,
      Array.isArray(input.messages) ? input.messages : [],
      input.sessionFile,
      input.contextPressure,
    );
  } catch {
    // One fold field must not fail the whole hydrate.
  }
  return { todos, title, tokenUsage, contextPressure: input.contextPressure };
}
```

`peekTodoState` importing `todo-extension.ts` from `session-projections.ts` pulls the first-party extension module into any process that folds. Session GET is **heavy** already. `get_state` is heavy. Do **not** import this from light routes or the renderer.

If `todo-extension.ts` importing the SDK makes `session-projections` unsafe for a test that only needed fold: the test uses jiti and will load it. That is acceptable (heavy).

- [ ] **Step 4: Run tests**

Run: `node --test lib/session-projections.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/first-party/todo-extension.ts lib/session-projections.ts lib/session-projections.test.mjs
git commit -m "feat: fold session projections on the host"
```

---

### Task 8: Wire projections; delete client todo/usage scans

**Files:**
- Modify: `lib/rpc-session-wrapper.ts` (`get_state` only)
- Modify: `app/api/sessions/[id]/route.ts`
- Modify: `app/api/sessions/[id]/context/route.ts`
- Modify: `lib/agent-session-live-apply.ts`
- Modify: `lib/session-metrics-store.ts`
- Modify: `hooks/useAgentSession.ts` (`loadSession` / `loadContext`; delete chrome token walk)
- Modify: `components/ChatWindow.tsx` (delete `deriveTodoWidgetLines` / todo scan)
- Modify: `components/TopBarChromeWidgets.tsx`
- Modify: `lib/todo-from-transcript.ts` + `lib/todo-from-transcript.test.mjs`

- [ ] **Step 1: Metrics store `todos`**

Add to `MetricsSnapshot`: `todos: ProjectionTodo[] | null`.

```ts
export function setTodosMetric(todos: ProjectionTodo[] | null): void {
  // equality: same length + id/status/subject
  snapshot = { ...snapshot, todos };
  emit();
}

export function useTodosMetric(): ProjectionTodo[] | null {
  return useSyncExternalStore(subscribe, () => getSnapshot().todos, () => null);
}
```

`clearSessionMetrics` must reset `todos: null`.

- [ ] **Step 2: `get_state` and session GET**

In `rpc-session-wrapper.ts` `case "get_state"` after `contextUsage` is computed:

```ts
import { foldProjections } from "./session-projections";

const projections = foldProjections({
  sessionId: this.inner.sessionId,
  title: this.inner.sessionManager.getSessionName() ?? null,
  messages: (this.inner.agent.state?.messages ?? []) as AgentMessage[],
  contextPressure: contextUsage ?? null,
  sessionFile: this.inner.sessionFile ?? undefined,
});
return { /* existing fields */, projections };
```

Do not add other logic to the switch.

In both session routes, after `contextUsage`:

```ts
const projections = foldProjections({
  sessionId: id,
  title: sm.getSessionName() ?? info?.name ?? null,
  messages: context.messages,
  contextPressure: contextUsage,
  sessionFile: filePath,
});
return NextResponse.json({ /* existing */, projections });
```

- [ ] **Step 3: Apply on the client**

`AgentStateResponse` gains `projections?: SessionProjections`.

`applyLiveAgentStateFields` — if `liveState.projections` is set, call `setTodosMetric(projections.todos)` and `setSessionStatsMetric(projections.tokenUsage)` (and keep existing `setContextUsage` from `contextUsage` or `projections.contextPressure`).

`loadSession` / `loadContext` in `useAgentSession.ts`: when `d.projections` exists, call `setTodosMetric` + `setSessionStatsMetric` (same as live-apply). **Delete** the `useMemo` that walks `messages` to build `SessionStatsInfo` (~340–371) and stop returning `sessionStats` from the hook. `ChatWindow` currently copies that memo into `setSessionStatsMetric` (~362). After the delete, ChatWindow must not walk messages; metrics come only from host `projections` via `applyLiveAgentStateFields` / loadSession. Remove the `sessionStats` / `statsKey` effect in ChatWindow if it becomes unused.

- [ ] **Step 4: Top bar + ChatWindow deletions**

`TopBarChromeWidgets`:
- `const todos = useTodosMetric();`
- Build the todo capsule from `todos` (count completed/total; popover lists subjects). Do **not** `parseWidget` for todo.
- Filter `chromeWidgets` to **non-todo** keys (`classifyWidgetKey !== "todo"`) for the subagent capsule.

`ChatWindow`:
- Delete `deriveTodoWidgetLines`, `todoUsedInLatestTurn` if it only exists to synthesize the widget, and the fallback that pushes `rpiv-todos` from regex.
- Still publish **non-todo** `topBarWidgets` (agents) via `setChromeWidgetsMetric`.
- Call `setTodosMetric` only if a local path still needs it — prefer host apply only.

`lib/todo-from-transcript.ts`:
- Delete `deriveTodoWidgetLines` and `deriveTodosFromTranscript` if nothing else imports them.
- Keep `formatTodoWidgetLines`.
- Update tests: drop derive cases; keep format cases.

- [ ] **Step 5: Grep + tests + typecheck**

Run: `rg -n "deriveTodoWidgetLines|deriveTodosFromTranscript" --glob '!docs/**'`  
Expected: no matches.

Run: `node --test lib/session-projections.test.mjs lib/todo-from-transcript.test.mjs`  
Expected: PASS.

Run: `node_modules/.bin/tsc --noEmit`  
Expected: PASS.

If `scripts/smoke-ipc-runtime.mjs` asserts an exact `get_state` key set and fails, add `projections` to that fixture. Do not expand smoke otherwise.

- [ ] **Step 6: Commit**

```bash
git add lib/rpc-session-wrapper.ts app/api/sessions lib/agent-session-live-apply.ts lib/session-metrics-store.ts hooks/useAgentSession.ts components/ChatWindow.tsx components/TopBarChromeWidgets.tsx lib/todo-from-transcript.ts lib/todo-from-transcript.test.mjs
git commit -m "feat: push host session projections to chrome"
```

---

### Task 9: Docs + deletion audit

**Files:**
- Modify: `AGENTS.md` (file map)
- Modify: `docs/superpowers/specs/2026-08-14-presentation-layer-design.md` (status)

- [ ] **Step 1: Update `AGENTS.md` file map**

Add:

```
lib/tool-presentation.ts     tool cards + attachPresentationToMessages
lib/tool-presenters/         exact-name presenters (SDK-free)
lib/conversation-nodes.ts    assembleTranscript
lib/session-projections.ts   fold todos/title/tokens/context
components/conversation/Transcript.tsx   windowed node list
```

Stop saying `rpc-manager.ts` owns the wrapper; point at `rpc-session-wrapper.ts` / `rpc-registry.ts` / `rpc-session-start.ts`.

- [ ] **Step 2: Deletion audit**

Run:

```bash
rg -n "isCardToolName|isEditToolName|function runCategory\\(|deriveTodoWidgetLines|getResultDiff" --glob '!docs/**'
```

Expected: no remaining classifiers. Fix any leftover.

- [ ] **Step 3: Spec status**

Set spec status to: `Implemented (see ../plans/2026-08-14-presentation-layer.md)`.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-08-14-presentation-layer-design.md
git commit -m "docs: record presentation-layer owners"
```

---

## Manual acceptance (after Task 8)

- Send a turn using read / bash / edit / ask / todo. Cards match the spec table. Todo capsule comes from `projections`, not transcript regex.
- Refresh mid-stream: live tail is flat `message` + `stream`; after settle, `process`/`answer` and `entry:*` ids.
- Open an old session: cards still correct (attached on read).
- Fork: child todos/projections do not show the parent store.
- Compact: compaction node still renders.
- Unknown MCP tool: one generic scaffold row.
- Mid-turn edit: after `toolResult` `message_end`, the committed card shows `presentation.patch` **before** `agent_end` rebase.

Do not add a poller, SSE type, or name-regex “just in case.”

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| Card types + `presenterFor` + default generic | 2 |
| Exact-name presenters + `patchFromToolDetails` nested results | 3 |
| `presentation` not in jsonl; attach on `session-entries` | 4 |
| SSE `presentCall` / `presentResult`; copy onto committed toolCall | 4 |
| Delete name heuristics; group by card; `write` uses helper | 5 |
| `kind: "message"` + live-tail process variant + stream node | 6 |
| `peekTodoState` no insert; fold todos/title/tokens/context | 7 |
| GET / `get_state` / metrics / top bar; delete client scans | 8 |
| AGENTS.md owners; no sixth recovery path | 9 |
| Extract ChatWindow before growing it | 1 |
| No Cordis, no inbox, no execute waterfall | (out of scope) |
