"use strict";

// Desktop-facing application facade.  This is deliberately the only layer that
// combines application storage with Yellow Beast's public runtime modules.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const history = require("../tools/world-history");
const gameplay = require("../tools/gameplay");
const desk = require("../tools/becks-desk");
const bootstrap = require("../tools/run-bootstrap");
const nullzone = require("../tools/nullzone-exposure");
const lost = require("../tools/lost");
const { executePlayerTurn } = require("../tools/player-turn");
const { createOpenAIProvider } = require("../tools/ai-openai-provider");
const { createMockProvider } = require("../tools/ai-mock-provider");
const { buildSafeScene, fallbackNarration } = require("../tools/scene-presentation");
const { resolveAppPaths } = require("../tools/launcher-paths");
const { CredentialStore } = require("./credentials");
const packageVersion = require("../package.json").version;

const clone = (value) => structuredClone(value);
const MODES = Object.freeze([
  { id: "async-command", gameplay_mode: "beck", label: "Async: Beck's Desk", role: "Institutional management", description: "Manage ASYNC operations, personnel, research, recovery, and infrastructure from inside the institution." },
  { id: "field-researcher", gameplay_mode: "clear-q4", label: "Async: Clear-Q4", role: "Field research", description: "Enter the Complex as a field researcher operating under ASYNC orders." },
  { id: "local-anomaly", gameplay_mode: "nullzone", label: "Nullzone Exposure", role: "Civilian investigation", description: "Investigate the Complex independently from a civilian base and personal archive." },
  { id: "lost", gameplay_mode: "lost", label: "Lost", role: "Survival", description: "Survive and navigate the Complex with limited knowledge and uncertain escape." }
]);
const DEFAULT_SETTINGS = Object.freeze({ version: 2, input_mode: "structured", provider: "offline", theme: "system", reduced_motion: false, reopen_last_world: true, mode_onboarding: {} });

function publicError(code, message) { return { ok: false, error: { code, message } }; }
function safeId(value) { return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,100}$/i.test(value); }
function friendlyName(value) { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80; }
function ensureDirectory(directory) { fs.mkdirSync(directory, { recursive: true }); }
function readJson(file, fallback) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : clone(fallback); } catch { return clone(fallback); } }
function writeJson(file, value) { ensureDirectory(path.dirname(file)); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); JSON.parse(fs.readFileSync(temporary, "utf8")); fs.renameSync(temporary, file); }

class DesktopService {
  constructor({ appDataPath = null, paths = null, logger = null, credentials = null } = {}) {
    this.paths = paths ?? (appDataPath ? { root: appDataPath, worlds: path.join(appDataPath, "worlds"), saves: path.join(appDataPath, "saves"), logs: path.join(appDataPath, "logs"), config: path.join(appDataPath, "config.json") } : resolveAppPaths());
    this.metadataFile = path.join(this.paths.root, "desktop-worlds.json");
    this.settingsFile = path.join(this.paths.root, "desktop-settings.json");
    this.logger = logger ?? (() => {});
    this.credentials = credentials ?? new CredentialStore();
    this.sessions = new Map();
    [this.paths.root, this.paths.worlds, this.paths.saves, this.paths.logs].forEach(ensureDirectory);
  }

