"use strict";

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { isTraySupported, ensureTray, destroyTray } = require("./tray");
const { registerAppScheme, serveAppProtocol, APP_ORIGIN } = require("./app-protocol");
const { startRuntime, registerApiBridge, getRuntimeProcess } = require("./runtime-host");

// The renderer is served locally over app://; the agent runtime is a private
// child process reached over IPC. Must be called before app.whenReady().
registerAppScheme();

const isPackaged = app.isPackaged;
/**
 * Must match package.json build.appId / electron-builder Start Menu shortcut.
 * A mismatch on Windows makes toast clicks launch a bare electron.exe
 * (default "To run a local app…" window) and taskbar may show the stock atom icon.
 */
const APP_USER_MODEL_ID = "com.ct-jyjntc.pi-web";

// Windows identity must be set before ready (and before any BrowserWindow / Notification).
if (process.platform === "win32") {
  try {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  } catch {
    // ignore
  }
}
try {
  app.setName("Pi Web");
} catch {
  // ignore
}

// ── File logging ────────────────────────────────────────────────────────────
// A packaged GUI build has nowhere for stdout to go, which makes cold-start
// regressions unmeasurable — the boot timings below would vanish. Mirror main
// process logs (and the spawned server's output) into app logs/main.log.
/** @type {import('fs').WriteStream | null} */
let logStream = null;
let logFilePath = null;

function formatLogArg(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Raw passthrough for child-process chunks (already formatted lines). */
function appendServerLog(chunk) {
  if (!logStream) return;
  try {
    logStream.write(chunk);
  } catch {
    // Logging must never break the app.
  }
}

function initFileLogging() {
  if (logStream) return logFilePath;
  try {
    const dir = app.getPath("logs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "main.log");
    // Keep it readable across runs instead of growing without bound.
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
        fs.rmSync(file);
      }
    } catch {
      // ignore
    }
    logStream = fs.createWriteStream(file, { flags: "a" });
    logFilePath = file;
    logStream.write(`\n=== ${new Date().toISOString()} Pi Web start (packaged=${isPackaged}) ===\n`);
    for (const level of ["log", "warn", "error"]) {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        original(...args);
        if (!logStream) return;
        try {
          logStream.write(
            `${new Date().toISOString()} [${level}] ${args.map(formatLogArg).join(" ")}\n`,
          );
        } catch {
          // ignore
        }
      };
    }
    return file;
  } catch {
    // No writable log dir (portable install, locked profile) — stay silent.
    return null;
  }
}

initFileLogging();

// One running desktop app; second launches (toast activation, shortcut double-click) focus the first.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

