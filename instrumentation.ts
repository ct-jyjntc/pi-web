export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // Packages that spawn child Pi processes must not use Electron as node.
  const { ensureSubagentSpawnEnv } = await import("@/lib/resolve-pi-cli");
  ensureSubagentSpawnEnv();

  // Subagent delegation assets (managed AGENTS.md block + agent overrides).
  // Synchronous, idempotent, never throws — deploy before any session starts so
  // the subagent tool description picks up the proactive trigger language.
  const { ensureSubagentDelegation } = await import("@/lib/ensure-subagent-delegation");
  for (const note of ensureSubagentDelegation()) console.log(`[pi-web] ${note}`);

  // Builtin packages: install missing + later upgrade to latest — all in background.
  // Must never block / crash process boot (void + internal try/catch).
  const { ensureBuiltinPackages } = await import("@/lib/ensure-builtin-packages");
  void ensureBuiltinPackages()
    .then((r) => {
      for (const note of r.notes) console.log(`[pi-web] ${note}`);
      if (r.installed.length) console.log(`[pi-web] Builtin packages installed: ${r.installed.join(", ")}`);
      if (r.updated.length) console.log(`[pi-web] Builtin packages updated: ${r.updated.join(", ")}`);
    })
    .catch((error) => {
      console.error("[pi-web] ensureBuiltinPackages background error:", error);
    });
}