  log(message) { this.logger(String(message).replace(/[\r\n]+/g, " ")); }
  metadata() { const value = readJson(this.metadataFile, { version: 1, worlds: {}, first_run_complete: false, last_world_id: null }); value.worlds ??= {}; return value; }
  writeMetadata(value) { writeJson(this.metadataFile, value); }
  settings() { return { ...DEFAULT_SETTINGS, ...readJson(this.settingsFile, DEFAULT_SETTINGS) }; }
  worldFile(worldId) { if (!safeId(worldId)) throw Object.assign(new Error("invalid world reference"), { code: "WORLD_INVALID" }); return path.join(this.paths.worlds, `${worldId}.json`); }
  sessionFile(worldId, mode) { if (!safeId(worldId) || !MODES.some((item) => item.id === mode)) throw Object.assign(new Error("invalid session reference"), { code: "SESSION_INVALID" }); return path.join(this.paths.saves, `${worldId}-${mode}.json`); }
  getMode(mode) { return MODES.find((item) => item.id === mode) ?? null; }
  backupFile(worldId) { return `${this.worldFile(worldId)}.previous-good`; }
  getWorld(worldId) { const file = this.worldFile(worldId); if (!fs.existsSync(file)) throw Object.assign(new Error("world not found"), { code: "WORLD_NOT_FOUND" }); let raw; try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw Object.assign(new Error("world save is damaged"), { code: "WORLD_LOAD_FAILED" }); } if (raw.version !== history.VERSION) throw Object.assign(new Error("world uses an unsupported version"), { code: "WORLD_VERSION_UNSUPPORTED" }); return history.loadWorld(file); }
  saveCanonical(world) { const file = this.worldFile(world.world_id); const temporary = `${file}.${process.pid}.tmp`; try { history.saveWorld(temporary, world); history.loadWorld(temporary); if (fs.existsSync(file)) fs.copyFileSync(file, this.backupFile(world.world_id)); fs.renameSync(temporary, file); return { ok: true }; } catch (error) { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {} throw error; } }
  worldInfo(world, metadata = {}) { return { id: world.world_id, name: metadata.name ?? world.world_id, version: world.version, created_at: metadata.created_at ?? null, last_played_at: metadata.last_played_at ?? null, last_mode: metadata.last_mode ?? null, status: "ready" }; }

  getAppInfo() { const data = this.metadata(); return { ok: true, app: { name: "Yellow Beast", version: packageVersion, alpha: true, first_run_complete: Boolean(data.first_run_complete), data_path: this.paths.root } }; }
  listModes() { return { ok: true, modes: clone(MODES) }; }
  listWorlds() { const data = this.metadata(); const records = Object.entries(data.worlds).map(([id, item]) => {
    try { return this.worldInfo(this.getWorld(id), item); } catch { return { id, name: item.name ?? id, version: null, created_at: item.created_at ?? null, last_played_at: item.last_played_at ?? null, last_mode: item.last_mode ?? null, status: "unavailable" }; }
  }).sort((a, b) => String(b.last_played_at ?? b.created_at ?? "").localeCompare(String(a.last_played_at ?? a.created_at ?? "")));
    return { ok: true, worlds: records, first_run_complete: Boolean(data.first_run_complete) };
  }
  createWorld({ name, seed = null } = {}) {
    if (!friendlyName(name)) return publicError("WORLD_NAME_INVALID", "Choose a world name between 1 and 80 characters.");
    const actualSeed = seed && typeof seed === "string" ? seed : crypto.randomUUID();
    const world = history.createWorld({ seed: actualSeed }); const data = this.metadata();
    if (data.worlds[world.world_id]) return publicError("WORLD_ALREADY_EXISTS", "That world already exists.");
    this.saveCanonical(world); const now = new Date().toISOString(); data.worlds[world.world_id] = { name: name.trim(), created_at: now, last_played_at: now, last_mode: null }; data.first_run_complete = true; data.last_world_id = world.world_id; this.writeMetadata(data);
    return { ok: true, world: this.worldInfo(world, data.worlds[world.world_id]) };
  }
  loadWorld({ world_id }) { try { const world = this.getWorld(world_id); const data = this.metadata(); return { ok: true, world: this.worldInfo(world, data.worlds[world_id] ?? {}), summary: history.summary(world) }; } catch (error) { this.log(`world load failed: ${error.message}`); return publicError(error.code ?? "WORLD_LOAD_FAILED", "This world could not be loaded safely."); } }
  saveWorld({ world_id }) { try { const world = this.getWorld(world_id); this.saveCanonical(world); return { ok: true }; } catch (error) { return publicError(error.code ?? "WORLD_SAVE_FAILED", "This world could not be saved."); } }
  deleteWorld({ world_id, confirmed = false }) {
    if (confirmed !== true) return publicError("DELETE_CONFIRMATION_REQUIRED", "Confirm deletion before removing this world.");
    try { const file = this.worldFile(world_id); if (!fs.existsSync(file)) return publicError("WORLD_NOT_FOUND", "This world no longer exists."); fs.unlinkSync(file);
      for (const mode of MODES) { const session = this.sessionFile(world_id, mode.id); if (fs.existsSync(session)) fs.unlinkSync(session); this.sessions.delete(`${world_id}:${mode.id}`); }
      const data = this.metadata(); delete data.worlds[world_id]; if (data.last_world_id === world_id) data.last_world_id = null; this.writeMetadata(data); return { ok: true };
    } catch (error) { this.log(`world delete failed: ${error.message}`); return publicError("WORLD_DELETE_FAILED", "This world could not be deleted."); }
  }
  exportWorld({ world_id, destination }) { try { const source = this.worldFile(world_id); if (!destination || !path.isAbsolute(destination)) return publicError("EXPORT_DESTINATION_INVALID", "Choose an export destination."); history.loadWorld(source); fs.copyFileSync(source, destination); return { ok: true, file: destination }; } catch (error) { return publicError("WORLD_EXPORT_FAILED", "This world could not be exported."); } }
  importWorld({ source, name = null }) { try { if (!source || !path.isAbsolute(source)) return publicError("IMPORT_SOURCE_INVALID", "Choose a world export to import."); const world = history.loadWorld(source); const data = this.metadata(); if (fs.existsSync(this.worldFile(world.world_id)) || data.worlds[world.world_id]) return publicError("WORLD_CONFLICT", "A world with this identity is already present."); this.saveCanonical(world); const now = new Date().toISOString(); data.worlds[world.world_id] = { name: friendlyName(name) ? name.trim() : world.world_id, created_at: now, last_played_at: now, last_mode: null }; this.writeMetadata(data); return { ok: true, world: this.worldInfo(world, data.worlds[world.world_id]) }; } catch { return publicError("WORLD_IMPORT_FAILED", "That export is not a compatible Yellow Beast world."); } }
  getSettings() { return { ok: true, settings: this.settings(), provider: this.getProviderStatus().provider }; }
  updateSettings({ settings }) { if (!settings || typeof settings !== "object") return publicError("SETTINGS_INVALID", "Settings were not understood."); const next = { ...this.settings() }; if (settings.input_mode && !["structured", "natural"].includes(settings.input_mode)) return publicError("SETTINGS_INVALID", "Choose a supported input mode."); if (settings.provider && !["offline", "openai"].includes(settings.provider)) return publicError("SETTINGS_INVALID", "Choose Offline or OpenAI."); if (settings.provider === "openai" && !this.credentials.configured("openai")) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Add an OpenAI key first, or continue offline."); if (settings.theme && !["system", "light", "dark"].includes(settings.theme)) return publicError("SETTINGS_INVALID", "Choose a supported appearance."); if (settings.reduced_motion !== undefined && typeof settings.reduced_motion !== "boolean") return publicError("SETTINGS_INVALID", "Reduced motion must be on or off."); Object.assign(next, settings); delete next.api_key; writeJson(this.settingsFile, next); return { ok: true, settings: next };
  }
  getProviderStatus() { const selected = this.settings().provider; const configured = this.credentials.configured("openai"); return { ok: true, provider: { selected, offline: selected === "offline", openai: { configured, status: selected === "openai" ? (configured ? "ready" : "configuration-required") : "inactive" }, local_provider: { supported: false, status: "not-available" } } }; }
  configureOpenAI({ api_key, model = null }) { const stored = this.credentials.set("openai", api_key); if (!stored.ok) return publicError(stored.code, "Enter a valid OpenAI key."); const next = { ...this.settings(), provider: "openai", input_mode: "natural" }; if (model && typeof model === "string" && model.length <= 120) next.openai_model = model; writeJson(this.settingsFile, next); return { ok: true, provider: { configured: true, persistent: stored.persistent } }; }
  removeOpenAIKey() { this.credentials.remove("openai"); const next = { ...this.settings(), provider: "offline", input_mode: "structured" }; delete next.openai_model; writeJson(this.settingsFile, next); return { ok: true }; }
  testProvider() { const status = this.getProviderStatus().provider; if (status.selected === "offline") return { ok: true, status: "ready", message: "Offline structured play is ready." }; if (!status.openai.configured) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "OpenAI needs a key. You can continue offline at any time."); return { ok: true, status: "ready", message: "OpenAI is configured. Connection is tested when you choose natural-language input." }; }
  renameWorld({ world_id, name }) { if (!friendlyName(name)) return publicError("WORLD_NAME_INVALID", "Choose a world name between 1 and 80 characters."); const data = this.metadata(); if (!data.worlds[world_id]) return publicError("WORLD_NOT_FOUND", "This world no longer exists."); data.worlds[world_id].name = name.trim(); this.writeMetadata(data); return { ok: true, world: this.loadWorld({ world_id }).world }; }
  restoreBackup({ world_id, confirmed = false }) { if (confirmed !== true) return publicError("RESTORE_CONFIRMATION_REQUIRED", "Confirm that restoring the previous save may lose recent changes."); try { const backup = this.backupFile(world_id); if (!fs.existsSync(backup)) return publicError("BACKUP_UNAVAILABLE", "No previous save is available for this world."); history.loadWorld(backup); fs.copyFileSync(backup, this.worldFile(world_id)); return { ok: true, world: this.loadWorld({ world_id }).world }; } catch { return publicError("BACKUP_RESTORE_FAILED", "The previous save could not be restored safely."); } }
  exportBrokenWorld({ world_id, destination }) { try { const source = this.worldFile(world_id); if (!destination || !path.isAbsolute(destination) || !fs.existsSync(source)) return publicError("EXPORT_DESTINATION_INVALID", "Choose a destination for this world file."); fs.copyFileSync(source, destination); return { ok: true, file: destination }; } catch { return publicError("EXPORT_FAILED", "The world file could not be copied."); } }
  getDiagnostics() { const status = this.getProviderStatus().provider; return { ok: true, diagnostics: { app_version: packageVersion, platform: process.platform, provider: status.selected, provider_status: status.offline ? "offline" : status.openai.status, save_directory: "managed application data", credentials_configured: status.openai.configured, telemetry: "disabled" } }; }
  serializeSession(world, mode, entry) { if (entry.kind === "bootstrap") return { version: 1, mode, kind: entry.kind, payload: bootstrap.saveRun(entry.run) }; if (entry.kind === "lost") return { version: 1, mode, kind: entry.kind, payload: clone(entry.run) }; return { version: 1, mode, kind: entry.kind, payload: clone(entry) }; }
  restoreSession(world, mode, saved) { if (saved?.mode !== mode) return null; if (saved.kind === "bootstrap") { const restored = bootstrap.resumeRun(saved.payload, { world }); return restored.ok ? { kind: "bootstrap", run: restored.run } : null; } if (saved.kind === "lost") return { kind: "lost", run: saved.payload }; if (saved.kind === "nullzone") return { kind: "nullzone", run_id: saved.payload.run_id }; if (saved.kind === "beck") return { kind: "beck", run_id: saved.payload.run_id }; return null; }
  session(worldId, mode) { return this.sessions.get(`${worldId}:${mode}`) ?? null; }
  persistSession(world, mode, entry) { writeJson(this.sessionFile(world.world_id, mode), this.serializeSession(world, mode, entry)); this.sessions.set(`${world.world_id}:${mode}`, entry); this.saveCanonical(world); const data = this.metadata(); if (data.worlds[world.world_id]) { data.worlds[world.world_id].last_played_at = new Date().toISOString(); data.worlds[world.world_id].last_mode = mode; data.last_world_id = world.world_id; this.writeMetadata(data); } }
  startSession({ world_id, mode, seed = "desktop" }) {
    try { const world = this.getWorld(world_id); const descriptor = this.getMode(mode); if (!descriptor) return publicError("MODE_INVALID", "Choose one of the available roles."); let entry;
      if (mode === "field-researcher") { const started = bootstrap.startRun({ profile: mode, seed, scenario: "procedural-survey", world }); if (!started.ok) return publicError("SESSION_START_FAILED", "The field session could not start."); entry = { kind: "bootstrap", run: started.run }; }
      else if (mode === "lost") entry = { kind: "lost", run: lost.start(world, seed) };
      else { const run_id = history.beginRun(world, { profile: mode, scenario: mode === "async-command" ? "becks-desk-operations" : "nullzone-exposure", seed }); if (mode === "local-anomaly") { const prepared = nullzone.prepare(world, run_id, ["field-light", "recording-device", "evidence-container"]); if (!prepared.ok || !nullzone.enter(world, run_id).ok) return publicError("SESSION_START_FAILED", "The civilian excursion could not start."); entry = { kind: "nullzone", run_id }; } else entry = { kind: "beck", run_id }; }
      this.persistSession(world, mode, entry); return { ok: true, session: { world_id, mode, resumable: true }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`session start failed: ${error.message}`); return publicError("SESSION_START_FAILED", "This session could not start safely."); }
  }
  resumeSession({ world_id, mode }) { try { const world = this.getWorld(world_id); const saved = readJson(this.sessionFile(world_id, mode), null); const entry = this.restoreSession(world, mode, saved); if (!entry) return publicError("SESSION_NOT_FOUND", "There is no compatible session to continue."); this.sessions.set(`${world_id}:${mode}`, entry); return { ok: true, session: { world_id, mode, resumable: true }, projection: this.projectionFor(world, mode, entry) }; } catch { return publicError("SESSION_RESUME_FAILED", "This session could not be resumed safely."); } }
  sceneFor(entry, mode, options = {}) { if (entry.kind !== "bootstrap") return null; const scene = buildSafeScene({ run: entry.run, mode, ...options }); return { ...scene, narration: fallbackNarration(scene), narration_source: "fallback" }; }
  projectionFor(world, mode, entry) { const descriptor = this.getMode(mode); const runId = entry.run_id ?? entry.run?.run_id ?? null; let surface;
    if (entry.kind === "bootstrap") surface = bootstrap.status(entry.run); else if (entry.kind === "lost") surface = lost.projection(entry.run); else if (entry.kind === "nullzone") surface = { ...nullzone.projection(world), local_observation: nullzone.observeRegion(world) }; else surface = desk.projection(world);
    return { version: "yellow-beast-desktop-projection@v1", world: this.worldInfo(world, this.metadata().worlds[world.world_id] ?? {}), mode: clone(descriptor), gameplay: gameplay.projection(world, { mode: descriptor.gameplay_mode, run_id: runId }), institution: mode === "async-command" ? desk.projection(world) : null, surface: clone(surface), scene: this.sceneFor(entry, mode), available_actions: this.availableFor(world, mode, entry), settings: this.settings() };
  }
  getGameplayProjection({ world_id, mode }) { try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue a session first."); return { ok: true, projection: this.projectionFor(world, mode, entry) }; } catch { return publicError("PROJECTION_UNAVAILABLE", "Gameplay state is not available."); } }
  getInstitutionProjection({ world_id }) { try { return { ok: true, projection: desk.projection(this.getWorld(world_id)) }; } catch { return publicError("INSTITUTION_UNAVAILABLE", "Institution state is not available."); } }
  availableFor(world, mode, entry) {
    if (entry.kind === "bootstrap") {
      const state = bootstrap.status(entry.run); const observed = bootstrap.look(entry.run); const targets = state.view.targets.map(({ alias }) => ({ ref: alias, label: alias })); const exits = (observed.view?.exits ?? []).map(({ alias }) => ({ ref: alias, label: alias }));
      return state.available_verbs.map((type) => ({ type, target_required: ["MOVE", "INSPECT", "USE", "RECORD", "COMMUNICATE"].includes(type), targets: type === "COMMUNICATE" ? [{ ref: "standard", label: "Standard" }, { ref: "team", label: "Team" }] : type === "MOVE" ? exits : ["INSPECT", "RECORD"].includes(type) ? targets : type === "USE" ? [{ ref: "survey-instrument", label: "Survey instrument" }] : [] }));
    }
    if (entry.kind === "lost") { const view = lost.projection(entry.run); return [{ type: "MOVE", target_required: true, targets: view.surroundings.exits.map(({ alias }) => ({ ref: alias, label: alias })) }, { type: "DROP", target_required: true, targets: view.status.carried.map((item) => ({ ref: item, label: item })) }, { type: "RETURN", target_required: false, targets: [] }, { type: "STRAND", target_required: false, targets: [] }]; }
    if (entry.kind === "nullzone") return [{ type: "EXPAND", target_required: false, targets: [] }, { type: "DISCOVER", target_required: false, targets: [] }, { type: "RETURN", target_required: false, targets: [] }];
    return [{ type: "REVIEW_REPORT", target_required: false, targets: [] }, { type: "ADVANCE", target_required: false, targets: [] }];
  }
  getAvailableActions({ world_id, mode }) { const current = this.getGameplayProjection({ world_id, mode }); return current.ok ? { ok: true, actions: current.projection.available_actions } : current; }
  submitAction({ world_id, mode, action, target = null }) {
    try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue a session first."); const verb = String(action ?? "").toUpperCase(); let result;
      if (entry.kind === "bootstrap") result = bootstrap.act(entry.run, verb, target);
      else if (entry.kind === "lost") { if (verb === "MOVE") result = lost.move(world, entry.run, target); else if (verb === "DROP") result = lost.drop(world, entry.run, target); else if (verb === "RETURN") result = lost.escape(world, entry.run); else if (verb === "STRAND") result = lost.strand(world, entry.run); else result = { ok: false, code: "ACTION_UNAVAILABLE" }; }
      else if (entry.kind === "nullzone") { if (verb === "EXPAND") result = nullzone.expand(world, entry.run_id); else if (verb === "DISCOVER") result = nullzone.discoverArtifact(world, entry.run_id); else if (verb === "RETURN") result = nullzone.returnBase(world, entry.run_id); else result = { ok: false, code: "ACTION_UNAVAILABLE" }; }
      else result = verb === "REVIEW_REPORT" ? { ok: true, result: desk.projection(world) } : verb === "ADVANCE" ? desk.advance(world, entry.run_id) : { ok: false, code: "ACTION_UNAVAILABLE" };
      if (!result.ok) return publicError(result.error?.code ?? result.code ?? "ACTION_REJECTED", result.error?.public_reason ?? result.public_reason ?? "That action is not available right now."); this.persistSession(world, mode, entry); const scene = this.sceneFor(entry, mode, { action: verb, scene_type: verb === "LOOK" ? "observation" : "delta" }); return { ok: true, result: { outcome: result.outcome ?? "succeeded", public_reason: result.result?.public_reason ?? result.public_reason ?? null, scene }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`action failed: ${error.message}`); return publicError("ACTION_RUNTIME_ERROR", "Yellow Beast could not complete that action safely."); }
  }
  async submitNatural({ world_id, mode, text }) {
    if (mode !== "field-researcher") return publicError("NATURAL_INPUT_UNAVAILABLE", "Natural-language input is currently available for Clear-Q4 only. Structured controls remain available in every role.");
    try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue this session first."); const configured = this.settings().provider === "openai"; const key = configured ? this.credentials.get("openai") : null; if (configured && !key) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "OpenAI needs a key. Your world is safe; you can continue offline."); const provider = configured ? createOpenAIProvider({ apiKey: key, model: this.settings().openai_model || undefined, timeout: 15000 }) : createMockProvider(); const turn = await executePlayerTurn({ run: entry.run, mode, provider, player_text: text, request_id: `desktop-natural-${world_id}-${Date.now()}` }); if (turn.save_required) this.persistSession(world, mode, entry); const scene = { ...turn.scene, narration: turn.narration.prose, narration_source: turn.narration.source }; return { ok: true, result: { turn_status: turn.status, clarification_required: turn.status === "CLARIFICATION_REQUIRED", clarification_question: turn.clarification?.question ?? null, executed: turn.save_required, summary: scene.narration, scene }, projection: this.projectionFor(world, mode, entry) }; } catch (error) { this.log(`provider unavailable: ${error.message}`); return publicError("PROVIDER_UNAVAILABLE", "AI response unavailable. Your world is safe. Continue using structured controls or try again."); }
  }
  shutdown() { for (const [key, entry] of this.sessions) { const [worldId, mode] = key.split(":"); try { this.persistSession(this.getWorld(worldId), mode, entry); } catch (error) { this.log(`shutdown save failed: ${error.message}`); } } return { ok: true }; }
}

module.exports = { DesktopService, MODES, DEFAULT_SETTINGS };