/** Read ~/.pi/agent/pi-web.json (same file as lib/web-settings.ts). */
function readPiWebSettingsFile() {
  try {
    const agentDir = process.env.PI_CODING_AGENT_DIR
      || path.join(os.homedir(), ".pi", "agent");
    const file = path.join(agentDir, "pi-web.json");
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function applyNetworkEnvFromSettings(targetEnv, settings) {
  const proxy = typeof settings.httpProxy === "string" ? settings.httpProxy.trim() : "";
  const bypass = typeof settings.proxyBypass === "string" ? settings.proxyBypass.trim() : "";
  const ca = typeof settings.customCaCerts === "string" ? settings.customCaCerts.trim() : "";
  if (proxy) {
    targetEnv.HTTP_PROXY = proxy;
    targetEnv.http_proxy = proxy;
    targetEnv.HTTPS_PROXY = proxy;
    targetEnv.https_proxy = proxy;
    targetEnv.ALL_PROXY = proxy;
    targetEnv.all_proxy = proxy;
    const noProxy = bypass || "localhost,127.0.0.1,::1";
    targetEnv.NO_PROXY = noProxy;
    targetEnv.no_proxy = noProxy;
  }
  if (ca && fs.existsSync(ca)) {
    targetEnv.NODE_EXTRA_CA_CERTS = ca;
  }
  return targetEnv;
}

// GPU / Chromium flags must be set before app ready.
{
  const early = readPiWebSettingsFile();
  if (early.disableHardwareAcceleration === true) {
    try {
      app.disableHardwareAcceleration();
      console.log("[electron] Hardware acceleration disabled (pi-web.json)");
    } catch (e) {
      console.warn("[electron] disableHardwareAcceleration failed:", e);
    }
  }
  // Apply proxy/CA to this process so Chromium network respects them where possible.
  applyNetworkEnvFromSettings(process.env, early);

  // Windows cold-start tweaks (safe no-ops elsewhere). Must run before ready.
  if (process.platform === "win32") {
    try {
      // Avoid occlusion polling that can stall renderer show on some GPUs/VMs.
      app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
      // Slightly cheaper background timer coalescing while the shell is coming up.
      app.commandLine.appendSwitch("disable-renderer-backgrounding");
    } catch {
      // ignore
    }
  }
}
// Prefer a dedicated Electron port so we don't fight the browser `next dev` instance.

/**
 * Dev (unpackaged): project root.
 * Packaged: standalone Next server lives in resources/standalone.
 */
function getAppRoot() {
  if (!isPackaged) return path.join(__dirname, "..");
  return path.join(process.resourcesPath, "standalone");
}

const appRoot = getAppRoot();

let mainWindow = null;
/** Separate splash window so the main webContents can load React under the hood
 *  without ever flashing a blank white page in front of the user. */
let splashWindow = null;
/** True while first boot is waiting for the renderer to signal UI paint. */
let bootRevealPending = false;
/** @type {{ resolve: (reason: string) => void } | null} */
let pendingUiReady = null;
/** @type {import('electron').UtilityProcess | import('child_process').ChildProcess | null} */
let serverProcess = null;
let quitting = false;
/** @type {'light' | 'dark'} */
let windowTheme = "light";

/** Match app/globals.css bg tokens so the window flash matches the UI. */
function themeBackground(theme) {
  // Approximate --bg light oklch(0.995) / dark oklch(0.13)
  return theme === "dark" ? "#212121" : "#f5f5f3";
}

function applyWindowTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  windowTheme = next;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setBackgroundColor(themeBackground(next));
  } catch {
    // ignore
  }
}

function getWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { maximized: false, minimized: false, focused: false, fullscreen: false };
  }
  return {
    maximized: mainWindow.isMaximized(),
    minimized: mainWindow.isMinimized(),
    focused: mainWindow.isFocused(),
    fullscreen: mainWindow.isFullScreen(),
  };
}

function broadcastWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state = getWindowState();
  try {
    mainWindow.webContents.send("pi-desktop:window-state", state);
  } catch {
    // ignore
  }
}

/** Restore the main window (tray click / activate). Page state is preserved because hide ≠ destroy. */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (serverProcess) {
      bootRevealPending = false;
      createWindow({ showWhenReady: true });
    }
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  broadcastWindowState();
}

/** Hide to tray instead of quitting. Keeps BrowserWindow + renderer session alive. */
function hideMainWindowToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  ensureAppTray();
  broadcastWindowState();
}

function ensureAppTray() {
  if (!isTraySupported()) return;
  ensureTray({
    showMainWindow,
    quitApp: () => {
      quitting = true;
      app.quit();
    },
  });
}

function resolveNextBin() {
  try {
    return require.resolve("next/dist/bin/next", { paths: [appRoot] });
  } catch {
    const fallback = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");
    if (fs.existsSync(fallback)) return fallback;
    throw new Error("Could not resolve next binary. Run npm install first.");
  }
}

