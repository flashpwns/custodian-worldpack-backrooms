"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const operations = ["getAppInfo", "listModes", "listWorlds", "createWorld", "loadWorld", "saveWorld", "deleteWorld", "exportWorld", "importWorld", "getSettings", "updateSettings", "startSession", "resumeSession", "getGameplayProjection", "getInstitutionProjection", "getAvailableActions", "submitAction"];
const api = Object.fromEntries(operations.map((name) => [name, (input = {}) => ipcRenderer.invoke(`yellow-beast:${name}`, input)]));
contextBridge.exposeInMainWorld("yellowBeast", Object.freeze(api));
