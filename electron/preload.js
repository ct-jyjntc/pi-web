"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piDesktop", {
  selectDirectory: () => ipcRenderer.invoke("pi-desktop:select-directory"),
  isDesktop: true,
  platform: process.platform,
});