function resolveBundledNodeBinary() {
  // Packaged apps ship Node next to the standalone server so end users do not
  // need a system Node install. See scripts/bundle-runtime-node.mjs.
  const name = process.platform === "win32" ? "node.exe" : "node";
  const candidates = [
    path.join(appRoot, "bin", name),
    // Some layouts nest standalone under resources differently
    isPackaged ? path.join(process.resourcesPath, "standalone", "bin", name) : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function resolveNodeBinary() {
  // Prefer the app-bundled Node (packaged self-contained runtime).
  const bundled = resolveBundledNodeBinary();
  if (bundled) return bundled;

  // Dev / unpackaged: use the developer's Node. Never Electron as node
  // (Dock "exec" icon + wrong ABI for native modules).
  if (process.env.npm_node_execpath && fs.existsSync(process.env.npm_node_execpath)) {
    return process.env.npm_node_execpath;
  }

  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    process.env.PI_WEB_NODE_BINARY,
    process.env.PI_WEB_BUNDLE_NODE_BINARY,
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    home ? path.join(home, ".local/bin/node") : "",
    home ? path.join(home, ".nvm/current/bin/node") : "",
    home ? path.join(home, ".fnm/current/bin/node") : "",
    home ? path.join(home, ".volta/bin/node") : "",
    home ? path.join(home, ".asdf/shims/node") : "",
    process.platform === "win32" ? "node.exe" : "node",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) || candidate.includes("/") || candidate.includes("\\")) {
        if (fs.existsSync(candidate) && !/Electron\.app/i.test(candidate)) return candidate;
      } else {
        return candidate;
      }
    } catch {
      // try next
    }
  }
  return process.platform === "win32" ? "node.exe" : "node";
}


/** Lightweight readiness path — avoids rendering the full AppShell on probe. */



function splashDataUrl(theme, subtitle = "Starting local server…") {
  const bg = themeBackground(theme);
  const fg = theme === "dark" ? "#e8e8e6" : "#1a1a18";
  const muted = theme === "dark" ? "#9a9a96" : "#6b6b66";
  const bar = theme === "dark" ? "#6b6b66" : "#b0b0aa";
  const safeSub = String(subtitle).replace(/[<>&]/g, (c) => (
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c
  ));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${theme === "dark" ? "dark" : "light"}"><style>
html,body{margin:0;height:100%;background:${bg};color:${fg};font-family:"Segoe UI",system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;user-select:none;-webkit-app-region:drag}
.wrap{text-align:center;padding:24px}
.title{font-size:18px;font-weight:600;letter-spacing:0.02em}
.sub{margin-top:10px;font-size:12px;color:${muted}}
.bar{margin:22px auto 0;width:132px;height:3px;border-radius:999px;background:${muted}33;overflow:hidden}
.bar>i{display:block;height:100%;width:36%;background:${bar};border-radius:999px;animation:slide 1.05s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-120%)}100%{transform:translateX(340%)}}
</style></head><body><div class="wrap"><div class="title">Pi Web</div><div class="sub">${safeSub}</div><div class="bar"><i></i></div></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function resolveUiReady(reason) {
  if (!pendingUiReady) return;
  const pending = pendingUiReady;
  pendingUiReady = null;
  pending.resolve(reason);
}

/**
 * Wait until the UI is ready to show:
 *  - AppShell IPC `pi-desktop:ui-ready` (preferred, after paint), or
 *  - DOM poll finds the shell (works even if the production bundle is stale), or
 *  - timeout (never leave the user stuck on splash forever).
 */
