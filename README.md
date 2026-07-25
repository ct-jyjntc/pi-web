# Pi Web

[中文文档](./README.zh-CN.md)

Local web UI (and optional desktop app) for the [pi coding agent](https://github.com/badlogic/pi-mono). Pi Web reads your local pi session files and turns them into a browser workspace for chat, session browsing, model/skill configuration, Git review, integrated terminals, and project file preview.

This repository is a maintained fork with extra desktop packaging, Git/terminal workspace panels, EN/ZH UI, and other UI-side enhancements on top of the upstream pi web experience.

## Requirements

- Node.js 20+
- A working [pi](https://github.com/badlogic/pi-mono) agent setup under `~/.pi/agent` (sessions, models, auth)

## Quick Start

**Run without installing:**

```bash
npx @agegr/pi-web@latest
```

**Or install globally:**

```bash
npm install -g @agegr/pi-web
pi-web
```

Then open [http://localhost:30141](http://localhost:30141). The CLI tries to open the browser automatically once the server is ready.

**Options:**

```bash
pi-web --port 8080              # custom port
pi-web --hostname 127.0.0.1     # local access only (recommended)
pi-web -p 8080 -H 127.0.0.1     # combine options
pi-web --no-open                # do not open the browser automatically

PORT=8080 pi-web                # env vars also work
PI_WEB_NO_OPEN=1 pi-web         # useful as a background service
```

> **Security note:** there is no app-level login. Prefer binding to `127.0.0.1` if the host is reachable from untrusted networks. The Electron build binds loopback by default.

## Desktop (Electron)

Pi Web can also run as a native desktop shell (macOS DMG packaging is the primary release path).

```bash
npm install
npm run electron:dev            # dev: Next + Electron against local sources
npm run electron:prod           # production standalone build, then Electron
npm run dist:dmg                # package a macOS arm64 DMG
```

Useful env vars for the desktop shell:

| Variable | Purpose |
| --- | --- |
| `PI_WEB_ELECTRON_PORT` / `PI_WEB_PORT` | Preferred local port (default `30142`) |
| `PI_WEB_NODE_BINARY` | Explicit system Node path for native modules (e.g. `node-pty`) |

## Features

- **Session workspace** — browse pi conversations by project; rename, delete, export HTML, and jump back without digging through terminal history.
- **Live agent chat** — send prompts, stream SSE events, inspect tool calls/results, thinking, compaction, and context usage.
- **Safe branching** — fork a message into a new session file, or continue / switch in-session branches without losing history.
- **Git worktrees** — switch checkouts from the sidebar so new sessions and the Explorer follow the branch you want. See [Worktrees](./docs/worktrees.md).
- **Git review panel** — status, diffs, and jump-to-file review alongside the chat.
- **Integrated terminals** — open multiple project-cwd terminals (xterm + node-pty) in the right workspace.
- **File explorer & preview** — browse the project tree; preview source, Markdown, images, audio, PDF, and DOCX; watch for changes.
- **Models & auth** — manage `models.json`, OAuth/API keys, and model smoke tests from the UI.
- **Skills** — list, search, install, and toggle skills the same way the runtime loads them.
- **Permission modes** — switch ask / full (YOLO) permission behavior from the input bar.
- **EN / 中文 UI** — in-app locale toggle with persistent preference.
- **Themes, minimap, shortcuts** — light/dark themes, chat minimap, completion sound, and global keyboard shortcuts (e.g. Esc to abort).

## HTTP Proxy

Server-side model and API requests honor standard proxy env vars: `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`.

macOS / Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Notes

- **Data directory** — sessions default to `~/.pi/agent/sessions`. Set `PI_CODING_AGENT_DIR` to point at another pi agent directory.
- **Session files** — `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Model config** — Models panel reads/writes `models.json` in the pi agent directory; lists and defaults come from pi's config.
- **File access** — browsing/preview is scoped to session cwds, resolved project roots, `~/pi-cwd-*`, and explicitly allowed roots.
- **Fork vs in-session branch** — Fork creates a new `.jsonl` file (sidebar child via `parentSession`). "Continue" / branch navigation stays inside the same file.
- **Built-in packages** — first-party packages useful in the web/desktop UI (permission, subagents, todo, ask-user, better-compaction, …) are auto-installed into `~/.pi/agent` on boot.

## Development

```bash
npm install
npm run dev                     # http://localhost:30141
```

Common checks:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Scripts worth knowing:

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server on port `30141` |
| `npm run build` | Production Next build (release / Electron only) |
| `npm run start` | Serve the production build |
| `npm run electron` / `electron:dev` | Launch the desktop shell |
| `npm run build:electron` | Build + prepare Electron standalone bundle |
| `npm run dist:dmg` | Package macOS DMG |
| `npm run release` | Bump patch version, build, publish npm package |

**Do not run `next build` / `npm run build` while iterating with `npm run dev`.** Builds write into `.next/` and can break the dev server. Leave production builds for release or Electron packaging.

## Project Structure

```text
app/
  api/
    agent/          # create/drive AgentSession + SSE events
    auth/           # OAuth + API key management
    cwd/            # working directory validation
    default-cwd/    # default ~/pi-cwd-* helper
    file-index/     # project file index / fuzzy helpers
    files/          # list, read, preview, watch
    git/            # status + diff for the review panel
    home/           # user home directory
    models/         # available models, defaults, thinking levels
    models-config/  # read/write models.json + model tests
    permissions/    # ask / full permission mode
    sessions/       # list, rename, delete, context, HTML export
    skills/         # list, search, install, enable/disable
    worktrees/      # list/create/remove git worktrees
components/
  AppShell.tsx        # layout, URL state, desktop chrome, workspace tabs
  SessionSidebar.tsx  # projects, sessions, worktrees, explorer
  ChatWindow.tsx      # messages, SSE, drag/drop, minimap host
  ChatInput.tsx       # model / tools / thinking / compact / permissions
  MessageView.tsx     # user/assistant/tool rendering
  GitPanel.tsx        # git status + review
  TerminalPanel.tsx   # xterm terminals
  ModelsConfig.tsx    # models + auth panel
  SkillsConfig.tsx    # skills panel
  FileExplorer.tsx    # file tree
  FileViewer.tsx      # source / diff / media / PDF / DOCX preview
lib/
  rpc-manager.ts      # AgentSession lifecycle + global registry
  session-reader.ts   # .jsonl parsing + branch context
  pty-sessions.ts     # node-pty session registry
  worktree.ts         # project/worktree resolution
  permission-mode.ts  # ask/full mode persistence
  http-dispatcher.ts  # HTTP(S) proxy for server-side fetch
  file-access.ts      # allowed file roots
  i18n/               # EN / 中文 message catalogs
  ensure-builtin-packages.ts
hooks/
  useAgentSession.ts      # load, send, SSE, reconciliation
  useLocale.ts            # locale preference
  useKeyboardShortcuts.ts # global shortcuts
  useTheme.ts / useAudio.ts / useDragDrop.ts / useIsMobile.ts
electron/                 # desktop main + preload
bin/pi-web.js             # npm CLI entry
scripts/                  # electron packaging + node-pty fixes
instrumentation.ts        # server HTTP dispatcher bootstrap
```

## Related Docs

- [Worktrees in Pi Web](./docs/worktrees.md)
- [中文文档](./README.zh-CN.md)
- Upstream agent: [pi-mono](https://github.com/badlogic/pi-mono)

## License

MIT
