"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");
const { DesktopService } = require("./service");

let windowRef; let service;
function logger(message) { const log = path.join(app.getPath("userData"), "logs", "desktop.log"); fs.mkdirSync(path.dirname(log), { recursive: true }); fs.appendFileSync(log, `${new Date().toISOString()} ${message}\n`); }
const handlers = ["getAppInfo", "listModes", "listWorlds", "createWorld", "loadWorld", "saveWorld", "deleteWorld", "exportWorld", "importWorld", "getSettings", "updateSettings", "startSession", "resumeSession", "getGameplayProjection", "getInstitutionProjection", "getAvailableActions", "submitAction"];
function createWindow() { windowRef = new BrowserWindow({ width: 1180, height: 760, minWidth: 820, minHeight: 600, show: false, webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } }); windowRef.once("ready-to-show", () => windowRef.show()); windowRef.loadFile(path.join(__dirname, "renderer", "index.html")); }
app.whenReady().then(() => { service = new DesktopService({ appDataPath: path.join(app.getPath("userData"), "yellow-beast"), logger }); for (const name of handlers) ipcMain.handle(`yellow-beast:${name}`, (_event, input = {}) => service[name](input)); createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on("before-quit", () => { try { service?.shutdown(); } catch (error) { logger(`shutdown failure: ${error.message}`); } });