function waitForRendererUiReady(timeoutMs = 45_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[electron] UI ready timed out after ${timeoutMs}ms — revealing anyway`);
      resolveUiReady("timeout");
    }, timeoutMs);
    pendingUiReady = {
      resolve: (reason) => {
        clearTimeout(timer);
        resolve(reason);
      },
    };
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fallback when the packaged/production JS is older than preload (no notifyUiReady).
 * Polls the hidden main window for a painted shell.
 */
async function pollDomShellUntilReady(win, timeoutMs = 45_000) {
  const started = Date.now();
  let attempts = 0;
  while (Date.now() - started < timeoutMs) {
    if (!pendingUiReady) return; // already resolved via IPC/timeout
    if (!win || win.isDestroyed()) {
      resolveUiReady("destroyed");
      return;
    }
    attempts += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const ready = await win.webContents.executeJavaScript(
        `(() => {
          try {
            if (document.querySelector(".sidebar-shell")) return true;
            if (document.querySelector(".app-topbar")) return true;
            const body = document.body;
            if (!body) return false;
            // Client shell mounted something visible (not a blank root)
            const text = (body.innerText || "").replace(/\\s+/g, " ").trim();
            return body.childElementCount > 0 && text.length > 12;
          } catch {
            return false;
          }
        })()`,
        true,
      );
      if (ready) {
        console.log(`[electron] DOM shell detected after ${Date.now() - started}ms (${attempts} polls)`);
        resolveUiReady("dom");
        return;
      }
    } catch {
      // Navigating / not yet scriptable
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(attempts < 20 ? 50 : 120);
  }
}



function getWindowIconPath() {
  return path.join(
    __dirname,
    "icons",
    process.platform === "win32" ? "icon.ico" : process.platform === "darwin" ? "icon.icns" : "icon.png",
  );
}

function createSplashWindow(subtitle = "Starting local server…") {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.loadURL(splashDataUrl(windowTheme, subtitle)).catch(() => {});
    return splashWindow;
  }

  const iconPath = getWindowIconPath();
  splashWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Pi Web",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: themeBackground(windowTheme),
    show: false,
    autoHideMenuBar: true,
    // Frameless splash matches the eventual custom chrome on Win/Linux.
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  splashWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
  splashWindow.loadURL(splashDataUrl(windowTheme, subtitle)).catch((err) => {
    // ERR_ABORTED (-3) when subtitle reloads replace the first navigation — not a real failure.
    if (err && (err.errno === -3 || err.code === "ERR_ABORTED")) return;
    console.error("Failed to load splash", err);
  });
  return splashWindow;
}

function setSplashSubtitle(subtitle) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.loadURL(splashDataUrl(windowTheme, subtitle)).catch(() => {});
}

function closeSplashWindow() {
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  try {
    splashWindow.close();
  } catch {
    // ignore
  }
  splashWindow = null;
}

/**
 * Reveal the (already painted) main window and drop the splash.
 * Main stays hidden until this runs so users never see the white React mount gap.
 */
function revealMainWindow(reason) {
  if (!bootRevealPending && mainWindow && mainWindow.isVisible()) {
    closeSplashWindow();
    return;
  }
  bootRevealPending = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Match splash geometry so the swap doesn't jump on screen.
    if (splashWindow && !splashWindow.isDestroyed()) {
      try {
        const bounds = splashWindow.getBounds();
        const wasMax = splashWindow.isMaximized();
        if (wasMax) mainWindow.maximize();
        else mainWindow.setBounds(bounds);
      } catch {
        // ignore
      }
    }
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  closeSplashWindow();
  console.log(`[electron] Revealed main window (${reason})`);
}


/** Phase B: lightweight daemon (no Next.js). See docs/desktop-architecture.md */
function hasDaemonEntry() {
  return fs.existsSync(path.join(appRoot, "daemon", "ipc-host.mjs"));
}

function hasDesktopUi() {
  return fs.existsSync(path.join(appRoot, "desktop-dist", "index.html"));
}


function attachServerExitHandler(child) {
  child.on("exit", (code) => {
    serverProcess = null;
    if (!quitting && code && code !== 0) {
      console.error(`Local server exited (code=${code})`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox(
          "Pi Web server stopped",
          `The local server exited unexpectedly (code=${code}).`,
        );
      }
    }
  });
}

/**
 * macOS GUI apps (Dock / Finder / packaged Electron) often inherit a minimal
 * PATH that does not include Homebrew / nvm / user-local npm. Plugin install
 * then fails with `spawn npm ENOENT`. Prepend common Node install locations.
 */
function augmentPathForNodeTools(baseEnv) {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const extras = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    home ? `${home}/.local/bin` : "",
    home ? `${home}/.hermes/node/bin` : "",
    home ? `${home}/.nvm/current/bin` : "",
    home ? `${home}/.fnm/current/bin` : "",
    home ? `${home}/.volta/bin` : "",
    home ? `${home}/.asdf/shims` : "",
  ].filter(Boolean);

  const sep = process.platform === "win32" ? ";" : ":";
  const current = baseEnv[pathKey] || process.env[pathKey] || "";
  const parts = current.split(sep).filter(Boolean);
  for (const dir of extras.reverse()) {
    if (fs.existsSync(dir) && !parts.includes(dir)) {
      parts.unshift(dir);
    }
  }

  // Resolve real `pi` CLI for plugins that spawn child agents (never Electron as node).
  const piCandidates = [
    baseEnv.PI_SUBAGENT_PI_BINARY,
    baseEnv.PI_WEB_PI_BINARY,
    "/opt/homebrew/bin/pi",
    "/usr/local/bin/pi",
    home ? `${home}/.local/bin/pi` : "",
  ].filter(Boolean);
  let piBinary = piCandidates.find((p) => fs.existsSync(p));
  if (!piBinary) {
    for (const dir of parts) {
      const cand = path.join(dir, "pi");
      if (fs.existsSync(cand)) {
        piBinary = cand;
        break;
      }
    }
  }

  const next = { ...baseEnv, [pathKey]: parts.join(sep) };
  if (piBinary) {
    next.PI_SUBAGENT_PI_BINARY = piBinary;
  }
  return next;
}

/**
 * Desktop agent runtime: node daemon/ipc-host.mjs (API over IPC, no HTTP).
 * Does not start Next.js.
 */
function startAgentRuntime() {
  if (!hasDaemonEntry()) {
    throw new Error(
      "Runtime entry missing (daemon/ipc-host.mjs).\n\nThis build expects the desktop agent runtime.",
    );
  }

  const daemonEntry = path.join(appRoot, "daemon", "ipc-host.mjs");
  const bundledNode = resolveBundledNodeBinary();
  const bundledBinDir = bundledNode ? path.dirname(bundledNode) : null;
  const bundledPi = bundledBinDir
    ? path.join(bundledBinDir, process.platform === "win32" ? "pi.cmd" : "pi")
    : null;

  const webSettings = readPiWebSettingsFile();
  const env = augmentPathForNodeTools({
    ...process.env,
    PI_WEB_NO_OPEN: "1",
    BROWSER: "none",
    NODE_ENV: "production",
    PI_WEB_RUNTIME: "daemon",
    PI_WEB_DESKTOP_DIST: path.join(appRoot, "desktop-dist"),
    ...(bundledNode ? { PI_WEB_NODE: bundledNode, PI_WEB_BUNDLE_NODE_BINARY: bundledNode } : {}),
    ...(bundledPi && fs.existsSync(bundledPi)
      ? { PI_WEB_PI_BINARY: bundledPi, PI_SUBAGENT_PI_BINARY: bundledPi }
      : {}),
  });
  applyNetworkEnvFromSettings(env, webSettings);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PI_WEB_GIT_BINARY;
  delete env.GIT_EXEC_PATH;
  delete env.GIT_TEMPLATE_DIR;

  if (bundledBinDir) {
    const pathKey = process.platform === "win32" ? "Path" : "PATH";
    const sep = process.platform === "win32" ? ";" : ":";
    const parts = String(env[pathKey] || "").split(sep).filter(Boolean);
    if (!parts.includes(bundledBinDir)) parts.unshift(bundledBinDir);
    env[pathKey] = parts.join(sep);
  }

  const runtimeNode = resolveBundledNodeBinary() || resolveNodeBinary();
  const child = startRuntime({
    entry: daemonEntry,
    cwd: appRoot,
    env,
    nodeBinary: runtimeNode,
    onLog: appendServerLog,
    onExit: attachServerExitHandler,
  });
  serverProcess = child;
  return child;
}


function stopNextServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  try {
    child.kill();
  } catch {
    // ignore
  }
  // ChildProcess supports SIGKILL; UtilityProcess.kill() is enough.
  if (typeof child.kill === "function") {
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 3000);
  }
}

/**
 * Create the main app BrowserWindow (not the splash).
 * During first boot (`bootRevealPending`) it stays hidden until the renderer
 * signals UI ready — that is what prevents the white gap after "Starting local server…".
 * @param {{ port?: number, showWhenReady?: boolean }} [opts]
 */
function createWindow(opts = {}) {
  const isMac = process.platform === "darwin";
  // Only auto-show on ready-to-show when we are NOT mid first-boot reveal.
  const showWhenReady = opts.showWhenReady === true || !bootRevealPending;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (showWhenReady && !mainWindow.isVisible()) mainWindow.show();
    return mainWindow;
  }

  const iconPath = getWindowIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Pi Web",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: themeBackground(windowTheme),
    show: false,
    autoHideMenuBar: true,
    ...(isMac
      ? {
          // Immersive chrome: traffic lights sit in the left of the 40px top strip
          // (matches --titlebar-height / --traffic-lights-pad in app/globals.css).
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 16, y: 13 },
        }
      : {
          // Fully custom caption buttons drawn by the renderer so colors match
          // --bg-panel / --text tokens (system titleBarOverlay cannot do that).
          frame: false,
        }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Windows taskbar sometimes keeps the host exe icon until setIcon runs explicitly.
  if (process.platform === "win32" && fs.existsSync(iconPath)) {
    try {
      mainWindow.setIcon(iconPath);
    } catch {
      // ignore
    }
  }

  mainWindow.once("ready-to-show", () => {
    // During boot the splash stays in front until AppShell notifies ui-ready.
    if (showWhenReady && mainWindow && !mainWindow.isDestroyed() && !bootRevealPending) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("did-fail-load", code, desc, url);
  });

  for (const eventName of ["maximize", "unmaximize", "minimize", "restore", "enter-full-screen", "leave-full-screen", "focus", "blur"]) {
    mainWindow.on(eventName, () => broadcastWindowState());
  }

  // All platforms: close (X / traffic-light red / Alt+F4) hides to tray instead of destroying.
  // Real quit goes through tray → Quit, Cmd+Q / app.quit (quitting=true skips this intercept).
  if (isTraySupported()) {
    mainWindow.on("close", (e) => {
      if (quitting) return;
      e.preventDefault();
      hideMainWindowToTray();
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Always the local bundle; there is no server to point at.
  mainWindow.loadURL(APP_ORIGIN).catch((err) => {
    console.error("Failed to load", APP_ORIGIN, err);
  });

  return mainWindow;
}

async function bootstrap() {
  // 1) Immediate splash (visible).
  // 2) Hidden main window loads React from app:// — no server involved.
  // 3) Reveal when IPC/DOM says the shell painted.
  //
  // The renderer no longer waits on the agent runtime to boot: its assets come
  // from the main process, so the runtime's multi-second SDK load can only delay
  // data, never rendering.
  bootRevealPending = true;
  createSplashWindow("Starting Pi…");

  const bootStarted = Date.now();
  serveAppProtocol(path.join(appRoot, "desktop-dist"));
  startAgentRuntime();
  console.log(`[electron] Agent runtime spawned in ${Date.now() - bootStarted}ms`);

  setSplashSubtitle("Loading workspace…");

  if (!hasDesktopUi()) {
    console.warn(
      "[electron] desktop-dist/index.html missing — run `npm run desktop:build` on this machine",
    );
  }

  const uiReady = waitForRendererUiReady(45_000);
  console.log(`[electron] Loading app UI at ${APP_ORIGIN}`);
  createWindow({ showWhenReady: false });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once("did-finish-load", () => {
      console.log(`[electron] Main document loaded in ${Date.now() - bootStarted}ms`);
      // DOM poll covers stale production bundles that lack notifyUiReady.
      void pollDomShellUntilReady(mainWindow, 45_000);
    });
    mainWindow.webContents.once("did-fail-load", (_e, code, desc, url) => {
      if (code === -3) return;
      console.error(`[electron] Main document failed (${code}) ${desc} ${url || ""}`);
      resolveUiReady(`load-failed:${code}`);
    });
  }

  const reason = await uiReady;
  console.log(`[electron] Renderer UI ready (${reason}) in ${Date.now() - bootStarted}ms`);
  revealMainWindow(reason);
}

// Fired by AppShell after first paint — unblocks boot splash reveal.
ipcMain.on("pi-desktop:ui-ready", () => {
  resolveUiReady("ready");
});

ipcMain.handle("pi-desktop:select-directory", async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("pi-desktop:set-theme", (_event, theme) => {
  applyWindowTheme(theme === "dark" ? "dark" : "light");
  return windowTheme;
});

ipcMain.handle("pi-desktop:window-minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle("pi-desktop:window-maximize-toggle", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return getWindowState();
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return getWindowState();
});

ipcMain.handle("pi-desktop:window-close", () => {
  // close event intercepts on all tray platforms → hide to tray.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.handle("pi-desktop:window-is-maximized", () => {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized());
});

ipcMain.handle("pi-desktop:window-state", () => getWindowState());

ipcMain.handle("pi-desktop:notify", (_event, payload = {}) => {
  try {
    if (!Notification.isSupported()) return { ok: false, reason: "unsupported" };
    const title = typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : "Pi Web";
    const body = typeof payload.body === "string" ? payload.body : "";
    // Settings "probe" passes force; normal agent-end toasts skip when the user is already looking.
    const force = payload.force === true;
    if (!force && mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (mainWindow.isVisible() && mainWindow.isFocused() && !mainWindow.isMinimized()) {
          return { ok: true, skipped: "focused" };
        }
      } catch {
        // fall through and show
      }
    }
    if (!force && !body.trim() && title === "Pi Web") {
      return { ok: false, reason: "empty" };
    }
    const iconPath = getWindowIconPath();
    // Focus window when user clicks the notification.
    const n = new Notification({
      title,
      body,
      silent: Boolean(payload.silent),
      timeoutType: "default",
      ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    });
    n.on("click", () => {
      showMainWindow();
    });
    // Electron 42+ macOS UNNotification: unsigned / linker-signed apps emit
    // `failed` instead of showing a banner (often UNErrorDomain error 1).
    n.on("failed", (_event, error) => {
      console.warn(
        "[electron] Notification failed (macOS needs real ad-hoc or Developer ID signature):",
        error,
      );
    });
    n.show();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("pi-desktop:get-web-settings-path", () => {
  const agentDir = process.env.PI_CODING_AGENT_DIR
    || path.join(os.homedir(), ".pi", "agent");
  return path.join(agentDir, "pi-web.json");
});

// second-instance can fire before whenReady finishes; showMainWindow is safe either way.
app.on("second-instance", () => {
  showMainWindow();
});

app.whenReady().then(() => {
  // Loser of the single-instance race must not boot another Next server / window.
  if (!gotSingleInstanceLock) {
    app.quit();
    return;
  }
  // Retry in case the pre-ready attempt had no resolvable log dir yet.
  const logPath = initFileLogging();
  if (logPath) console.log(`[electron] Logging to ${logPath}`);
  registerApiBridge(ipcMain);
  // AUMID + name are set at process start (see APP_USER_MODEL_ID). Re-assert on ready
  // in case a platform resets identity during startup.
  try {
    if (process.platform === "win32") {
      app.setAppUserModelId(APP_USER_MODEL_ID);
    }
    app.setName("Pi Web");
  } catch {
    // ignore
  }
  // Do NOT call dock.setIcon(png) — flat PNG overrides the macOS icns mask
  // and produces the unmasked "π only" dock icon. Bundle icon.icns is enough.

  // Best-effort initial caption colors before renderer localStorage is known.
  windowTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";

  // Tray ready from boot so close→hide has an icon waiting in the notification area.
  ensureAppTray();

  bootstrap().catch((err) => {
    console.error(err);
    dialog.showErrorBox("Pi Web failed to start", String(err?.message || err));
    quitting = true;
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!serverProcess) {
        bootstrap().catch((err) => console.error(err));
      } else {
        // Server already up — open main directly (no cold-start white gap).
        bootRevealPending = false;
        createWindow({ showWhenReady: true });
      }
    } else {
      showMainWindow();
    }
  });
});

app.on("before-quit", () => {
  quitting = true;
  destroyTray();
  stopNextServer();
});

app.on("window-all-closed", () => {
  // Close is intercepted to tray on every desktop platform, so this only runs
  // when the window was actually destroyed. Skip while tray is keeping us alive;
  // macOS also stays resident via Dock + activate.
  if (isTraySupported() && !quitting) return;
  if (process.platform === "darwin") return;
  app.quit();
});
