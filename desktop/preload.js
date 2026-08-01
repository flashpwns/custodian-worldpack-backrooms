"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const operations = ["getAppInfo", "listModes", "listWorlds", "createWorld", "loadWorld", "saveWorld", "deleteWorld", "exportWorld", "importWorld", "renameWorld", "restoreBackup", "exportBrokenWorld", "getSettings", "updateSettings", "getProviderStatus", "configureOpenAI", "removeOpenAIKey", "testProvider", "getDiagnostics", "getDeveloperSnapshot", "traceDeveloperIntent", "startSession", "resumeSession", "getGameplayProjection", "getInstitutionProjection", "getAvailableActions", "submitAction", "submitNatural", "submitQ4Communication", "chooseExportWorld", "chooseImportWorld", "openLogFolder"];
const api = Object.fromEntries(operations.map((name) => [name, (input = {}) => ipcRenderer.invoke(`yellow-beast:${name}`, input)]));
contextBridge.exposeInMainWorld("yellowBeast", Object.freeze(api));
