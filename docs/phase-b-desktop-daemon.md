# Phase B — Desktop without Next.js cold start

## Product invariant

**Opening the desktop window must not boot Next.js.**

- Desktop UI = static assets (Vite build → `desktop-dist/`)
- Desktop backend = lightweight Node daemon (`daemon/server.mjs`)
- Web / `pi-web` CLI may keep Next until a later convergence phase

## Runtime shape

```
Electron shell
  ├─ spawn: node daemon/server.mjs   (NOT next start / standalone server.js)
  ├─ wait:  GET /api/health            (inline, zero framework)
  └─ load:  http://127.0.0.1:<port>/   (static SPA from desktop-dist)
                │
                └─ /api/*  → jiti-load app/api/**/route.ts
                             with next/server shim (Web Request/Response)
```

## Why this is faster on Windows

| Old path | New path |
|----------|----------|
| Chromium + Electron Node + **Next production server** | Chromium + Electron Node + **thin HTTP daemon** |
| Next boot + instrumentation before listen | Listen first; health is inline |
| SSR/framework module graph on first paint | Static `index.html` + client JS |
| Full `standalone` Next tree always | Route modules load **on first request** via jiti |

Agent SDK still loads on first session (unchanged product cost). The **framework tax** is removed from cold start.

## Dual-path / exit condition

| Path | When |
|------|------|
| `PI_WEB_RUNTIME=daemon` (default when `desktop-dist` exists) | Phase B desktop |
| `PI_WEB_RUNTIME=next` | Explicit rollback / web packaging experiments |

**Removal condition:** after desktop packaging ships daemon-only for ≥1 release and web CLI either uses daemon or is separately tracked, delete Electron Next spawn path.

## Module ownership

| Concern | Owner |
|---------|--------|
| Desktop process boot | `electron/main.js` |
| HTTP listen + static + route dispatch | `daemon/server.mjs` |
| `next/server` compatibility | `daemon/shims/next-server.mjs` |
| SPA entry / Next client shims | `desktop/*` |
| Business handlers | existing `app/api/**/route.ts` + `lib/**` (no Next runtime) |

## Packaging

`build:electron` builds the SPA, then `prepare-electron-standalone.mjs` stages the
daemon payload into `.next/standalone` and prunes the Next server:

| Staged | Note |
|--------|------|
| `daemon/` | server + route matcher + `next/server` shim |
| `desktop-dist/` | SPA, source maps stripped (~61MB) |
| `app/api/**` | TypeScript sources — the daemon jiti-loads them |
| `lib/**` | TypeScript sources, tests excluded |
| `node_modules/jiti` | devDependency, staged explicitly |

| Pruned | Why |
|--------|-----|
| `node_modules/next` | only `next/server` is imported, and it is shimmed |
| `.next/` | server bundles + static are Next-only |
| `server.js` | the Next standalone entry |

`electron-after-pack.mjs` asserts the payload landed, because a missing piece
makes `useDaemonRuntime()` fall through to Next silently rather than failing.

`PI_WEB_KEEP_NEXT=1` keeps the Next server for a fallback build.
**Removal condition:** delete that switch once a daemon-only release has shipped.

### jiti transpile cache

Pinned to `<agentDir>/cache/jiti` (`daemon/server.mjs`). jiti's own default is
`node_modules/.cache` falling back to the OS temp dir — the first is read-only
under a per-machine Windows install, and the second is purged by Storage Sense.
Either fallback makes every cold start re-transpile every route it touches.

Measured on a staged package layout (79 routes, first three routes hit):

| | listen | first 3 route loads |
|---|---|---|
| cold cache | 15ms | 5405ms |
| warm cache | 12ms | 749ms |

`listen` is what the Electron health probe waits on, so the splash clears in
milliseconds either way; transpile cost is lazy and per-route.

## Dev commands

```bash
npm run desktop:build     # Vite → desktop-dist
npm run daemon            # API + static on 30142
npm run electron          # prefers daemon when desktop-dist present
PI_WEB_RUNTIME=next npm run electron   # old path
```
