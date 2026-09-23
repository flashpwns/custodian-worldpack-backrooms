"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const operations = ["getAppInfo", "listModes", "listWorlds", "createWorld", "loadWorld", "saveWorld", "deleteWorld", "exportWorld", "importWorld", "renameWorld", "restoreBackup", "exportBrokenWorld", "getSettings", "updateSettings", "getProviderStatus", "configureOpenAI", "removeOpenAIKey", "configureProvider", "removeProviderKey", "testProvider", "getDiagnostics", "exportTesterReport", "getDeveloperSnapshot", "traceDeveloperIntent", "controlQ4PhenomenonFixture", "getQ4PersonnelStatus", "createQ4Personnel", "confirmQ4Personnel", "startSession", "resumeSession", "getGameplayProjection", "getInstitutionProjection", "getAvailableActions", "submitAction", "submitNatural", "submitQ4Communication", "retryQ4Communication", "cancelQ4Communication", "submitQ4Handoff", "submitQ4Logistics", "selectQ4OptionalStore", "submitQ4CheckIn", "beginQ4CheckInHold", "completeQ4CheckInHold", "cancelQ4CheckInHold", "renderEvidence", "triggerCatastrophicEnding", "startBriefingBroadcast", "completeBriefingBroadcast", "startPersonnelBriefing", "interactPersonnelBriefing", "concludePersonnelBriefing", "getInferenceApplianceStatus", "installInferenceAppliance", "cancelInferenceApplianceInstall", "repairInferenceAppliance", "removeInferenceAppliance", "exportReportPdf", "chooseExportReportPdf", "chooseExportWorld", "chooseImportWorld", "openLogFolder", "exitApplication"];
const api = Object.fromEntries(operations.map((name) => [name, (input = {}) => ipcRenderer.invoke(`yellow-beast:${name}`, input)]));
// Pass 9C-2: the one main->renderer push channel in the app (everything
// else above is invoke/response only). Carries only { world_id } -- never
// dialogue content -- so the renderer must re-read through its existing
// getGameplayProjection path, not treat this payload as presentable state.
api.onProjectionChanged = (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on("yellow-beast:projectionChanged", listener);
  return () => ipcRenderer.removeListener("yellow-beast:projectionChanged", listener);
};
contextBridge.exposeInMainWorld("yellowBeast", Object.freeze(api));
