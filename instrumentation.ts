export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // Packages that spawn child Pi processes must not use Electron as node.
  const { ensureSubagentSpawnEnv } = await import("@/lib/resolve-pi-cli");
  ensureSubagentSpawnEnv();

  // Preinstall first-party pi packages into ~/.pi/agent (idempotent).
  const { ensureBuiltinPackages } = await import("@/lib/ensure-builtin-packages");
  void ensureBuiltinPackages().then((r) => {
    for (const note of r.notes) console.log(`[pi-web] ${note}`);
  });
}
