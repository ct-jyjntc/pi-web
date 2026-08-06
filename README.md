<div align="center">

# Pi Web

**Local coding-agent workspace — chat, files, Git, and terminals in one app**

Electron desktop · browser UI · [ct-jyjntc/pi-web](https://github.com/ct-jyjntc/pi-web)

[![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](./LICENSE)
[![Platform](https://img.shields.io/badge/Desktop%20%2B%20Browser-111111?style=for-the-badge)](#install)
[![GitHub](https://img.shields.io/badge/GitHub-ct--jyjntc%2Fpi--web-181717?style=for-the-badge&logo=github)](https://github.com/ct-jyjntc/pi-web)

[中文](./README.zh-CN.md)
·
[Product site](https://ct-jyjntc.github.io/pi-web/)
·
[Desktop architecture](./docs/desktop-architecture.md)
·
[Releases](https://github.com/ct-jyjntc/pi-web/releases)
·
[Issues](https://github.com/ct-jyjntc/pi-web/issues)

> Based on [agegr/pi-web](https://github.com/agegr/pi-web) — secondary development with a dual-runtime desktop client and expanded workspace.

<br/>

<table>
  <tr>
    <td width="50%">
      <img src="./docs/screenshot-light.png" alt="Pi Web light theme" />
      <p align="center"><sub>Light</sub></p>
    </td>
    <td width="50%">
      <img src="./docs/screenshot-dark.png" alt="Pi Web dark theme" />
      <p align="center"><sub>Dark</sub></p>
    </td>
  </tr>
</table>

</div>

---

Pi Web is a **local-first coding-agent workspace** for your machine.  
Open a project, chat with the agent, review Git, browse files, and open terminals — as a desktop app or in the browser. There is **no cloud account** for the app itself; data lives under `~/.pi/agent`.

| | |
| :--- | :--- |
| Repository | [github.com/ct-jyjntc/pi-web](https://github.com/ct-jyjntc/pi-web) |
| Product site | [ct-jyjntc.github.io/pi-web](https://ct-jyjntc.github.io/pi-web/) |
| Desktop | macOS arm64 DMG · Windows x64 NSIS · **`app://` UI + dual IPC runtimes** |
| Browser | Next.js on `http://127.0.0.1:30141` |
| Node (from source) | **≥ 22.19.0** |
| License | MIT |

## Install

### Desktop (recommended)

Download from [Releases](https://github.com/ct-jyjntc/pi-web/releases/latest):

| Platform | Artifact |
| --- | --- |
| macOS (Apple Silicon) | `Pi-Web-<version>-arm64.dmg` |
| Windows (x64) | `Pi-Web-<version>-x64.exe` |

Installers **bundle Node**. End users do not need to install Node or start a server.

> [!NOTE]
> macOS builds are **ad-hoc signed** (not Apple-notarized). First open may need **Right-click → Open**.

### Browser (from source)

```bash
git clone https://github.com/ct-jyjntc/pi-web.git
cd pi-web
npm install
npm run dev          # http://127.0.0.1:30141
```

## Highlights

### Agent workspace

- **Streaming chat** — replies, tool calls / results, thinking levels, context usage & cost, compaction
- **Agent modes** — **Ask** · **Auto edit** · **Plan** · **Full access** (edit gates & confirmations in one control)
- **Permissions** — allow / ask / deny for tools, bash patterns, paths; YOLO only auto-approves *ask* (deny still blocks)
- **Sessions** — project-grouped history, AI titles, rename / delete, fork to a new session, in-session branches
- **Edit from here** — rework a prompt; optional file undo through that turn
- **Composer** — `@` file mentions, slash commands, image attach, steer / queue while running
- **Extension UI** — confirm / select / input, todos, ask-user questions
- **Subagents** — Explore / Plan / Reviewer / general-purpose (managed agents)

### Project tools

- **Git Review tab** — status, stage / discard, commit, commit & push, pull, branches, AI commit messages, conflict helpers, commit split, **Git Review** sessions
- **Worktrees** — list / switch / create / remove ([guide](./docs/worktrees.md))
- **Files** — explorer CRUD, fuzzy index, Monaco edit, Markdown / image / audio / PDF / DOCX preview, diff vs HEAD
- **Terminals** — multi-tab PTY (xterm + node-pty) at project cwd
- **Context panel** — tokens & cost, compact, checkpoints / rewind, workspace undo·redo
- **Debug tab** — Node inspect lite (optional / power-user)

### Models, skills, desktop polish

- **Models & auth** — providers, OAuth / device-code / API keys, custom endpoints, model roles (**default** / **smol** / **plan**), free catalog, connection tests
- **Skills & MCP** — list / search / install skills; MCP servers (stdio / HTTP)
- **LSP health** — Settings catalog + install hints; agent `lsp` tool
- **Project memory** — retain / recall / reflect (**opt-in** in Settings)
- **Desktop shell** — tray (close hides), finish notifications, completion sound, single-instance, in-app shortcuts, update check
- **i18n & theme** — English / 中文 · light / dark / system

```text
┌────────────────┬──────────────────────┬────────────────────────┐
│ Projects &     │ Chat + tools         │ Right workspace        │
│ sessions       │ model · mode · perms │ Review · Files ·       │
│ worktrees      │ streaming · composer │ Context · Debug · TTY  │
└────────────────┴──────────────────────┴────────────────────────┘
```

## Architecture

### Desktop (product path)

There is **no loopback web server** for the packaged desktop UI. Electron serves the SPA itself and talks to **two** Node agent children over IPC:

```text
Electron main
├── app://pi  →  desktop-dist          (electron/app-protocol.js)
├── BrowserWindow.loadURL("app://pi")
├── ipcMain  pi-api:request / stream   (electron/runtime-host.js)
└── two agent runtimes (bundled Node + child IPC)
     ├── light  — SDK-free routes (sessions list, files, git, settings chrome, …)
     └── heavy  — agent SDK, live chat, ModelRuntime, session content, …
```

| Layer | Owner |
| --- | --- |
| Process / window / tray | `electron/main.js`, `tray.js`, `preload.js` |
| Static UI | `electron/app-protocol.js` → `desktop-dist/` (Vite SPA) |
| Dual runtime + IPC bridge | `electron/runtime-host.js` |
| Agent children | `daemon/ipc-host.mjs` → `dispatch.mjs` → `app/api/**` |
| Renderer transport | `lib/api-transport.ts` (`window.piApi` on desktop, `fetch` in browser) |

**Why two runtimes?** Loading the agent SDK blocks a Node event loop for seconds. Keeping session list / files / git / settings on a **light** process means the workspace chrome stays responsive while the **heavy** process warms. Measured on packaged Windows (empty jiti cache): UI ready ~246ms; `/api/sessions` ~396ms; SDK load isolated (~10s) instead of freezing chrome.

Full design: [docs/desktop-architecture.md](./docs/desktop-architecture.md).

### Browser

```text
Browser  ──REST + SSE──▶  Next.js (app/ + app/api) on 127.0.0.1:30141
                              │
                              └─ same app/api handlers + in-process AgentSession
```

### Local data

| Path | Role |
| --- | --- |
| `~/.pi/agent` | Default data root (`PI_CODING_AGENT_DIR`) |
| `…/sessions/<cwd>/*.jsonl` | Conversation history |
| `…/models.json` | Models / providers |
| `…/pi-web.json` | Settings (roles, proxy, agent mode, UI, GPU, …) |
| `…/auth.json` | Provider credentials |
| `…/project-memory/<key>/facts.jsonl` | Project memory (when enabled) |
| `…/cache/jiti` | Desktop runtime transpile cache |
| Electron logs | `app.getPath("logs")/main.log` |

File access is allow-listed: session cwds, project roots, `~/pi-cwd-*`, and explicitly allowed roots.

### Security

- **No login** by default. The agent can run bash, edit files, and call tools.
- Browser default bind: `127.0.0.1:30141`. Desktop UI does not open a public HTTP port.
- Project trust gate before loading project-local resources.
- Permission policy + agent modes; **deny always wins** over Full access / YOLO.

## Develop from source

> Node.js **≥ 22.19.0**.

```bash
git clone https://github.com/ct-jyjntc/pi-web.git
cd pi-web
npm install

# Browser UI
npm run dev                 # http://127.0.0.1:30141

# Desktop (needs SPA build)
npm run desktop:build
npm run electron            # app:// + dual IPC runtimes
```

### Package installers

```bash
npm run build:electron      # extensions → SPA → next build (stage deps) → standalone → Node → pi CLI
npm run dist:mac            # DMG + zip (arm64)
npm run dist:dmg            # DMG only
npm run dist:win            # Windows NSIS (x64)
```

`build:electron` stages `daemon/`, `desktop-dist/`, transpiled `app/api` + `lib`, collapsed SDK bundles, bundled Node, and the `pi` CLI shim. The Next production server is **pruned** from the package unless `PI_WEB_KEEP_NEXT=1` (rollback tree only — Electron main does not start Next).

| Env | Purpose |
| --- | --- |
| `PI_CODING_AGENT_DIR` | Agent data root (default `~/.pi/agent`) |
| `PI_WEB_RUNTIME_ROLE` | Set by Electron: `light` \| `heavy` |
| `PI_WEB_PREWARM_DELAY_MS` | Quiet period before heavy extension prewarm (default `2000`) |
| `PI_WEB_KEEP_NEXT=1` | Packaging: keep Next server in standalone tree |
| `PI_WEB_TARGET_PLATFORM` / `PI_WEB_TARGET_ARCH` | Native prune at package time |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Model / tool network (also Settings → Network) |

Smoke:

```bash
npm run smoke:ipc
npm run smoke:flows
npm run smoke:electron
```

### Browser server options

| Script | Bind |
| --- | --- |
| `npm run dev` / `start` | `127.0.0.1:30141` |
| `npm run dev:lan` / `start:lan` | `0.0.0.0:30141` — **trusted network only** |

> [!WARNING]
> There is **no login**. Binding outside loopback exposes a high-privilege agent surface.

> [!CAUTION]
> Do **not** run `npm run build` while `npm run dev` is running — both write `.next/`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run electron` / `electron:dev` | Launch Electron (`app://` + dual IPC) |
| `npm run electron:prod` | Full `build:electron` then Electron |
| `npm run desktop:dev` / `desktop:build` | Vite SPA |
| `npm run daemon` | IPC host alone (needs a parent with IPC) |
| `npm run build:electron` | Desktop packaging prep |
| `npm run dist:mac` / `dist:dmg` / `dist:win` | Installers |
| `npm run bundle:extensions` / `bundle:sdk` | Prebundle extensions / SDK collapse |
| `npm run smoke:ipc` / `smoke:flows` / `smoke:electron` | Desktop smokes |
| `npm run dev` / `start` | Browser Next server |
| `npm run lint` | ESLint |

<details>
<summary><b>Source layout</b></summary>

```text
electron/          main, app-protocol (app://), runtime-host (dual IPC), tray, preload
daemon/            ipc-host, dispatch, routes, next/server shim
desktop/           Vite SPA entry + Next client shims
desktop-dist/      built SPA
app/               Next browser UI + shared app/api handlers
components/        AppShell, chat, Git, files, terminal, settings, …
hooks/             session SSE, locale, shortcuts, theme, audio
lib/               agent runtime, api-transport, security, git, pty, memory, …
scripts/           packaging, SDK bundle, IPC smoke
docs/              product site, desktop-architecture, worktrees, screenshots
```

</details>

## Docs

- [Product site](https://ct-jyjntc.github.io/pi-web/)
- [Desktop architecture](./docs/desktop-architecture.md) — `app://`, light/heavy split, cache rules
- [Worktrees](./docs/worktrees.md)
- [Release checklist](./docs/release.md)
- [中文 README](./README.zh-CN.md)

---

<div align="center">

**MIT** · [ct-jyjntc/pi-web](https://github.com/ct-jyjntc/pi-web)

</div>
