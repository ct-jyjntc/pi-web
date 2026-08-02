export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Keep the critical path tiny: proxy + dispatcher + spawn env + managed AGENTS.md.
  // Heavy extension prewarm is deferred so the first Electron health/page request
  // does not fight disk/CPU with SDK + extension factory loads (big on Windows).
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
  // Uses local getAgentDir (no pi SDK import) so this stays cheap on cold boot.
  const { ensureSubagentDelegation } = await import("@/lib/ensure-subagent-delegation");
  for (const note of ensureSubagentDelegation()) console.log(`[pi-web] ${note}`);

  // Builtin extensions: migrate settings off package-manager ownership, then
  // prewarm heavy factories. Deferred so first HTTP wins on Windows cold start.
  // Never npm install/update. Must never crash process boot.
  const prewarmDelayMs = (() => {
    const raw = process.env.PI_WEB_PREWARM_DELAY_MS;
    if (raw == null || raw === "") return 2_000;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 2_000;
  })();

  const runPrewarm = () => {
    void import("@/lib/ensure-builtin-packages")
      .then(({ ensureBuiltinPackages }) => ensureBuiltinPackages())
      .then((r) => {
        for (const note of r.notes) console.log(`[pi-web] ${note}`);
        if (r.missing.length) {
          console.warn(`[pi-web] Builtin extensions missing from app install: ${r.missing.join(", ")}`);
        }
      })
      .catch((error) => {
        console.error("[pi-web] ensureBuiltinPackages background error:", error);
      });
  };

  if (prewarmDelayMs === 0) {
    runPrewarm();
  } else {
    const timer = setTimeout(runPrewarm, prewarmDelayMs);
    // Don't keep the process alive solely for prewarm (helps clean test exits).
    timer.unref?.();
  }
}
