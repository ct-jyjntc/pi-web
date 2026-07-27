"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piDesktop", {
  selectDirectory: () => ipcRenderer.invoke("pi-desktop:select-directory"),
  setTheme: (theme) => ipcRenderer.invoke("pi-desktop:set-theme", theme),
  windowMinimize: () => ipcRenderer.invoke("pi-desktop:window-minimize"),
  windowMaximizeToggle: () => ipcRenderer.invoke("pi-desktop:window-maximize-toggle"),
  windowClose: () => ipcRenderer.invoke("pi-desktop:window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("pi-desktop:window-is-maximized"),
  windowState: () => ipcRenderer.invoke("pi-desktop:window-state"),
  onWindowStateChange: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("pi-desktop:window-state", handler);
    return () => {
      ipcRenderer.removeListener("pi-desktop:window-state", handler);
    };
  },
  isDesktop: true,
  platform: process.platform,
});
