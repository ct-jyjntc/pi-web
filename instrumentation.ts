export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  // Apply Pi Web proxy prefs so undici EnvHttpProxyAgent + tool fetch honor them.
  try {
    const { readWebSettings } = await import("@/lib/web-settings");
    const prefs = readWebSettings();
    if (prefs.httpProxy) {
      process.env.HTTP_PROXY = prefs.httpProxy;
      process.env.HTTPS_PROXY = prefs.httpProxy;
    }
    if (prefs.proxyBypass) {
      process.env.NO_PROXY = prefs.proxyBypass;
    }
  } catch {
    // ignore missing settings on first boot
  }
  configureHttpDispatcher();

  // Packages that spawn child Pi processes must not use Electron as node.
  const { ensureSubagentSpawnEnv } = await import("@/lib/resolve-pi-cli");
  ensureSubagentSpawnEnv();

  // Subagent delegation assets (managed AGENTS.md block + agent overrides).
  // Synchronous, idempotent, never throws — deploy before any session starts so
  // the subagent tool description picks up the proactive trigger language.
  const { ensureSubagentDelegation } = await import("@/lib/ensure-subagent-delegation");
  for (const note of ensureSubagentDelegation()) console.log(`[pi-web] ${note}`);

  // Builtin extensions: migrate settings off package-manager ownership, then
  // prewarm jiti cache from app node_modules. Never npm install/update.
  // Must never block / crash process boot (void + internal try/catch).
  const { ensureBuiltinPackages } = await import("@/lib/ensure-builtin-packages");
  void ensureBuiltinPackages()
    .then((r) => {
      for (const note of r.notes) console.log(`[pi-web] ${note}`);
      if (r.missing.length) {
        console.warn(`[pi-web] Builtin extensions missing from app install: ${r.missing.join(", ")}`);
      }
    })
    .catch((error) => {
      console.error("[pi-web] ensureBuiltinPackages background error:", error);
    });
}
