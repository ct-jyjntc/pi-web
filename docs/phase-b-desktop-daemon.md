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

## Packaging (follow-up)

`build:electron` must stop requiring Next standalone as the desktop server. Ship:

- `daemon/`
- `desktop-dist/`
- pruned `node_modules` needed by `lib/**` + pi SDK (not `next`)
- bundled Node + pi CLI (existing)

## Dev commands

```bash
npm run desktop:build     # Vite → desktop-dist
npm run daemon            # API + static on 30142
npm run electron          # prefers daemon when desktop-dist present
PI_WEB_RUNTIME=next npm run electron   # old path
```
