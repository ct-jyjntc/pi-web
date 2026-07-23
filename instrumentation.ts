export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // Packages that spawn child Pi processes (optional user plugins) must not use
  // Electron as process.execPath inside the desktop app.
  const { ensureSubagentSpawnEnv } = await import("@/lib/resolve-pi-cli");
  ensureSubagentSpawnEnv();
}
