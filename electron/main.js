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

function resolveNodeBinary() {
  // Only used for unpackaged dev — never spawn process.execPath (creates Dock "exec" icon).
  if (process.env.npm_node_execpath && fs.existsSync(process.env.npm_node_execpath)) {
    return process.env.npm_node_execpath;
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

function startNextServer(port) {
  if (!hasProductionBuild()) {
    throw new Error(
      isPackaged
        ? "Packaged server bundle missing (resources/standalone/server.js)."
        : "No production build found.\n\nRun this first:\n  npm run build\n\nThen start Electron again:\n  npm run electron",
    );
  }

  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: HOST,
    PI_WEB_NO_OPEN: "1",
    BROWSER: "none",
    NODE_ENV: "production",
    // Never set ELECTRON_RUN_AS_NODE on a spawn of process.execPath — that
    // creates a second Dock icon labeled "exec" on macOS.
  };
  delete env.ELECTRON_RUN_AS_NODE;

  if (isPackaged) {
    // utilityProcess is a Node child of Electron — no separate Dock icon.
    const serverEntry = path.join(appRoot, "server.js");
    console.log(`[electron] Starting standalone via utilityProcess on http://${HOST}:${port}`);
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
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 14, y: 12 },
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
