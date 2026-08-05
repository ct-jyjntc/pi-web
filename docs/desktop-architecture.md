# Desktop client architecture

Pi Web is an Electron client. There is no web server: the renderer is served by
the main process over `app://`, and the agent runtime is a pair of child
processes reached over the Node IPC channel.

```
Electron main process
├── protocol.handle("app://")  → desktop-dist        (electron/app-protocol.js)
├── BrowserWindow.loadURL("app://pi")
├── ipcMain "pi-api:request" / "pi-api:stream"       (electron/runtime-host.js)
└── two agent runtimes, bundled Node + child IPC     (daemon/ipc-host.mjs)
     ├── light  — routes that never touch the agent SDK
     └── heavy  — everything else, plus the extension prewarm
```

## Why it is shaped like this

The previous design was one Node HTTP server that served **both** the renderer's
code-split chunks and `/api/*`. Loading the agent SDK is ~2400 files and blocks
its event loop for ~5s warm and ~17s cold on Windows, so the window painted
instantly and then sat empty for tens of seconds waiting for JavaScript it could
not fetch. Two independent splits fix that:

1. **Assets leave the runtime process.** `app://` is served by the main process,
   so no amount of agent work can delay rendering.
2. **SDK-free routes leave the SDK process.** The session list, file tree, git
   status and settings used to queue behind the SDK load; now they are answered
   by a runtime that never loads it.

Measured on a packaged Windows build, cold (empty jiti cache = first run after
install):

| | before | after |
|---|---|---|
| Renderer UI ready | 1499ms, content ~38s | **246ms** |
| `/api/sessions` | 35881ms | **396ms** |
| `/api/web-settings` | 38751ms | **191ms** |
| `/api/git/status` | — | **154ms** |
| SDK load (`/api/project-trust`) | blocks everything | 10029ms, isolated |

## Route classification

`electron/runtime-host.js` owns the light/heavy split. Misclassifying is safe in
one direction only: the heavy runtime can serve anything, so an unlisted path is
merely as slow as before — but a path listed as light that *does* reach the SDK
drags it into the process that exists to stay clear of it.

A route is heavy if it reaches `@earendil-works/*` or the `globalThis.__piSessions`
registry through static imports. Chat content (`/api/sessions/[id]`) is heavy:
transcripts are parsed with the SDK's `SessionManager` (`lib/session-entries.ts`).
The session *list* is light — `lib/session-reader.ts` reads `.jsonl` off disk and
is deliberately kept SDK-free.

`/api/sessions` returns `runningSessionIds` from the light runtime, where the
registry does not exist, so it always returns `[]`. That is the documented
contract: `SessionSidebar` treats it as an initial fallback and `/api/agent/running`
(heavy, polled every 2.5s) is authoritative.

## Transport

`lib/api-transport.ts` is the single owner of renderer → runtime calls. Nothing
else may call `fetch("/api/…")` or construct an `EventSource`.

- `apiFetch(path, init)` resolves to a real `Response`, so `res.ok` / `res.json()`
  behave exactly as they did over HTTP.
- `apiStream(path)` exposes the slice of `EventSource` the app uses. Framing is
  parsed in-process (`createSseParser`), covered by `lib/api-transport.test.mjs`.

Two traps, both found only by running the packaged app:

- **The IPC channel must use JSON serialization.** `serialization: "advanced"` is
  V8 structured clone, and Electron's V8 differs from the bundled Node's; the
  channel dies with "Unable to deserialize cloned data". Bodies cross as base64.
- **`child.send()` needs its callback argument.** Without it a failed write —
  EPIPE while a runtime is exiting on window close — becomes an uncaught
  exception and Electron shows an error dialog.

## Packaging

`build:electron` builds the SPA, then `prepare-electron-standalone.mjs` stages
the payload and prunes the Next server:

| Staged | Note |
|--------|------|
| `daemon/` | ipc-host + dispatch + route matcher + `next/server` shim |
| `desktop-dist/` | SPA, source maps stripped |
| `app/api/**` | esbuild-transpiled to ESM `route.mjs` |
| `lib/**` | esbuild-transpiled to ESM, tests excluded |
| `node_modules/jiti` | devDependency, staged explicitly |
| `@earendil-works/*` | overlaid, then collapsed by `bundle-pi-sdk.mjs` |

