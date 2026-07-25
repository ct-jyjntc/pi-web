"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const net = require("net");
const fs = require("fs");

const HOST = "127.0.0.1";
const isPackaged = app.isPackaged;
// Prefer a dedicated Electron port so we don't fight the browser `next dev` instance.
const PREFERRED_PORT = Number(process.env.PI_WEB_ELECTRON_PORT || process.env.PI_WEB_PORT || 30142);

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
/** @type {import('electron').UtilityProcess | import('child_process').ChildProcess | null} */
let serverProcess = null;
let quitting = false;
let activePort = PREFERRED_PORT;

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

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, attemptsLeft) => {
      const server = net.createServer();
      server.unref();
      server.on("error", () => {
        if (attemptsLeft <= 0) {
          reject(new Error(`No free port near ${startPort}`));
          return;
        }
        tryPort(port + 1, attemptsLeft - 1);
      });
      server.listen(port, HOST, () => {
        server.close(() => resolve(port));
      });
    };
    tryPort(startPort, 30);
  });
}

function probeServer(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: HOST, port, path: "/", timeout: 1200 },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForServer(port, timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = async () => {
      if (await probeServer(port)) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for pi-web on http://${HOST}:${port}`));
        return;
      }
      setTimeout(tryOnce, 400);
    };
    tryOnce();
  });
}

function hasProductionBuild() {
  if (isPackaged) {
    return fs.existsSync(path.join(appRoot, "server.js"));
  }
  return fs.existsSync(path.join(appRoot, ".next", "BUILD_ID"));
}

function attachServerExitHandler(child) {
  child.on("exit", (code) => {
    serverProcess = null;
    if (!quitting && code && code !== 0) {
      console.error(`Next.js server exited (code=${code})`);
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

function startNextServer(port) {
  if (!hasProductionBuild()) {
    throw new Error(
      isPackaged
        ? "Packaged server bundle missing (resources/standalone/server.js)."
        : "No production build found.\n\nRun this first:\n  npm run build\n\nThen start Electron again:\n  npm run electron",
    );
  }

  const bundledNode = resolveBundledNodeBinary();
  const bundledBinDir = bundledNode ? path.dirname(bundledNode) : null;
  const bundledPi = bundledBinDir
    ? path.join(bundledBinDir, process.platform === "win32" ? "pi.cmd" : "pi")
    : null;

  const env = augmentPathForNodeTools({
    ...process.env,
    PORT: String(port),
    HOSTNAME: HOST,
    PI_WEB_NO_OPEN: "1",
    BROWSER: "none",
    NODE_ENV: "production",
    // Point child tools at the runtime we ship (Node / pi). Git always uses the system install
    // so macOS Keychain / credential helpers work for https remotes.
    ...(bundledNode ? { PI_WEB_NODE: bundledNode, PI_WEB_BUNDLE_NODE_BINARY: bundledNode } : {}),
    ...(bundledPi && fs.existsSync(bundledPi)
      ? { PI_WEB_PI_BINARY: bundledPi, PI_SUBAGENT_PI_BINARY: bundledPi }
      : {}),
    // Never set ELECTRON_RUN_AS_NODE on a spawn of process.execPath — that
    // creates a second Dock icon labeled "exec" on macOS.
  });
  delete env.ELECTRON_RUN_AS_NODE;
  // Ensure we never inherit a packaged portable-git override.
  delete env.PI_WEB_GIT_BINARY;
  delete env.GIT_EXEC_PATH;
  delete env.GIT_TEMPLATE_DIR;

  // Prefer app-local bin/ on PATH so `pi`, `node`, `npm` resolve to bundled tools.
  // System `git` stays on PATH after that (not overridden).
  if (bundledBinDir) {
    const pathKey = process.platform === "win32" ? "Path" : "PATH";
    const sep = process.platform === "win32" ? ";" : ":";
    const parts = String(env[pathKey] || "").split(sep).filter(Boolean);
    if (!parts.includes(bundledBinDir)) parts.unshift(bundledBinDir);
    env[pathKey] = parts.join(sep);
  }

  if (isPackaged) {
    const serverEntry = path.join(appRoot, "server.js");
    // Self-contained runtime: always prefer the Node binary we ship inside the
    // app (bundled at package time). End users should only need Pi Web + pi CLI.
    const runtimeNode = resolveBundledNodeBinary() || resolveNodeBinary();
    const useBundledNode =
      runtimeNode &&
      runtimeNode !== process.execPath &&
      !/Electron\.app/i.test(runtimeNode) &&
      (path.isAbsolute(runtimeNode) ? fs.existsSync(runtimeNode) : true);

    if (useBundledNode) {
      console.log(`[electron] Starting standalone via bundled Node (${runtimeNode}) on http://${HOST}:${port}`);
      const child = spawn(runtimeNode, [serverEntry], {
        cwd: appRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
      child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
      attachServerExitHandler(child);
      serverProcess = child;
      return child;
    }

    // Last resort: Electron utilityProcess (no system Node). Native modules like
    // node-pty may fail under Electron's ABI — terminal features degrade.
    console.warn("[electron] Bundled Node missing; falling back to utilityProcess (terminal may not work)");
    const child = utilityProcess.fork(serverEntry, [], {
      cwd: appRoot,
      env,
      stdio: "pipe",
      serviceName: "pi-web-server",
    });
    child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    attachServerExitHandler(child);
    serverProcess = child;
    return child;
  }

  // Unpackaged: use system Node + next start (dev workflow).
  const nextBin = resolveNextBin();
  const nodeBin = resolveNodeBinary();
  console.log(`[electron] Starting Next.js production server on http://${HOST}:${port}`);
  const child = spawn(nodeBin, [nextBin, "start", "-p", String(port), "-H", HOST], {
    cwd: appRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  attachServerExitHandler(child);
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

function createWindow(port) {
  const isMac = process.platform === "darwin";

  const iconPath = path.join(
    __dirname,
    "icons",
    process.platform === "win32" ? "icon.ico" : process.platform === "darwin" ? "icon.icns" : "icon.png",
  );

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Pi Web",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: "#f5f5f3",
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
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#f5f5f3",
            symbolColor: "#1a1a1a",
            height: 36,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("did-fail-load", code, desc, url);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const url = `http://${HOST}:${port}`;
  mainWindow.loadURL(url).catch((err) => {
    console.error("Failed to load", url, err);
  });
}

async function bootstrap() {
  activePort = await findFreePort(PREFERRED_PORT);
  startNextServer(activePort);
  await waitForServer(activePort);
  createWindow(activePort);
}

ipcMain.handle("pi-desktop:select-directory", async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

app.whenReady().then(() => {
  // Do NOT call dock.setIcon(png) — flat PNG overrides the macOS icns mask
  // and produces the unmasked "π only" dock icon. Bundle icon.icns is enough.

  bootstrap().catch((err) => {
    console.error(err);
    dialog.showErrorBox("Pi Web failed to start", String(err?.message || err));
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!serverProcess) {
        bootstrap().catch((err) => console.error(err));
      } else {
        createWindow(activePort);
      }
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on("before-quit", () => {
  quitting = true;
  stopNextServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
