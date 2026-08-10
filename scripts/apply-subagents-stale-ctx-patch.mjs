#!/usr/bin/env node
/**
 * Apply the stale-ctx guard to @gotgenes/pi-subagents sources.
 *
 * Why: the pi SDK invalidates an extension ctx once its session is disposed
 * or replaced (fork/reload), and AgentSession.dispose() does NOT emit
 * session_shutdown — so background work owned by the extension instance (the
 * retention sweep's unref'd 60s timer, a still-running subagent's terminal
 * callbacks) can outlive the owning session. The next pi.* call on the stale
 * ctx throws an uncaught error from inside that timer/promise callback and
 * kills the whole heavy runtime process (code=1) — surfaced in Pi Web as
 * "The local server exited unexpectedly (code=1)".
 *
 * This patch routes the three background pi calls — events.emit (lifecycle
 * events), appendEntry (terminal record persistence) and sendMessage
 * (completion nudges) — through a guard that drops ONLY the stale-ctx error
 * (a terminal event after session teardown is meaningless — its observers are
 * gone with the session) and rethrows anything else, so genuine bugs still
 * surface.
 *
 * Idempotent: re-running is a no-op (also upgrades the earlier emit-only
 * version of this patch). Verification is strict — if the expected source
 * lines are missing (upstream changed), the patch fails loudly instead of
 * half-applying.
 *
 * Removal condition: drop this script (and its call in
 * bundle-builtin-extensions.mjs) once @gotgenes/pi-subagents ships a fix
 * that stops background pi.* calls on a stale ctx from throwing uncaught
 * (tracked upstream at gotgenes/pi-packages).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexTs = join(
  root,
  "node_modules",
  "@gotgenes",
  "pi-subagents",
  "src",
  "index.ts",
);

const NEW_GUARD_MARKER = "const safeSendMessage = staleGuard(";

/** Guard block inserted after the factory opening (no factory line itself). */
const GUARD_BLOCK = `  // ---- Stale-ctx guard for background pi calls (pi-web patch) ----
  // The SDK invalidates this extension ctx once the owning session is
  // disposed or replaced (fork/reload) and never emits session_shutdown on
  // AgentSession.dispose(), so background work owned by this instance (the
  // retention sweep's 60s timer, a still-running subagent's terminal
  // callbacks) can outlive the session. Calling pi.* on a stale ctx throws an
  // uncaught error from inside that timer/promise and kills the whole heavy
  // runtime process (code=1). Terminal events after session teardown are
  // meaningless — drop only the stale-ctx error and rethrow anything else.
  const staleGuard =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R | undefined => {
      try {
        return fn(...args);
      } catch (err) {
        if (err instanceof Error && err.message.includes("stale after session replacement")) return undefined;
        throw err;
      }
    };
  const safeEmit = staleGuard((channel: string, data: unknown) => pi.events.emit(channel, data));
  const safeSendMessage = staleGuard((msg: string, opts?: unknown) => pi.sendMessage(msg, opts));
  const safeAppendEntry = staleGuard((type: string, data: unknown) => pi.appendEntry(type, data));
`;

/** Full replacement for a pristine factory opening (fresh application). */
const HELPER = `export default function (pi: ExtensionAPI) {
${GUARD_BLOCK}`;

/** The earlier emit-only version of this patch (upgrade target). */
const OLD_HELPER =
  `  // ---- Stale-ctx guard for lifecycle events (pi-web patch) ----
  // The SDK invalidates this extension ctx once the owning session is
  // disposed or replaced (fork/reload) and never emits session_shutdown on
  // dispose, so the retention sweep's 60s timer can outlive the session. A
  // release that then emits on the stale ctx would throw an uncaught error
  // from inside the timer callback and kill the runtime process (code=1).
  // Terminal events after session teardown are meaningless — drop only the
  // stale-ctx error and rethrow anything else.
  const safeEmit = (channel: string, data: unknown): void => {
    try {
      pi.events.emit(channel, data);
    } catch (err) {
      if (err instanceof Error && err.message.includes("stale after session replacement")) return;
      throw err;
    }
  };
`;

/**
 * Ordered source replacements — pristine form → guarded form. Each line may
 * already be in the guarded form (idempotent re-run), but must be one of the
 * two, or the patch fails.
 */
const REPLACEMENTS = [
  // NotificationManager nudge path (pi.sendMessage).
  [
    "(msg, opts) => pi.sendMessage(msg, opts),",
    "(msg, opts) => safeSendMessage(msg, opts),",
  ],
  // Settings events (user-driven; guarded for consistency).
  [
    "emit: (event, payload) => pi.events.emit(event, payload),",
    "emit: (event, payload) => safeEmit(event, payload),",
  ],
  // SubagentEventsObserver dispatch (background lifecycle notifications).
  [
    "emit: (channel, data) => pi.events.emit(channel, data),",
    "emit: (channel, data) => safeEmit(channel, data),",
  ],
  // SubagentEventsObserver terminal-record persistence (pi.appendEntry).
  [
    "appendEntry: (customType, data) => pi.appendEntry(customType, data),",
    "appendEntry: (customType, data) => safeAppendEntry(customType, data),",
  ],
  // ChildLifecyclePublisher (retention-sweep dispose path — the crash).
  [
    "lifecycle: createChildLifecyclePublisher((channel, data) => pi.events.emit(channel, data)),",
    "lifecycle: createChildLifecyclePublisher((channel, data) => safeEmit(channel, data)),",
  ],
];

/**
 * Apply the guard to the pi-subagents sources. Returns true when applied (or
 * already applied), throws when the sources no longer match expectations.
 */
export function applySubagentsStaleCtxPatch() {
  let source = readFileSync(indexTs, "utf8");

  if (source.includes(NEW_GUARD_MARKER)) {
    console.log("[subagents-patch] stale-ctx guard already applied, skipping");
    return true;
  }

  // Upgrade the earlier emit-only guard, or insert the full guard fresh.
  if (source.includes(OLD_HELPER)) {
    source = source.replace(OLD_HELPER, GUARD_BLOCK);
  } else if (!source.includes("const staleGuard =")) {
    if (!source.includes("export default function (pi: ExtensionAPI) {")) {
      throw new Error(`[subagents-patch] factory opening not found in ${indexTs}`);
    }
    source = source.replace("export default function (pi: ExtensionAPI) {", HELPER);
  }

  // Idempotent per-line upgrade: pristine form → guarded form, or accept the
  // guarded form already in place. Anything else means upstream changed.
  for (const [from, to] of REPLACEMENTS) {
    if (source.includes(from)) {
      source = source.split(from).join(to);
    } else if (!source.includes(to)) {
      throw new Error(
        `[subagents-patch] expected source line not found in ${indexTs}:\n  ${from}\n` +
          "pi-subagents sources changed upstream — re-check the patch before bundling.",
      );
    }
  }

  writeFileSync(indexTs, source);
  console.log("[subagents-patch] stale-ctx guard (emit/appendEntry/sendMessage) applied to pi-subagents");
  return true;
}

// CLI entry: `node scripts/apply-subagents-stale-ctx-patch.mjs`
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  applySubagentsStaleCtxPatch();
}
