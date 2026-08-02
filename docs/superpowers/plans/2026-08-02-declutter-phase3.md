# Declutter Phase 3 — Giant UI Splits

**Date:** 2026-08-02  
**Spec:** [`docs/superpowers/specs/2026-08-02-declutter-design.md`](../specs/2026-08-02-declutter-design.md)  
**Rules:** move + equivalent render only; no visual redesign or feature add in the same change.

## Order

1. ~~`MessageView.tsx` — split by block type~~ **done**
2. ~~`ChatInput.tsx` — model / thinking / menus vs composer~~ **done (orchestrator still large)**
3. ~~`ModelsConfig.tsx`~~ **done** · `SettingsPage.tsx` — primitives + Tools/LSP panel extracted (shell still large)
4. `ChatWindow.tsx` / `AppShell.tsx` / `SessionSidebar.tsx` — thin shell + orchestration

## MessageView result

| Path | Role | ~lines |
|------|------|-------:|
| `components/MessageView.tsx` | façade re-export | 2 |
| `components/message/MessageView.tsx` | role dispatcher | ~87 |
| `components/message/UserMessageView.tsx` | user bubble | ~264 |
| `components/message/AssistantMessageView.tsx` | assistant surface | ~352 |
| `components/message/blocks/ToolCallBlock.tsx` | tool card + diffs | ~746 |
| `components/message/blocks/*` | text / thinking / run group / block switch | smaller |
| `components/message/message-view-utils.ts` | pure helpers | ~183 |
| `components/message/tool-run-meta.ts` | run grouping titles | ~118 |

**Before:** `MessageView.tsx` ~2435  
**After:** no single message file &gt;800 except `ToolCallBlock` (~746, under soft 800).

```text
Invariant: ChatWindow still imports MessageView; render structure unchanged
Owner module: components/message/MessageView.tsx (dispatcher)
Recovery paths after change: n/a (UI extract)
Files >800 lines touched: was 2435 → split; net façade 2 lines
New dual-path?: no
```

## ChatInput result

| Path | Role | ~lines |
|------|------|-------:|
| `components/ChatInput.tsx` | composer orchestrator | ~1614 (was 2161) |
| `components/chat-input/chat-input-shared.ts` | pure helpers / constants | ~124 |
| `components/chat-input/ChatInputModelMenu.tsx` | model picker panel | ~137 |
| `components/chat-input/ChatInputThinkingMenu.tsx` | thinking levels | ~72 |
| `components/chat-input/ChatInputPermissionMenu.tsx` | permission modes | ~80 |
| `components/chat-input/ComposerAutocompleteMenus.tsx` | history / slash / @ | ~289 |
| `components/chat-input/ComposerBanners.tsx` | model/queue banners | ~94 |
| `components/chat-input/ContextUsageRing.tsx` | context ring | ~40 |

```text
Invariant: ChatWindow import of ChatInput + filterModelOptions re-export unchanged
Owner module: components/ChatInput.tsx (orchestrator); menus under chat-input/
Recovery paths: n/a
Files >800: ChatInput still 1614 (stateful shell); follow-up: useComposer* hooks
New dual-path?: no
```

## ModelsConfig result

| Path | Role | ~lines |
|------|------|-------:|
| `components/ModelsConfig.tsx` | façade re-export | 2 |
| `components/models-config/ModelsConfig.tsx` | shell + nav | ~663 |
| `components/models-config/ModelDetail.tsx` | model editor | ~566 |
| `components/models-config/ProviderDetail.tsx` | provider editor | ~338 |
| `components/models-config/OAuthDetail.tsx` | OAuth login | ~285 |
| `components/models-config/*` | panels / icons / forms / types | smaller |

**Before:** ~2709 · **After:** no file &gt;700.

```text
Invariant: SettingsPage still imports ModelsConfig; panel behavior freeze
Owner module: components/models-config/ModelsConfig.tsx
Recovery paths: n/a
New dual-path?: no
```

## SettingsPage progress

| Path | Role | ~lines |
|------|------|-------:|
| `components/SettingsPage.tsx` | shell + remaining small panels | **~1142** (was 2066) |
| `components/settings/settings-ui.tsx` | SettingsRow / ModelSelect / … | ~118 |
| `components/settings/ToolsSettingsPanel.tsx` | LSP | ~136 |
| `components/settings/NetworkSettingsPanel.tsx` | network | ~175 |
| `components/settings/MemorySettingsPanel.tsx` | project memory | ~323 |
| `components/settings/AppearanceSettingsPanel.tsx` | theme / code | ~294 |
| `components/settings/AgentModelsSettingsPanel.tsx` | roles + utility models | ~148 |
| `components/settings/LeanModeSettingsSection.tsx` | lean mode | ~234 |

```text
Invariant: settings section routing unchanged; panel UI freeze
Owner: SettingsPage shell + settings/* panels
New dual-path?: no
```

## ChatWindow progress

| Path | Role | ~lines |
|------|------|-------:|
| `components/ChatWindow.tsx` | orchestrator | **~1292** (was 2036) |
| `components/chat-window/chat-window-helpers.ts` | pure transcript helpers | ~213 |
| `components/chat-window/ProcessDetailsGroup.tsx` | process details | ~155 |
| `components/chat-window/ExtensionPanels.tsx` | extension UI | ~342 |
| `components/chat-window/NoticeShelf.tsx` / `ExtensionWidgets.tsx` | small UI | smaller |

## SessionSidebar result

| Path | Role | ~lines |
|------|------|-------:|
| `components/SessionSidebar.tsx` | façade | 2 |
| `components/session-sidebar/SessionSidebar.tsx` | shell | **~1164** (was 1910) |
| `components/session-sidebar/SessionItem.tsx` | row + rename/delete menu | ~354 |
| `components/session-sidebar/SessionTreeItem.tsx` | tree node | ~86 |
| `components/session-sidebar/session-sidebar-helpers.ts` | tree/time/unread pure | ~215 |
| `components/session-sidebar/sidebar-ui.tsx` | PathLabel / AnimatedDropdown | ~90 |
| `components/session-sidebar/SessionIndicators.tsx` | running/unread dots | ~70 |

## AppShell result

| Path | Role | ~lines |
|------|------|-------:|
| `components/AppShell.tsx` | shell orchestration | **~1391** (was 1711) |
| `components/app-shell/lazy-panels.tsx` | dynamic panel imports | ~57 |
| `components/app-shell/ShellStyles.tsx` | global shell CSS | ~79 |
| `components/app-shell/terminal-tabs.ts` | tab model + renumber | ~45 |
| `components/app-shell/app-shell-constants.ts` | timing / panel width | ~10 |
| `hooks/useAppShellTerminal.ts` | terminal tabs + PTY SSE | ~220 |
| `hooks/useRightWorkspacePanel.ts` | ready for next pass (not wired yet) | ~219 |

```text
Invariant: layout, session/cwd, workspace, terminal behavior freeze
Owner: AppShell + useAppShellTerminal + app-shell/*
New dual-path?: no (useRightWorkspacePanel unused until wired — optional delete or next PR)
```

## Phase 3 overall

MessageView, ChatInput, ModelsConfig, SettingsPage, ChatWindow, SessionSidebar, AppShell all reduced. Remaining optional: wire `useRightWorkspacePanel`, further ChatInput/AppShell thins.