`electron-after-pack.mjs` asserts the payload landed and that routes are
`route.mjs`, not `route.ts` — a tree that silently shipped sources still boots,
just far slower.

`build.files` in package.json is `electron/*.js`, not a per-file list: a new
main-process module missing from the asar makes the app die before it can open
its log, which presents as "process running, no window, empty log".

### Why packaged routes are precompiled ESM

Shipping TypeScript made jiti transpile on first hit — ~25s of blocked event loop
on a cold Windows install. The runtime still loads through jiti (it owns the `@/`
alias and the `next/server` shim) but only resolves modules now.

**The emitted format must stay ESM.** CJS output makes jiti `require()` the
ESM-only agent SDK, which drags node_modules through babel: ~64s versus ~29s for
shipping TypeScript unchanged.

Replacing jiti with native `import()` was measured and is **not** worth it: 18.2s
versus 14.2s for the same route. Module loading here is filesystem-bound, not
loader-bound — the same operation varies between 2s and 25s on the same machine
depending on cache and antivirus state. Do not micro-optimize it from timings.

### jiti transpile cache

Pinned to `<agentDir>/cache/jiti` (`daemon/dispatch.mjs`). jiti's own default is
`node_modules/.cache` falling back to the OS temp dir — the first is read-only
under a per-machine Windows install, and the second is purged by Storage Sense.

### Extension prewarm

`ensureBuiltinPackages` is seconds of synchronous module loading. It runs only in
the heavy runtime, and only once `prewarmDelayMs` has passed with no request in
flight. If the client never goes quiet it never runs — the extensions still load
lazily on first session start, so there is no fallback to add.

### Agent SDK single-file entries

`scripts/bundle-pi-sdk.mjs` (invoked from `prepare-electron-standalone.mjs`)
collapses the `@earendil-works` packages the heavy runtime loads into single-file
ESM entries:

| Package entry | Why |
|---|---|
| `pi-coding-agent/dist/index.js` | Cold-start hot path — fully inlines pi-ai / agent-core / tui |
| `pi-coding-agent/dist/cli.js` | Subagent `pi` shim |
| `pi-ai` index / compat / oauth / openai-completions.lazy | Direct app imports |
| `pi-agent-core` index + node | Direct app imports |
| `pi-tui` index | Keybindings |

The multi-file coding-agent `dist/**/*.js` tree is pruned after the bundle; theme
JSON and export-html assets stay so `getPackageDir()` resolution still works.
Nested `pi-coding-agent/node_modules` (thousands of AWS SDK files etc.) is dropped
because it is inlined.

Measured warm load of `pi-coding-agent` on this machine: **~1.8s multi-file →
~0.4s bundled**. Cold (Defender scanning thousands of first-touch files) is where
the gap is largest — that is the install-once stall the dual-runtime split
cannot remove by itself.

Do not reintroduce a static import of the multi-file package tree on the heavy
path. Dev continues to use stock `node_modules` (unbundled); only the packaged
standalone tree is collapsed.

### Packaged module loading (native ESM, not jiti)

`prepare-electron-standalone.mjs` rewrites local import specifiers in the staged
`lib/**/*.mjs` and `app/api/**/*.mjs` trees (extensionless relatives and `@/` →
concrete `.mjs` paths; `next/server` → the daemon shim). `daemon/dispatch.mjs`
then loads those files with native `import()`.

jiti remains only as a **dev / fallback** path for TypeScript sources. Do not
preload the agent SDK through `jiti()` in packaged builds — it re-walks the
bundled graph and measured ~20s for a file native import loads in ~0.5s.

## Still on HTTP: the build only

`next build` remains in the pipeline purely because `prepare-electron-standalone.mjs`
relies on Next's file tracing to produce `standalone/node_modules`. Nothing at
runtime uses Next.

**Removal condition:** replace the tracing (`@vercel/nft` directly, or stage
production dependencies) and then delete `next.config.ts`, `app/layout.tsx`,
`app/page.tsx` and the Next dependencies. `app/api/**` stays — those are plain
`Request`/`Response` handlers behind the `next/server` shim.

## Dev commands

```bash
npm run desktop:build     # Vite → desktop-dist
npm run electron          # desktop client
npm run smoke:ipc         # runtime protocol regression (buffered + SSE)
npm run daemon            # runtime alone, speaks IPC to its parent
```
