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
const { resolveModeAttempt } = require("../tools/mode-attempt-resolution");
const { createOpenAIProvider } = require("../tools/ai-openai-provider");
const { createMockProvider } = require("../tools/ai-mock-provider");
const { buildSafeScene, fallbackNarration } = require("../tools/scene-presentation");
const phases = require("../tools/mode-phases");
const q4 = require("../tools/q4-experience");
const q4Interactions = require("../tools/q4-interactions");
const q4Personnel = require("../tools/q4-personnel");
const q4Equipment = require("../tools/q4-equipment");
const q4Trajectories = require("../tools/q4-trajectories");
const q4Continuity = require("../tools/q4-continuity");
const q4Cognition = require("../tools/q4-cognition");
const q4Radio = require("../tools/q4-radio");
const q4Time = require("../tools/q4-time");
const communicationRuntime = require("../tools/communication-runtime");
const teamRuntime = require("../tools/team-runtime");
const hazardRuntime = require("../tools/hazard-runtime");
const spatialRuntime = require("../tools/spatial-runtime");
const objectRuntime = require("../tools/object-runtime");
const logisticsRuntime = require("../tools/logistics-runtime");
const institutionalRuntime = require("../tools/institutional-runtime");
const surveyFrontier = require("../tools/survey-frontier");
const { event: expeditionEvent } = require("../tools/expedition");
const beckExperience = require("../tools/beck-experience");
const nullzoneExperience = require("../tools/nullzone-experience");
const lostExperience = require("../tools/lost-experience");
const consequenceEchoes = require("../tools/consequence-echoes");
const { resolveAppPaths } = require("../tools/launcher-paths");
const { CredentialStore } = require("./credentials");
const developerInspection = require("../tools/dev-inspection");
const packageVersion = require("../package.json").version;
const buildInfo = require("./build-info");
const q4BetaReport = require("../tools/q4-beta-report");
const worldpackRegistry = require("../data/worldpacks/registry.json");
const SAVE_SCHEMA_VERSION = "yellow-beast-session@7";

const clone = (value) => structuredClone(value);
const MODES = Object.freeze(worldpackRegistry.programs.map((program) => Object.freeze({ ...program, label: program.program_name, playable: program.availability === "available" })));
const DEFAULT_SETTINGS = Object.freeze({ version: 5, input_mode: "structured", provider: "offline", theme: "system", text_scale:"default", reduced_motion: false, reduced_sensory: false, audio_muted: false, audio_master: 0.35, audio_interface: 0.35, audio_radio: 0.35, audio_ambient: 0.25, guided_introductions: true, reopen_last_world: true, mode_onboarding: {}, visual_rendering: true, visual_adapter: "fallback", visual_quality: "documentary", automatic_evidence_rendering: true, retry_failed_renders: true, media_effect_intensity: "restrained", comfyui_endpoint: "http://127.0.0.1:8188", comfyui_workflow: "observer-safe-q4-evidence" });
// Non-Q4 language is deliberately a small phrase-to-existing-control adapter.
// It cannot invent a target or capability: recognised phrases only select an
// action already available in the active, observer-safe session.
function publicError(code, message) { return { ok: false, error: { code, message } }; }
function safeId(value) { return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,100}$/i.test(value); }
function friendlyName(value) { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80; }
function ensureDirectory(directory) { fs.mkdirSync(directory, { recursive: true }); }
function readJson(file, fallback) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : clone(fallback); } catch { return clone(fallback); } }
function writeJson(file, value) { ensureDirectory(path.dirname(file)); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); JSON.parse(fs.readFileSync(temporary, "utf8")); fs.renameSync(temporary, file); }
function readJsonCandidate(file) { if (!fs.existsSync(file)) return { ok: false, code: "SAVE_MISSING" }; try { return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { return { ok: false, code: "SAVE_DAMAGED" }; } }
function redactDiagnostic(value) { if (Array.isArray(value)) return value.map(redactDiagnostic); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /key|token|password|secret|credential/i.test(key) ? "[redacted]" : redactDiagnostic(item)])); return typeof value === "string" ? value.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]+\b/g, "[redacted]") : value; }

class DesktopService {
  constructor({ appDataPath = null, paths = null, logger = null, credentials = null, developerMode = process.env.YELLOW_BEAST_DEVELOPER_MODE === "1" } = {}) {
    this.paths = paths ?? (appDataPath ? { root: appDataPath, worlds: path.join(appDataPath, "worlds"), saves: path.join(appDataPath, "saves"), logs: path.join(appDataPath, "logs"), config: path.join(appDataPath, "config.json") } : resolveAppPaths());
    this.metadataFile = path.join(this.paths.root, "desktop-worlds.json");
    this.settingsFile = path.join(this.paths.root, "desktop-settings.json");
    this.logger = logger ?? (() => {});
    this.credentials = credentials ?? new CredentialStore();
    this.developerMode = developerMode === true;
    this.sessions = new Map();
    this.recovery = new Map();
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
  sessionBackupFile(worldId, mode) { return `${this.sessionFile(worldId, mode)}.previous-good`; }
  recoveryKey(worldId, mode = "world") { return `${worldId}:${mode}`; }
  noteRecovery(worldId, mode, source) { const status = { recovered: true, source, message: source === "previous-good-session" ? "The primary operation record could not be used. A verified previous record was resumed; the damaged record was preserved for diagnosis." : "The primary world record could not be used. A verified previous record was loaded; the damaged record was preserved for diagnosis." }; this.recovery.set(this.recoveryKey(worldId, mode), status); return status; }
  recoveryStatus(worldId, mode = "world") { return this.recovery.get(this.recoveryKey(worldId, mode)) ?? { recovered: false }; }
  loadWorldFile(file) { const candidate = readJsonCandidate(file); if (!candidate.ok) throw Object.assign(new Error("world save is damaged"), { code: "WORLD_LOAD_FAILED" }); if (candidate.value?.version !== history.VERSION) throw Object.assign(new Error("world uses an unsupported version"), { code: "WORLD_VERSION_UNSUPPORTED" }); return history.loadWorld(file); }
  getWorld(worldId) { const file = this.worldFile(worldId); if (!fs.existsSync(file)) throw Object.assign(new Error("world not found"), { code: "WORLD_NOT_FOUND" }); try { return this.loadWorldFile(file); } catch (error) { if (error.code === "WORLD_VERSION_UNSUPPORTED") throw error; const backup = this.backupFile(worldId); try { const restored = this.loadWorldFile(backup); this.noteRecovery(worldId, "world", "previous-good-world"); return restored; } catch { throw error; } } }
  saveCanonical(world) { const file = this.worldFile(world.world_id); const temporary = `${file}.${process.pid}.tmp`; try { history.saveWorld(temporary, world); history.loadWorld(temporary); if (fs.existsSync(file)) { try { this.loadWorldFile(file); fs.copyFileSync(file, this.backupFile(world.world_id)); } catch {} } fs.renameSync(temporary, file); return { ok: true }; } catch (error) { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {} throw error; } }
  worldInfo(world, metadata = {}) { return { id: world.world_id, name: metadata.name ?? world.world_id, version: world.version, created_at: metadata.created_at ?? null, last_played_at: metadata.last_played_at ?? null, last_mode: metadata.last_mode ?? null, status: "ready" }; }

  getAppInfo() { const data = this.metadata(); const build = buildInfo.read(); return { ok: true, app: { name: "Yellow Beast", version: packageVersion, alpha: true, build, first_run_complete: Boolean(data.first_run_complete), data_path: this.paths.root, developer_mode:this.developerMode } }; }
  getDeveloperSnapshot({ world_id, mode = null } = {}) { if (!this.developerMode) return publicError("DEVELOPER_DISABLED", "Developer tooling is disabled."); try { const world = this.getWorld(world_id); const entry = mode ? (this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null))) : null; const provider = this.getProviderStatus().provider; const run = entry?.kind === "bootstrap" ? entry.run : null; const simulationTruth = run ? { developer_only: true, authoritative_clock: structuredClone(run.expedition.clock), event_queue: structuredClone(run.expedition.operational?.events ?? []), mission_state: structuredClone(run.expedition.mission_state), teammate_locations: structuredClone(run.spatial?.personnel_locations ?? {}), teammate_decisions: structuredClone(run.expedition.team_runtime?.decision_history ?? run.expedition.operational?.decision_history ?? []), hazard_state: structuredClone(run.expedition.hazards ?? {}), item_custody: structuredClone(run.expedition.logistics?.items ?? {}), container_contents: structuredClone(run.expedition.logistics?.containers ?? {}), institutional_knowledge: structuredClone(world.institutional_response?.confirmed_knowledge ?? []), standard_response_queue: structuredClone(world.institutional_response?.pending_decisions ?? []), observer_safe_projection: q4.presentation(run, entry.phase, null, world) } : null; return { ok:true, snapshot:developerInspection.snapshot(world), active:{ mode, phase:entry?.phase ?? null, session_kind:entry?.kind ?? null, simulation_truth:simulationTruth }, provider:{ selected:provider.selected, offline:provider.offline, configured:provider.openai.configured, status:provider.offline ? "offline" : provider.openai.status }, provider_safe_context:run ? developerInspection.providerSafeContext(run) : null, recent_history:developerInspection.recentHistory(world) }; } catch { return publicError("DEVELOPER_SNAPSHOT_UNAVAILABLE", "The selected world could not be inspected."); } }
  async traceDeveloperIntent({ world_id, mode, text }) { if (!this.developerMode) return publicError("DEVELOPER_DISABLED", "Developer tooling is disabled."); try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry || entry.kind !== "bootstrap") return publicError("TRACE_UNAVAILABLE", "A Clear-Q4 session is required for this non-executing trace."); return { ok:true, trace:await developerInspection.intentTrace({ run:entry.run, provider:createMockProvider(), player_text:text }) }; } catch { return publicError("TRACE_UNAVAILABLE", "The selected session could not be traced."); } }
  listModes() { return { ok: true, registry_version: worldpackRegistry.version, modes: clone([...MODES].sort((a, b) => a.display_order - b.display_order)) }; }
  listWorlds() { const data = this.metadata(); const records = Object.entries(data.worlds).map(([id, item]) => {
    try { return this.worldInfo(this.getWorld(id), item); } catch { return { id, name: item.name ?? id, version: null, created_at: item.created_at ?? null, last_played_at: item.last_played_at ?? null, last_mode: item.last_mode ?? null, status: "unavailable" }; }
  }).sort((a, b) => String(b.last_played_at ?? b.created_at ?? "").localeCompare(String(a.last_played_at ?? a.created_at ?? "")));
    return { ok: true, worlds: records, first_run_complete: Boolean(data.first_run_complete) };
  }
  createWorld({ name, seed = null } = {}) {
    const worldName = friendlyName(name) ? name.trim() : "Untitled field file";
    try {
      const actualSeed = seed && typeof seed === "string" ? seed : crypto.randomUUID();
      const world = history.createWorld({ seed: actualSeed }); const data = this.metadata();
      if (data.worlds[world.world_id]) return publicError("WORLD_ALREADY_EXISTS", "That world already exists.");
      this.saveCanonical(world); const now = new Date().toISOString(); data.worlds[world.world_id] = { name: worldName, created_at: now, last_played_at: now, last_mode: null }; data.first_run_complete = true; data.last_world_id = world.world_id; this.writeMetadata(data);
      return { ok: true, world: this.worldInfo(world, data.worlds[world.world_id]) };
    } catch (error) {
      this.log(`world creation failed: ${error.message}`);
      return publicError("WORLD_CREATE_FAILED", "The field file could not be established. Your existing records were not changed.");
    }
  }
  loadWorld({ world_id }) { try { const world = this.getWorld(world_id); const data = this.metadata(); return { ok: true, world: this.worldInfo(world, data.worlds[world_id] ?? {}), summary: history.summary(world), recovery: this.recoveryStatus(world_id, "world") }; } catch (error) { this.log(`world load failed: ${error.message}`); return publicError(error.code ?? "WORLD_LOAD_FAILED", "This world could not be loaded safely."); } }
  getQ4PersonnelStatus({ world_id }) { try { const world = this.getWorld(world_id); const identity = world.q4_operations?.controlled_player ?? null; const person = identity ? history.character(world, identity) : null; return { ok: true, required: !person, confirmation_required: Boolean(person && !world.q4_operations?.personnel_confirmation?.completed), player: person ? q4Personnel.safePerson(person) : null }; } catch { return publicError("WORLD_LOAD_FAILED", "This world could not be loaded safely."); } }
  createQ4Personnel({ world_id, first_name, last_name, display_name = null }) { try { const world = this.getWorld(world_id); const created = q4Personnel.createPlayer(world, { first_name, last_name, display_name }); if (!created.ok) return publicError(created.code, "Enter a valid first and last name for the personnel record."); this.saveCanonical(world); return { ok: true, created: created.created, player: created.player }; } catch { return publicError("PERSONNEL_CREATION_FAILED", "The ASYNC personnel record could not be created safely."); } }
  confirmQ4Personnel({ world_id }) { try { const world = this.getWorld(world_id); const identity = world.q4_operations?.controlled_player; const person = identity ? history.character(world, identity) : null; if (!person) return publicError("PERSONNEL_CREATION_REQUIRED", "Create your ASYNC personnel record before confirming it."); world.q4_operations.personnel_confirmation = { completed: true, personnel_id: identity, confirmed_at: world.q4_operations.personnel_confirmation?.confirmed_at ?? new Date().toISOString() }; this.saveCanonical(world); return { ok: true, player: q4Personnel.safePerson(person) }; } catch { return publicError("PERSONNEL_CONFIRMATION_FAILED", "The personnel record could not be confirmed safely."); } }
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
  updateSettings({ settings }) { if (!settings || typeof settings !== "object") return publicError("SETTINGS_INVALID", "Settings were not understood."); const next = { ...this.settings() }; if (settings.input_mode && !["structured", "natural"].includes(settings.input_mode)) return publicError("SETTINGS_INVALID", "Choose a supported input mode."); if (settings.provider && !["offline", "openai"].includes(settings.provider)) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Choose offline play or configured language assistance."); if (settings.provider === "openai" && !this.credentials.configured("openai")) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Add an access key first, or continue offline."); if (settings.theme && !["system", "light", "dark", "high-contrast"].includes(settings.theme)) return publicError("SETTINGS_INVALID", "Choose a supported appearance."); if (settings.text_scale && !["small", "default", "large", "extra-large"].includes(settings.text_scale)) return publicError("SETTINGS_INVALID", "Choose a supported text size."); if (settings.reduced_motion !== undefined && typeof settings.reduced_motion !== "boolean") return publicError("SETTINGS_INVALID", "Reduced motion must be on or off."); if (settings.reduced_sensory !== undefined && typeof settings.reduced_sensory !== "boolean") return publicError("SETTINGS_INVALID", "Reduced sensory must be on or off."); if (settings.audio_muted !== undefined && typeof settings.audio_muted !== "boolean") return publicError("SETTINGS_INVALID", "Audio mute must be on or off."); for (const key of ["audio_master", "audio_interface", "audio_radio", "audio_ambient"]) if (settings[key] !== undefined && (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 1)) return publicError("SETTINGS_INVALID", `${key} must be between 0 and 1.`); if (settings.guided_introductions !== undefined && typeof settings.guided_introductions !== "boolean") return publicError("SETTINGS_INVALID", "Guided introductions must be on or off."); if (settings.visual_adapter && !["fallback", "comfyui", "hosted"].includes(settings.visual_adapter)) return publicError("SETTINGS_INVALID", "Choose a supported visual renderer."); if (settings.visual_quality && !["documentary", "detailed"].includes(settings.visual_quality)) return publicError("SETTINGS_INVALID", "Choose a supported visual quality."); if (settings.media_effect_intensity && !["restrained", "reduced"].includes(settings.media_effect_intensity)) return publicError("SETTINGS_INVALID", "Choose a supported media effect intensity."); for (const key of ["visual_rendering", "automatic_evidence_rendering", "retry_failed_renders"]) if (settings[key] !== undefined && typeof settings[key] !== "boolean") return publicError("SETTINGS_INVALID", `${key} must be on or off.`); Object.assign(next, settings); delete next.api_key; writeJson(this.settingsFile, next); return { ok: true, settings: next };
  }
  getProviderStatus() { const selected = this.settings().provider; const configured = this.credentials.configured("openai"); const settings = this.settings(); return { ok: true, provider: { selected, offline: selected === "offline", openai: { configured, status: selected === "openai" ? (configured ? "ready" : "configuration-required") : "inactive" }, local_provider: { supported: true, adapter: settings.visual_adapter, endpoint: settings.comfyui_endpoint, status: settings.visual_adapter === "comfyui" ? "optional-health-check" : "inactive" } } }; }
  configureOpenAI({ api_key, model = null }) { const stored = this.credentials.set("openai", api_key); if (!stored.ok) return publicError(stored.code, "Enter a valid OpenAI key."); const next = { ...this.settings(), provider: "openai", input_mode: "natural" }; if (model && typeof model === "string" && model.length <= 120) next.openai_model = model; writeJson(this.settingsFile, next); return { ok: true, provider: { configured: true, persistent: stored.persistent } }; }
  removeOpenAIKey() { this.credentials.remove("openai"); const next = { ...this.settings(), provider: "offline", input_mode: "structured" }; delete next.openai_model; writeJson(this.settingsFile, next); return { ok: true }; }
  testProvider() { const status = this.getProviderStatus().provider; if (status.selected === "offline") return { ok: true, status: "ready", message: "Offline structured play is ready." }; if (!status.openai.configured) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "OpenAI needs a key. You can continue offline at any time."); return { ok: true, status: "ready", message: "OpenAI is configured. Connection is tested when you choose natural-language input." }; }
  renameWorld({ world_id, name }) { if (!friendlyName(name)) return publicError("WORLD_NAME_INVALID", "Choose a world name between 1 and 80 characters."); const data = this.metadata(); if (!data.worlds[world_id]) return publicError("WORLD_NOT_FOUND", "This world no longer exists."); data.worlds[world_id].name = name.trim(); this.writeMetadata(data); return { ok: true, world: this.loadWorld({ world_id }).world }; }
  restoreBackup({ world_id, confirmed = false }) { if (confirmed !== true) return publicError("RESTORE_CONFIRMATION_REQUIRED", "Confirm that restoring the previous save may lose recent changes."); try { const backup = this.backupFile(world_id); if (!fs.existsSync(backup)) return publicError("BACKUP_UNAVAILABLE", "No previous save is available for this world."); history.loadWorld(backup); fs.copyFileSync(backup, this.worldFile(world_id)); return { ok: true, world: this.loadWorld({ world_id }).world }; } catch { return publicError("BACKUP_RESTORE_FAILED", "The previous save could not be restored safely."); } }
  exportBrokenWorld({ world_id, destination }) { try { const source = this.worldFile(world_id); if (!destination || !path.isAbsolute(destination) || !fs.existsSync(source)) return publicError("EXPORT_DESTINATION_INVALID", "Choose a destination for this world file."); fs.copyFileSync(source, destination); return { ok: true, file: destination }; } catch { return publicError("EXPORT_FAILED", "The world file could not be copied."); } }
  getDiagnostics() { const status = this.getProviderStatus().provider; return { ok: true, diagnostics: { app_version: packageVersion, platform: process.platform, provider: status.selected, provider_status: status.offline ? "offline" : status.openai.status, save_directory: "managed application data", credentials_configured: status.openai.configured, save_schema_version: SAVE_SCHEMA_VERSION, telemetry: "disabled", offline_gameplay: true } }; }
  sanitizedLogTail() { const file = path.join(this.paths.logs, "desktop.log"); try { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-40).map((line) => redactDiagnostic(line)); } catch { return []; } }
  exportTesterReport({ world_id, mode = "field-researcher", note = null } = {}) { try { const world = this.getWorld(world_id); const loaded = this.loadSession(world, mode); const entry = this.session(world_id, mode) ?? loaded.entry ?? null; const projection = entry ? this.projectionFor(world, mode, entry) : null; const provider = this.getProviderStatus().provider; const input = { world, session: projection, provider: { selected: provider.selected, offline: provider.offline, configured: provider.openai.configured, status: provider.offline ? "offline" : provider.openai.status }, note, save_schema_version: SAVE_SCHEMA_VERSION, recent_public_events: developerInspection.recentHistory(world), logs: this.sanitizedLogTail(), recovery: { world: this.recoveryStatus(world_id, "world"), session: this.recoveryStatus(world_id, mode) } }; const safeInput = redactDiagnostic(input); const report = q4BetaReport.report(safeInput); const file = q4BetaReport.writeReport(this.paths.logs, safeInput); return { ok: true, file, report }; } catch { return publicError("TESTER_REPORT_FAILED", "The diagnostic record could not be exported safely."); } }
  serializeSession(world, mode, entry) { const phase = entry.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (entry.kind === "bootstrap") return { version: 7, schema: SAVE_SCHEMA_VERSION, mode, kind: entry.kind, legacy_flow: entry.legacy_flow === true, phase, payload: bootstrap.saveRun(entry.run) }; if (entry.kind === "lost") return { version: 7, schema: SAVE_SCHEMA_VERSION, mode, kind: entry.kind, phase, payload: clone(entry.run) }; return { version: 7, schema: SAVE_SCHEMA_VERSION, mode, kind: entry.kind, phase, payload: clone(entry) }; }
  validateSessionSave(saved, mode) { if (!saved || typeof saved !== "object") return "SESSION_SAVE_DAMAGED"; if (saved.mode !== mode) return "SESSION_MODE_INVALID"; if (![1, 2, 3, 4, 5, 6, 7].includes(saved.version ?? 1)) return "SESSION_VERSION_UNSUPPORTED"; if (saved.version === 7 && saved.schema !== SAVE_SCHEMA_VERSION) return "SESSION_SCHEMA_UNSUPPORTED"; if (!["bootstrap", "lost", "nullzone", "beck"].includes(saved.kind)) return "SESSION_SAVE_DAMAGED"; if (saved.phase?.mode_id && saved.phase.mode_id !== mode) return "SESSION_SAVE_DAMAGED"; try { if (saved.phase?.phase_id) phases.validate(mode, saved.phase.phase_id); } catch { return "SESSION_SAVE_DAMAGED"; } return null; }
  restoreSession(world, mode, saved) { if (this.validateSessionSave(saved, mode)) return null; const phase = saved.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (saved.kind === "bootstrap") { const hadSpatialState = Boolean(saved.payload?.spatial); const hadRadioState = Boolean(saved.payload?.expedition?.radio); const hadOperationalState = Boolean(saved.payload?.expedition?.operational); const restored = bootstrap.resumeRun(saved.payload, { world, spatial_worldpack: mode === "field-researcher" ? "clear-q4" : null, phase: phase.phase_id }); if (!restored.ok) return null; bootstrap.ensureSpatial(restored.run, phase.phase_id); if (!hadSpatialState) { if (["FIELD_OPERATION", "RETURN", "DEBRIEF"].includes(phase.phase_id)) bootstrap.enterSpatialField(restored.run); else bootstrap.setSpatialPhase(restored.run, phase.phase_id); } if (!hadRadioState && ["FIELD_OPERATION", "RETURN", "DEBRIEF"].includes(phase.phase_id)) q4Radio.completeCheck(restored.run.expedition); if (!hadOperationalState && restored.run.expedition?.clock?.check_in_due_at != null && !restored.run.expedition.communications?.check_ins?.length) q4Time.schedule(restored.run.expedition, Math.max(1, restored.run.expedition.clock.check_in_due_at - restored.run.expedition.clock.interval)); bootstrap.evaluateMissionState(restored.run, phase.phase_id); return { kind: "bootstrap", run: restored.run, legacy_flow: saved.legacy_flow === true || phase.legacy_flow === true, phase }; } if (saved.kind === "lost") return { kind: "lost", run: saved.payload, phase }; if (saved.kind === "nullzone") return { kind: "nullzone", run_id: saved.payload.run_id, phase }; if (saved.kind === "beck") return { kind: "beck", run_id: saved.payload.run_id, phase }; return null; }
  loadSession(world, mode) { const file = this.sessionFile(world.world_id, mode); const current = readJsonCandidate(file); if (!current.ok && current.code === "SAVE_MISSING") return { ok: false, code: "SESSION_NOT_FOUND" }; const problem = current.ok ? this.validateSessionSave(current.value, mode) : "SESSION_SAVE_DAMAGED"; const entry = !problem ? this.restoreSession(world, mode, current.value) : null; if (entry) return { ok: true, entry, recovery: this.recoveryStatus(world.world_id, mode) }; if (problem === "SESSION_VERSION_UNSUPPORTED" || problem === "SESSION_SCHEMA_UNSUPPORTED") return { ok: false, code: problem }; const backup = readJsonCandidate(this.sessionBackupFile(world.world_id, mode)); const backupProblem = backup.ok ? this.validateSessionSave(backup.value, mode) : "SESSION_SAVE_DAMAGED"; const recovered = !backupProblem ? this.restoreSession(world, mode, backup.value) : null; if (recovered) return { ok: true, entry: recovered, recovery: this.noteRecovery(world.world_id, mode, "previous-good-session") }; return { ok: false, code: problem ?? "SESSION_SAVE_DAMAGED" }; }
  saveSession(worldId, mode, serialized) { const file = this.sessionFile(worldId, mode); const temporary = `${file}.${process.pid}.tmp`; try { writeJson(temporary, serialized); const verified = readJsonCandidate(temporary); if (!verified.ok || this.validateSessionSave(verified.value, mode)) throw Object.assign(new Error("session candidate failed validation"), { code: "SESSION_SAVE_INVALID" }); if (fs.existsSync(file)) { const current = readJsonCandidate(file); if (current.ok && !this.validateSessionSave(current.value, mode)) fs.copyFileSync(file, this.sessionBackupFile(worldId, mode)); } fs.renameSync(temporary, file); } catch (error) { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {} throw error; } }
  session(worldId, mode) { return this.sessions.get(`${worldId}:${mode}`) ?? null; }
  persistSession(world, mode, entry) { if (entry.kind === "bootstrap") {
      const sessionInstitution = entry.run._world?.institutional_response;
      const canonicalInstitution = world.institutional_response;
      if (sessionInstitution && (!canonicalInstitution || (sessionInstitution.revision ?? 0) > (canonicalInstitution.revision ?? 0))) world.institutional_response = clone(sessionInstitution);
      entry.run._world = world;
      const expedition = entry.run.expedition; q4Equipment.syncWorld(world, expedition); q4Trajectories.syncWorld(world, expedition);
      if (entry.run.spatial) world.q4_geography = spatialRuntime.canonicalSnapshot(entry.run.spatial);
      if (entry.run.object_state) world.q4_object_state = clone(entry.run.object_state);
      for (const member of expedition.team?.members ?? []) { const person = history.character(world, member.personnel_id ?? member.id); if (!person) continue; const changed = person.status !== member.status || person.condition !== member.condition; person.status = member.status; person.condition = member.condition; if (changed) history.event(world, entry.run.run_id, "q4.personnel.condition.changed", { identity: person.identity, status: person.status, condition: person.condition, interval: expedition.clock.interval }, "authoritative-operational-consequence"); }
      for (const message of expedition.messages ?? []) { if (message.intended_recipient !== "Standard" || !["delivered", "acknowledged"].includes(message.state) || message.institutional_recorded) continue; const recordId = `q4-delivered-communication-${message.id}`; history.event(world, entry.run.run_id, "q4.communication.reported", { message_id: message.id, endpoint: "Standard", purpose: message.purpose, status: message.state, interval: message.delivered_at }); history.recordInstitutional(world, entry.run.run_id, recordId, { channel: "standard", purpose: message.purpose, report: message.text, status: message.state, source_message: message.id, delivered_at: message.delivered_at }); if (message.geography_report === true && entry.run.survey_frontier) surveyFrontier.report(entry.run.survey_frontier, message.sender, { at: message.delivered_at ?? expedition.clock?.interval ?? 0, message_id: message.id }); for (const evidenceId of message.evidence_ids ?? []) history.recordInstitutional(world, entry.run.run_id, `institutional-evidence-${evidenceId}`, { evidence_id: evidenceId, source_message: message.id, status: "reported" }); message.institutional_recorded = recordId; }
      if (entry.run.survey_frontier) world.q4_survey_frontier = clone(entry.run.survey_frontier);
    } this.saveSession(world.world_id, mode, this.serializeSession(world, mode, entry)); this.sessions.set(`${world.world_id}:${mode}`, entry); this.saveCanonical(world); const data = this.metadata(); if (data.worlds[world.world_id]) { data.worlds[world.world_id].last_played_at = new Date().toISOString(); data.worlds[world.world_id].last_mode = mode; data.last_world_id = world.world_id; this.writeMetadata(data); } }
  startSession({ world_id, mode, seed = "desktop", require_personnel = false }) {
    try { const world = this.getWorld(world_id); const descriptor = this.getMode(mode); if (!descriptor) return publicError("MODE_INVALID", "Choose one of the available roles."); let entry;
      if (mode === "field-researcher") { if (require_personnel && !world.q4_operations?.controlled_player) return publicError("PERSONNEL_CREATION_REQUIRED", "Create your ASYNC personnel record before receiving an assignment."); const started = bootstrap.startRun({ profile: mode, seed, scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" }); if (!started.ok) return publicError("SESSION_START_FAILED", "The field session could not start."); entry = { kind: "bootstrap", run: started.run, legacy_flow: false, phase: phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }) }; bootstrap.setSpatialPhase(entry.run, entry.phase.phase_id); }
      else if (mode === "lost") entry = { kind: "lost", run: lost.start(world, seed), phase: phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }) };
      else { const run_id = history.beginRun(world, { profile: mode, scenario: mode === "async-command" ? "becks-desk-operations" : "nullzone-exposure", seed }); if (mode === "local-anomaly") { const prepared = nullzone.prepare(world, run_id, ["field-light", "recording-device", "evidence-container"]); if (!prepared.ok || !nullzone.enter(world, run_id).ok) return publicError("SESSION_START_FAILED", "The civilian excursion could not start."); entry = { kind: "nullzone", run_id }; } else entry = { kind: "beck", run_id }; }
      entry.phase ??= phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (entry.kind === "bootstrap") entry.phase.legacy_flow = entry.legacy_flow === true; this.persistSession(world, mode, entry); return { ok: true, session: { world_id, mode, resumable: true }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`session start failed: ${error.message}`); return publicError("SESSION_START_FAILED", "This session could not start safely."); }
  }
  resumeSession({ world_id, mode }) { try { const world = this.getWorld(world_id); const loaded = this.loadSession(world, mode); if (!loaded.ok) { const messages = { SESSION_NOT_FOUND: "There is no operational record to continue.", SESSION_VERSION_UNSUPPORTED: "This operation record was created by a newer unsupported version and was left unchanged.", SESSION_SCHEMA_UNSUPPORTED: "This operation record cannot be opened safely by this version and was left unchanged.", SESSION_SAVE_DAMAGED: "This operation record is damaged and no verified previous record is available. It was left unchanged." }; return publicError(loaded.code, messages[loaded.code] ?? "This operation record could not be resumed safely."); } this.sessions.set(`${world_id}:${mode}`, loaded.entry); return { ok: true, session: { world_id, mode, resumable: true }, recovery: { world: this.recoveryStatus(world_id, "world"), session: loaded.recovery }, projection: this.projectionFor(world, mode, loaded.entry) }; } catch { return publicError("SESSION_RESUME_FAILED", "This session could not be resumed safely."); } }
  briefingScene(entry, mode, phaseId = entry.phase?.phase_id, world = null) {
    const view = q4.presentation(entry.run, entry.phase ?? phases.createPhase({ mode }), null, world);
    const team = view.team.map((member) => member.display_name).join(" and ") || "the assigned field team";
    const equipment = (view.equipment?.required ?? []).map((item) => item.label).join(", ") || "the assigned field kit";
    const facts = [
      ["location", "location", phaseId === "BRIEFING" ? "the ASYNC briefing room" : phaseId === "STAGING" ? "the equipment staging area" : phaseId === "FACILITY_TRANSIT" ? "the controlled facility transit route" : "the approach to the Threshold"],
      ["assignment", "assignment", view.display_mission ?? "the Clear-Q4 field assignment"],
      ["team", "personnel", `Assigned personnel: ${team}.`],
      ["equipment", "readiness", `Readiness: ${equipment}.`],
      ["reporting", "reporting", view.reporting ? `Reporting: ${view.reporting}.` : "Reporting expectations will be confirmed before departure."],
      ["next-step", "next-step", phaseId === "BRIEFING" ? "Before departure, review the assignment and confirm readiness to stage." : phaseId === "STAGING" ? "The next step is to proceed with the team and equipment." : phaseId === "FACILITY_TRANSIT" ? "The next step is to approach the Threshold with the team accounted for." : "Crossing the Threshold remains a player decision after the approach is complete."]
    ].map(([id, category, text]) => ({ id, category, text, required: true }));
    const context = phaseId === "BRIEFING" ? [] : [
      ...(view.restrictions ?? []).map((text, index) => ({ id: `constraint-${index + 1}`, category: "constraint", text, required: false })),
      ...(view.human_context?.procedures ?? []).map((text, index) => ({ id: `procedure-${index + 1}`, category: "procedure", text, required: false }))
    ];
    const scene = { version: "yellow-beast-scene@v1", scene_id: `briefing-${entry.run.run_id ?? entry.run.session.id}`, world_ref: entry.run.world_id ?? null, session_ref: entry.run.session.id, turn_ref: "briefing", observer_ref: entry.run.session.startup.player.observer_id, mode, profile: "clear-q4", scene_type: "briefing", significance: "Operational notice", location: "ASYNC briefing room", safe_facts: facts, immediate_changes: [], visible_actors: [], communications: [], sensory_facts: [], inventory: [], object_state_changes: [], unresolved_facts: [], continuing_conditions: [], context, interaction_prompt: "Review the assignment and confirm when you are ready to stage.", provenance: { source: "observer-safe-q4-briefing", input: null } };
    const sentence = (text) => String(text).replace(/[.]+$/, "") + ".";
    scene.narration = `Assignment ${view.mission_record?.display_id ?? view.mission_record?.id ?? "Clear-Q4"}. ${sentence(view.display_mission)} Assigned team: ${team}. Required equipment: ${equipment}. ${view.reporting ? `Reporting: ${sentence(view.reporting)}` : "Reporting expectations are recorded in the assignment."} Before departure, review the assignment and confirm readiness to stage.`;
    const phaseInstruction = { BRIEFING: "Review the Clear-Q4 survey assignment and continue to staging.", STAGING: "Review issued equipment and proceed to the threshold room.", FACILITY_TRANSIT: "Proceed with the accounted team toward the Threshold room.", THRESHOLD: "Confirm personnel accountability and cross when ready.", STANDARD_RADIO_CHECK: "Establish contact with Standard before entering the field." }[phaseId];
    if (phaseInstruction) { scene.interaction_prompt = phaseInstruction; scene.narration = scene.narration.replace(/ Before departure.*$/, ` ${phaseInstruction}`); }
    scene.narration_source = "fallback";
    return scene;
  }
  sceneFor(entry, mode, options = {}, world = null) {
    if (entry.kind === "bootstrap") {
      const phase = options.phase ?? entry.phase?.phase_id;
      if (phase !== "FIELD_OPERATION" && phase !== "RETURN" && phase !== "DEBRIEF") return this.briefingScene(entry, mode, phase, world);
      const scene = buildSafeScene({ run: entry.run, mode, ...options });
      if (entry.run.spatial && entry.run.spatial_pack_id) {
        const definition = bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id);
        const player = entry.run.session.startup.player.observer_id;
        const nearby = (entry.run.expedition?.team?.members ?? []).filter((member) => (member.personnel_id ?? member.id) !== player && spatialRuntime.proximity(entry.run.spatial, player, member.personnel_id ?? member.id).speaking_range).map((member) => member.first_name ?? member.display_name);
        const objects = bootstrap.objectProjection(entry.run).map((object) => object.observation);
        const narration = options.public_reason || spatialRuntime.locationObservation(entry.run.spatial, definition, { mode: options.action === "MOVE" ? "arrival" : options.action ? "orient" : "entry", nearby, objects });
        return { ...scene, location: spatialRuntime.currentLocation(entry.run.spatial, definition)?.name ?? scene.location, narration, narration_source: "spatial-observation" };
      }
      return { ...scene, narration: fallbackNarration(scene), narration_source: "fallback" };
    }
    return this.modeScene(world, mode, entry, { consequence: { result: { accepted: options.accepted !== false, observer_safe_summary: options.public_reason ?? "The current situation remains unchanged." } } });
  }
  projectionFor(world, mode, entry) { const descriptor = this.getMode(mode); const runId = entry.run_id ?? entry.run?.run_id ?? null; let surface;
    if (entry.kind === "bootstrap") surface = bootstrap.status(entry.run); else if (entry.kind === "lost") surface = lost.projection(entry.run); else if (entry.kind === "nullzone") surface = { ...nullzone.projection(world), local_observation: nullzone.observeRegion(world) }; else surface = desk.projection(world);
    const phase = entry.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); const unfinished = consequenceEchoes.unfinishedBusiness(world, mode, { run_id: runId }); return { version: "yellow-beast-desktop-projection@v1", world: this.worldInfo(world, this.metadata().worlds[world.world_id] ?? {}), mode: clone(descriptor), gameplay: gameplay.projection(world, { mode: descriptor.gameplay_mode, run_id: runId }), institution: mode === "async-command" ? desk.projection(world) : null, consequence_echoes: consequenceEchoes.observerView(world, mode, { run_id: runId }), unfinished_business: unfinished, surface: clone(surface), phase: clone(phase), q4: entry.kind === "bootstrap" ? q4.presentation(entry.run, phase, unfinished, world) : null, beck: entry.kind === "beck" ? beckExperience.presentation(world, surface, phase, unfinished) : null, nullzone: entry.kind === "nullzone" ? nullzoneExperience.presentation(world, phase, surface, unfinished) : null, lost: entry.kind === "lost" ? lostExperience.presentation(surface, phase, unfinished) : null, scene: this.sceneFor(entry, mode, {}, world), available_actions: this.availableFor(world, mode, entry), settings: this.settings() };
  }
  getGameplayProjection({ world_id, mode }) { try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue a session first."); return { ok: true, projection: this.projectionFor(world, mode, entry) }; } catch { return publicError("PROJECTION_UNAVAILABLE", "Gameplay state is not available."); } }
  getInstitutionProjection({ world_id }) { try { const world = this.getWorld(world_id); return { ok: true, projection: { management: desk.projection(world), standard: institutionalRuntime.project(world, bootstrap.institutionalDefinitionFor("clear-q4")) } }; } catch { return publicError("INSTITUTION_UNAVAILABLE", "Institution state is not available."); } }

  q4LogisticsContext(entry, world) { const player = entry.run.session.startup.player.observer_id; const team = entry.run.expedition.team?.members ?? []; const names = Object.fromEntries(team.map((member) => [member.personnel_id ?? member.id, member.display_name])); const institution = institutionalRuntime.ensure(world, bootstrap.institutionalDefinitionFor(entry.run.spatial_pack_id)); return { player, actor: player, team, names, spatial: entry.run.spatial, location: entry.run.spatial?.player_location, at: entry.run.expedition.clock?.interval ?? 0, phase: entry.phase?.phase_id, restrictions: institution.restrictions?.equipment ?? [] }; }
  submitQ4Logistics({ world_id, action, item_id = null, container_id = null, target_holder = null, target_container = null, source_item_id = null, quantity = 1 }) {
    try { const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null)); if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before managing equipment."); const context = this.q4LogisticsContext(entry, world); const definition = bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id); const resolveHolder = (value) => { if (!value) return null; if (value === "You") return context.actor; const member = context.team.find((candidate) => [candidate.personnel_id, candidate.id, candidate.display_name].includes(value)); return member?.personnel_id ?? member?.id ?? value; }; const request = { action, item_id, container_id, actor: context.actor, target_holder: resolveHolder(target_holder), target_container, source_item_id, quantity }; const result = container_id ? logisticsRuntime.transactContainer(entry.run.expedition, definition, request, context) : logisticsRuntime.transact(entry.run.expedition, definition, request, context); if (!result.ok) return publicError(result.code, result.public_reason); logisticsRuntime.syncSpatial(entry.run.expedition, entry.run.spatial); spatialRuntime.syncEquipment(entry.run.spatial, entry.run.expedition); const authoredCost = bootstrap.dynamicsDefinitionFor(entry.run.spatial_pack_id).action_costs[String(action).toUpperCase()] ?? (/^INSPECT|^VERIFY/.test(String(action).toUpperCase()) ? 0 : 1); const cycle = bootstrap.resolveOperationalCycle(entry.run, String(action).toUpperCase(), authoredCost, "logistics-transaction"); expeditionEvent(entry.run.expedition, "logistics.transaction.committed", { transaction_id: result.transaction.id, action: result.transaction.action, item_id: result.transaction.item_id ?? null, container_id: result.transaction.container_id ?? null }); this.persistSession(world, "field-researcher", entry); return { ok: true, result: { outcome: "succeeded", public_reason: result.public_reason, transaction: { action: result.transaction.action, summary: result.transaction.summary, at: result.transaction.at }, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates }, projection: this.projectionFor(world, "field-researcher", entry) }; } catch (error) { this.log(`Q4 logistics failed: ${error.message}`); return publicError("LOGISTICS_RUNTIME_ERROR", "The logistics transaction could not be committed safely."); }
  }
  availableFor(world, mode, entry) {
    if (entry.kind === "bootstrap") {
      const phaseActions = { BRIEFING: "READY", STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "CROSS", STANDARD_RADIO_CHECK: q4Radio.ensure(entry.run.expedition).check_completed ? "BEGIN_FIELD_OPERATION" : "RADIO_CHECK" };
      const state = bootstrap.status(entry.run); const observed = bootstrap.look(entry.run, { record: false }); const targets = state.view.targets.map(({ alias }) => ({ ref: alias, label: alias })); const exits = (observed.view?.exits ?? []).map(({ alias }) => ({ ref: alias, label: alias }));
      const objectActions = new Map();
      for (const object of observed.view?.objects ?? []) for (const affordance of object.actions ?? []) if (affordance.available) {
        const list = objectActions.get(affordance.action) ?? [];
        if (!list.some((item) => item.ref === object.name)) list.push({ ref: object.name, label: object.name });
        objectActions.set(affordance.action, list);
      }
      const objectActionTypes = new Set([...objectActions.keys()]);
      const team = teamRuntime.project(entry.run); const localCoworkers = team.filter((member) => !member.controlled && member.local_eligible);
      const orderTargets = (type) => type === "ORDER_INVESTIGATE" ? localCoworkers.flatMap((member) => (observed.view?.exits ?? []).filter((exit) => exit.status !== "blocked").map((exit) => ({ ref: `${member.personnel_id}|${exit.edge_id}`, label: `${member.first_name}: investigate ${exit.label ?? exit.alias}` }))) : localCoworkers.map((member) => ({ ref: member.personnel_id, label: `${member.first_name}: ${type === "ORDER_HOLD" ? "hold position" : "follow"}` }));
      const assistanceTargets = team.filter((member) => !member.controlled && member.local_eligible && /injur|wound/i.test(String(member.condition))).map((member) => ({ ref: member.personnel_id, label: `Assist ${member.first_name}` }));
      const recoveryTargets = Object.entries(entry.run.expedition.equipment ?? {}).filter(([, item]) => item.state === "dropped" && item.location === entry.run.spatial?.player_location).map(([key, item]) => ({ ref: key, label: `Recover ${item.label}` }));
      const mitigationTargets = hazardRuntime.project(entry.run, bootstrap.dynamicsDefinitionFor(entry.run.spatial_pack_id)).filter((hazard) => hazard.mitigation_available).map((hazard) => ({ ref: hazard.id, label: `Mitigate ${hazard.category} warning` }));
      const actions = state.available_verbs.filter((type) => {
        if (type === "COMMUNICATE" && entry.phase?.phase_id === "BRIEFING") return false;
        if (["ORDER_HOLD", "ORDER_INVESTIGATE", "ORDER_FOLLOW", "ASSIST", "RECOVER", "MITIGATE"].includes(type) && !["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id)) return false;
        if (entry.run.spatial && type === "RECORD" && !objectActionTypes.has("RECORD")) return false;
        return ["LOOK", "MOVE", "COMMUNICATE", "WAIT", "RETURN", "ABORT", "USE", "INSPECT"].includes(type) || !objectRuntime.AFFORDANCES.map((item) => item.toUpperCase()).includes(type) || objectActionTypes.has(type);
      }).map((type) => {
        const actionTargets = objectActions.get(type) ?? [];
        const availableTargets = type === "COMMUNICATE" ? [{ ref: "standard", label: "Standard" }, { ref: "team", label: "Team" }] : type === "MOVE" ? exits : type === "INSPECT" ? targets : type.startsWith("ORDER_") ? orderTargets(type) : type === "ASSIST" ? assistanceTargets : type === "RECOVER" ? recoveryTargets : type === "MITIGATE" ? mitigationTargets : type === "USE" && !actionTargets.length ? [{ ref: "survey-instrument", label: "Survey instrument" }] : actionTargets;
        return { type, target_required: availableTargets.length > 0, targets: availableTargets };
      }).filter((action) => !["ORDER_HOLD", "ORDER_INVESTIGATE", "ORDER_FOLLOW", "ASSIST", "RECOVER", "MITIGATE"].includes(action.type) || action.targets.length > 0);
      if (["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id)) {
        const frontiers = spatialRuntime.availableFrontiers(entry.run.spatial).map((item) => ({ ref: item.id, label: item.label }));
        if (frontiers.length) actions.unshift({ type: "EXPAND", target_required: true, targets: frontiers });
        actions.push({ type: "MARK", target_required: false, targets: [] });
      }
      if (entry.run.lifecycle === "completed" && entry.phase?.phase_id === "DEBRIEF") return [{ type: "ADVANCE_OPERATIONS", target_required: false, targets: [] }];
      return phaseActions[entry.phase?.phase_id] ? [{ type: phaseActions[entry.phase.phase_id], target_required: false, targets: [] }, ...actions] : actions;
    }
    if (entry.kind === "lost") { const view = lost.projection(entry.run); return [{ type: "MOVE", target_required: true, targets: view.surroundings.exits.map(({ alias }) => ({ ref: alias, label: alias })) }, { type: "DROP", target_required: true, targets: view.status.carried.map((item) => ({ ref: item, label: item })) }, { type: "RETURN", target_required: false, targets: [] }, { type: "STRAND", target_required: false, targets: [] }]; }
    if (entry.kind === "nullzone") return [{ type: "EXPAND", target_required: false, targets: [] }, { type: "DISCOVER", target_required: false, targets: [] }, { type: "RETURN", target_required: false, targets: [] }];
    return [{ type: "REVIEW_REPORT", target_required: false, targets: [] }, { type: "ADVANCE", target_required: false, targets: [] }];
  }
  getAvailableActions({ world_id, mode }) { const current = this.getGameplayProjection({ world_id, mode }); return current.ok ? { ok: true, actions: current.projection.available_actions } : current; }
  advanceQ4Operations({ world_id }) {
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap" || entry.run.lifecycle !== "completed" || entry.phase?.phase_id !== "DEBRIEF") return publicError("REVIEW_REQUIRED", "Complete the current review before advancing operations.");
      const seed = q4Continuity.nextSeed(world, entry.run.expedition?.mission?.id ?? entry.run.expedition?.id); q4Continuity.advanceOperations(world); const current = world.q4_operations?.controlled_player; const currentPerson = current ? history.character(world, current) : null; const succession = currentPerson?.status === "dead" ? q4Personnel.selectSuccessor(world, entry.run.run_id, seed) : null; if (succession && !succession.ok) return publicError("SUCCESSOR_UNAVAILABLE", "No living Q4-capable successor is available.");
      const started = bootstrap.startRun({ profile: "field-researcher", seed, scenario: "procedural-survey", world, player_identity: succession?.successor?.identity ?? current, spatial_worldpack: "clear-q4" }); if (!started.ok) return publicError("NEXT_EXPEDITION_UNAVAILABLE", "The next assignment could not be prepared safely.");
      const next = { kind: "bootstrap", run: started.run, phase: phases.createPhase({ mode: "field-researcher", guided: this.settings().guided_introductions !== false }) }; this.persistSession(world, "field-researcher", next); return { ok: true, result: { outcome: "operations-advanced", public_reason: succession ? `Personnel control transferred from ${succession.handover.former} (${succession.handover.final_status}) to ${succession.handover.new_controlled_person}.` : "Institutional time advances to the next Clear-Q4 assignment.", handover: succession?.handover ?? null }, projection: this.projectionFor(world, "field-researcher", next) };
    } catch { return publicError("NEXT_EXPEDITION_UNAVAILABLE", "The next assignment could not be prepared safely."); }
  }
  recordQ4Action(entry, text, result, world = null) {
    const verb = String(text).trim().split(/\s+/, 1)[0].toUpperCase();
    if (verb === "RETURN" && entry.run.expedition?.mission?.hidden_trajectory?.state?.status !== "dormant") q4Trajectories.contain({ world, expedition: entry.run.expedition, run_id: entry.run.run_id, reason: "early return or completed field work" });
    const observation = q4Trajectories.resolveAction({ world, expedition: entry.run.expedition, run_id: entry.run.run_id, phase: entry.phase?.phase_id, verb: verb === "PHOTOGRAPH" ? "RECORD" : verb, result, observation_kind: /record|photograph/i.test(text) ? "record" : /contact|radio|check.?in/i.test(text) ? "contact" : null, comparison: /compare|reconcile|prior|layout/i.test(text) });
    if (observation.observed && result.result) result.result.public_reason = observation.summary;
    return q4Interactions.record(entry.run.expedition, { channel: "action", speaker: "You", targets: [], player_text: text, attempted_behavior: text, eligibility: result.ok ? "eligible" : "rejected", delivery: "not-applicable", time_cost: result.result?.time_advanced ?? (/^WAIT\b/.test(text) ? 1 : 0), canonical_effects: result.result?.canonical_event_ids ?? [], presentation: { result: observation.summary ?? (result.ok ? result.outcome ?? "succeeded" : result.error?.code ?? "rejected") } });
  }
  submitQ4Communication({ world_id, channel, text, target = null }) {
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before communicating.");
      if (!q4Interactions.CHANNELS.includes(channel) || channel === "action") return publicError("CHANNEL_INVALID", "Choose a communication channel.");
      const message = typeof text === "string" ? text.trim().slice(0, 2000) : "";
      if (!message) return publicError("COMMUNICATION_EMPTY", "Say or transmit something before sending it.");
      const expedition = entry.run.expedition; const playerId = entry.run.session.startup.player.observer_id; const coworkers = expedition.team.members.filter((member) => member.personnel_id !== playerId); const requested = String(target ?? "").toLowerCase(); const peer = requested && !["team", "teammate", "standard"].includes(requested) ? coworkers.find((member) => [member.personnel_id, member.first_name, member.display_name].filter(Boolean).some((value) => String(value).toLowerCase() === requested)) : coworkers[0]; const person = history.character(world, peer?.personnel_id ?? peer?.id); const observed = channel === "local" ? q4Personnel.observerStatus(peer, person, entry.phase?.phase_id, entry.run.spatial, playerId) : null;
      if (channel === "local") {
        const localPeers = coworkers.filter((member) => { const record = history.character(world, member.personnel_id ?? member.id); return member.status === "active" && q4Personnel.observerStatus(member, record, entry.phase?.phase_id, entry.run.spatial, playerId).local_eligible; });
        const recipients = ["team", "teammate"].includes(requested) ? localPeers : peer && observed.local_eligible ? [peer] : [];
        const acceptedTargets = ["team", "teammate", peer?.personnel_id, peer?.first_name, peer?.display_name].filter(Boolean).map((value) => String(value).toLowerCase());
        const eligible = recipients.length > 0 && (!target || acceptedTargets.includes(String(target).toLowerCase()));
        if (!eligible) {
          const reason = peer?.condition === "Unresponsive" ? "The teammate is unresponsive." : observed.contact_category === "LOCAL" ? "The local conversation could not be delivered." : `The teammate is ${String(observed.contact_category ?? "not present").toLowerCase()}.`;
          communicationRuntime.local(expedition, { sender: playerId, recipients: [peer?.personnel_id ?? peer?.id ?? "unconfirmed teammate"], text: message, eligible: false, failure_reason: reason });
          q4Interactions.record(expedition, { channel, speaker: "You", targets: [peer?.display_name ?? "no nearby teammate"], player_text: message, attempted_behavior: "speak with a nearby teammate", eligibility: "target-out-of-range", delivery: "not-delivered", presentation: { result: reason } });
          this.persistSession(world, "field-researcher", entry);
          return publicError("LOCAL_TARGET_UNAVAILABLE", reason);
        }
         const deliveredLocal = communicationRuntime.local(expedition, { sender: playerId, recipients: recipients.map((member) => member.personnel_id ?? member.id), text: message, eligible: true });
        if (/\b(route|corridor|passage|location|map|survey|where)\b/i.test(message) && entry.run.survey_frontier) for (const recipient of recipients) surveyFrontier.share(entry.run.survey_frontier, recipient.personnel_id ?? recipient.id, playerId, { at: expedition.clock.interval });
        for (const recipient of recipients) recipient.last_communication = { channel: "LOCAL", direction: "received", at: expedition.clock.interval, message_id: deliveredLocal.message.id };
        const request = /\b(hand|pass|give|bring|transfer)\b/i.test(message);
        const cognitive = q4Cognition.respond({ person: person ?? peer, local_history: q4Interactions.history(expedition, "local"), mission: expedition.mission, relationship_history: person?.relationship_history ?? [], observation: message, concern: request ? "equipment handoff" : "local conversation" });
        const requestedEquipment = request ? Object.values(expedition.equipment ?? {}).find((item) => [item.id, item.label, item.type].filter(Boolean).some((value) => message.toLowerCase().includes(String(value).toLowerCase()) || String(value).toLowerCase().split(/\s+/).some((term) => term.length > 4 && message.toLowerCase().includes(term)))) : null;
        const equipmentHolder = requestedEquipment ? expedition.team.members.find((member) => member.personnel_id === requestedEquipment.holder) : null;
        const response = !request ? `${peer.first_name}: ${cognitive.decision.text}` : requestedEquipment?.holder === peer.personnel_id ? `${peer.first_name}: I hear the request. The ${requestedEquipment.label.toLowerCase()} remains with me until we complete a physical handoff.` : requestedEquipment?.holder === playerId ? `${peer.first_name}: You already hold the ${requestedEquipment.label.toLowerCase()}.` : equipmentHolder ? `${peer.first_name}: ${equipmentHolder.first_name} has the ${requestedEquipment.label.toLowerCase()}; a physical handoff still has to happen in person.` : `${peer.first_name}: I hear the request, but I cannot confirm that equipment in my custody.`;
        const interaction = q4Interactions.record(expedition, { channel, speaker: "You", targets: [peer.display_name], player_text: message, attempted_behavior: "speak with a nearby teammate", eligibility: "eligible", delivery: "heard", time_cost: 0, canonical_effects: ["communication.local.delivered"], presentation: { result: "heard", response } });
        q4Trajectories.noteCommunication({ world, expedition, run_id: entry.run.run_id, channel: "local", delivered: true, text: message });
        const cycle = bootstrap.resolveOperationalCycle(entry.run, "LOCAL", 0, "local-communication");
        this.persistSession(world, "field-researcher", entry);
        const scene = this.sceneFor(entry, "field-researcher", { scene_type: "delta", accepted: true, action: "LOCAL", public_reason: response }, world);
        return { ok: true, result: { outcome: "delivered", public_reason: response, message: { id: deliveredLocal.message.id, state: deliveredLocal.message.state }, mission_updates: cycle.mission_updates, scene }, projection: this.projectionFor(world, "field-researcher", entry) };
      }
      const radio = expedition.equipment?.["survey-radio"];
      if (!["STANDARD_RADIO_CHECK", "FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id) || !q4Equipment.stateUsable(radio) || radio.holder !== playerId || radio.charges <= 0 || !q4Radio.available(expedition)) {
        const reason = entry.phase?.phase_id === "BRIEFING" ? "The field radio channel is not active during briefing." : entry.phase?.phase_id === "STAGING" ? "Standard remains unavailable until the radio-check phase." : entry.phase?.phase_id === "THRESHOLD" ? "Complete the approach before establishing radio contact." : "The Standard radio channel is not available from here.";
        communicationRuntime.failRadio(expedition, { sender: playerId, recipient: "Standard", text: message, reason });
        q4Interactions.record(expedition, { channel, speaker: "You", targets: ["Standard"], player_text: message, attempted_behavior: "transmit over the survey radio", eligibility: "radio-unavailable", delivery: "not-delivered", presentation: { result: "The radio channel is not available from this operational context." } });
        this.persistSession(world, "field-researcher", entry);
        return publicError("STANDARD_UNAVAILABLE", reason);
      }
      const used = q4Equipment.use(expedition, "survey-radio", playerId); if (!used.ok) return publicError("STANDARD_UNAVAILABLE", "The Standard radio channel could not begin the transmission.");
      const evidenceReport = /\b(evidence|record|photograph|photo|fixture|scuff|marker|survey result)\b/i.test(message);
      const pendingCheckIn = expedition.communications?.check_ins?.find((item) => !["completed", "waived"].includes(item.state));
      const checkInReport = pendingCheckIn && /\b(check.?in|field status|status report)\b/i.test(message);
      const purpose = /\b(request|seek).{0,24}\b(authoriz|deviat)|\bdeviation request\b/i.test(message) ? "deviation-request" : /\b(emergency|injur|medical|help|missing|casualty|deceased)\b/i.test(message) ? "emergency-report" : /\b(assist|assistance)\b/i.test(message) ? "assistance-request" : /\b(return|coming back)\b/i.test(message) ? "return-request" : evidenceReport ? "evidence-report" : pendingCheckIn ? "scheduled-check-in" : "routine-report";
      const geographyReport = /\b(route|corridor|passage|location|map|survey)\b/i.test(message);
      const queued = communicationRuntime.queueRadio(entry.run, bootstrap.dynamicsDefinitionFor(entry.run.spatial_pack_id), { sender: playerId, recipient: "Standard", text: message, purpose, geography_report: geographyReport, evidence_ids: evidenceReport ? (expedition.evidence ?? []).filter((item) => item.available_to_player !== false).map((item) => item.id) : [] });
      if (pendingCheckIn && (purpose === "scheduled-check-in" || checkInReport)) queued.message.check_in_id = pendingCheckIn.id;
      const cycle = bootstrap.resolveOperationalCycle(entry.run, "COMMUNICATE", 1, "standard-radio");
      const resolvedMessage = expedition.messages.find((item) => item.id === queued.message.id); const actuallyDelivered = ["delivered", "acknowledged"].includes(resolvedMessage.state);
      const delivery = actuallyDelivered ? "delivered" : resolvedMessage.state === "delayed" ? "delayed" : "queued";
      const interaction = q4Interactions.record(expedition, { channel, speaker: "You", targets: ["Standard"], player_text: message, attempted_behavior: "transmit over the survey radio", eligibility: "eligible", delivery, time_cost: 1, canonical_effects: ["communication.sent"], observer_knowledge: actuallyDelivered ? [{ observer: "Standard", kind: "reported-communication", text: message }] : [], presentation: { result: delivery } });
      q4Trajectories.noteCommunication({ world, expedition, run_id: entry.run.run_id, channel: "standard", delivered: actuallyDelivered, text: message });
      const missionUpdates = cycle.mission_updates;
      this.persistSession(world, "field-researcher", entry);
      const publicReason = resolvedMessage.state === "delayed" ? resolvedMessage.interference?.public_description ?? "The transmission is delayed; no delivery confirmation has been received." : actuallyDelivered ? "The transmission was delivered. Standard acknowledgment remains separately recorded." : "The transmission is queued; delivery has not been confirmed.";
      const scene = this.sceneFor(entry, "field-researcher", { scene_type: "delta", accepted: true, action: "STANDARD", public_reason: publicReason }, world);
      return { ok: true, result: { outcome: resolvedMessage.state, public_reason: publicReason, message: { id: resolvedMessage.id, state: resolvedMessage.state }, mission_updates: missionUpdates, operational_updates: cycle.public_updates, scene }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) { this.log(`Q4 communication failed: ${error.message}`); return publicError("COMMUNICATION_RUNTIME_ERROR", "The communication could not be resolved safely."); }
  }
  submitQ4Handoff({ world_id, item_id, target = null }) {
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before handing over equipment.");
      const player = entry.run.session.startup.player.observer_id; const coworkers = entry.run.expedition.team.members.filter((member) => member.personnel_id !== player); const targetText = String(target ?? "").toLowerCase(); const peer = coworkers.find((member) => [member.personnel_id, member.first_name, member.display_name].filter(Boolean).some((value) => String(value).toLowerCase() === targetText)) ?? coworkers[0]; const peerPerson = history.character(world, peer?.personnel_id ?? peer?.id); const observed = q4Personnel.observerStatus(peer, peerPerson, entry.phase?.phase_id, entry.run.spatial, player);
      const validTarget = observed.local_eligible && [peer?.personnel_id, peer?.first_name, peer?.display_name, "team", "teammate"].filter(Boolean).map((value) => String(value).toLowerCase()).includes(targetText || String(peer?.first_name ?? "").toLowerCase());
      if (!validTarget) return publicError("HANDOFF_TARGET_UNAVAILABLE", "That person is not available for a physical handoff here.");
      const key = entry.run.expedition.equipment[item_id] ? item_id : Object.entries(entry.run.expedition.equipment).find(([, item]) => item.id === item_id)?.[0]; const transferred = logisticsRuntime.transact(entry.run.expedition, bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id), { action: "HAND_OVER", item_id: key, actor: player, target_holder: peer.personnel_id }, this.q4LogisticsContext(entry, world));
      if (!transferred.ok) return publicError(transferred.code, transferred.public_reason);
      q4Interactions.record(entry.run.expedition, { channel: "action", speaker: "You", targets: [peer.display_name], player_text: `hand over ${transferred.item.display_name}`, attempted_behavior: "physically hand equipment to a nearby teammate", eligibility: "eligible", delivery: "transferred", time_cost: 1, canonical_effects: ["equipment.handoff"], presentation: { result: "transferred" } });
      history.event(world, entry.run.run_id, "q4.equipment.handed_over", { equipment_id: transferred.item.instance_id, from: player, to: peer.personnel_id }); if (entry.run.spatial) spatialRuntime.syncEquipment(entry.run.spatial, entry.run.expedition); const cycle = bootstrap.resolveOperationalCycle(entry.run, "HANDOFF", 1, "equipment-handoff"); this.persistSession(world, "field-researcher", entry); return { ok: true, result: { outcome: "succeeded", public_reason: `${peer.first_name} takes the ${transferred.item.display_name}.`, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) { this.log(`Q4 handoff failed: ${error.message}`); return publicError("HANDOFF_RUNTIME_ERROR", "The physical handoff could not be resolved safely."); }
  }
  selectQ4OptionalStore({ world_id, item_id }) {
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before selecting stores.");
      if (entry.phase?.phase_id !== "STAGING") return publicError("STAGING_REQUIRED", "Optional stores can only be selected during staging.");
      const selected = logisticsRuntime.transact(entry.run.expedition, bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id), { action: "RETRIEVE", item_id, actor: entry.run.session.startup.player.observer_id }, this.q4LogisticsContext(entry, world));
      if (!selected.ok) return publicError(selected.code, selected.public_reason);
      expeditionEvent(entry.run.expedition, "q4.loadout.optional_selected", { equipment_id: selected.item.instance_id, type: selected.item.category });
      bootstrap.evaluateMissionState(entry.run, entry.phase?.phase_id);
      this.persistSession(world, "field-researcher", entry);
      return { ok: true, result: { outcome: "succeeded", public_reason: `${selected.item.display_name} added to the field loadout.` }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) { this.log(`Q4 store selection failed: ${error.message}`); return publicError("STAGING_RUNTIME_ERROR", "The optional store could not be selected safely."); }
  }
  submitAction({ world_id, mode, action, target = null }) {
    try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue a session first."); const verb = String(action ?? "").toUpperCase(); let result; if (entry.kind === "bootstrap") entry.run._last_mission_updates = [];
      if (entry.kind === "bootstrap" && verb === "ADVANCE_OPERATIONS") return this.advanceQ4Operations({ world_id });
      if (entry.kind === "bootstrap" && verb === "COMMUNICATE") return this.submitQ4Communication({ world_id, channel: String(target).toLowerCase() === "standard" ? "standard" : "local", text: String(target).toLowerCase() === "standard" ? "Check-in to Standard." : "Check in with the team.", target });
      if (entry.kind === "bootstrap" && ["READY", "PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION"].includes(verb)) {
        const phase = entry.phase?.phase_id;
        const radioChecked = q4Radio.ensure(entry.run.expedition).check_completed;
        const expected = { BRIEFING: "READY", STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "CROSS", STANDARD_RADIO_CHECK: radioChecked ? "BEGIN_FIELD_OPERATION" : "RADIO_CHECK" }[phase];
        if (verb !== expected) return publicError("PHASE_GUARD_REJECTED", "That transition is not available from the current expedition phase.");
        if (verb === "RADIO_CHECK") {
          const expedition = entry.run.expedition; const player = entry.run.session.startup.player.observer_id; const radio = expedition.equipment?.["survey-radio"];
          if (!q4Equipment.stateUsable(radio) || radio.holder !== player || radio.charges <= 0) return publicError("STANDARD_UNAVAILABLE", "The assigned field radio is not available for the required check.");
          q4Radio.transition(expedition, "establishing", "radio-check-requested"); q4Equipment.use(expedition, "survey-radio", player);
          const accounted = expedition.team.members.filter((member) => member.status === "active").length;
          const outbound = `Standard, Clear-Q4 team Complex-side. ${accounted} personnel accounted for.`;
          const acknowledgment = "Clear-Q4, contact established. Proceed with assigned survey.";
          const queued = communicationRuntime.queueRadio(entry.run, bootstrap.dynamicsDefinitionFor(entry.run.spatial_pack_id), { sender: player, recipient: "Standard", text: outbound, purpose: "radio-check", acknowledgment: true, acknowledgment_delay: 0 });
          const cycle = bootstrap.resolveOperationalCycle(entry.run, verb, 1, "radio-check"); const radioMessage = expedition.messages.find((message) => message.id === queued.message.id);
          q4Interactions.record(expedition, { channel: "standard", speaker: "YOU", targets: ["Standard"], player_text: outbound, attempted_behavior: "required radio check", eligibility: "eligible", delivery: radioMessage.delivery_status, time_cost: 1, canonical_effects: ["q4.radio.check.transmitted"], presentation: { result: radioMessage.state } });
          if (radioMessage.state === "acknowledged") q4Interactions.record(expedition, { channel: "standard", speaker: "STANDARD", targets: ["Clear-Q4 team"], player_text: acknowledgment, attempted_behavior: "scheduled radio-check acknowledgment", eligibility: "eligible", delivery: "received", canonical_effects: ["q4.radio.check.acknowledged"], presentation: { result: "received" } });
          const missionUpdates = cycle.mission_updates;
          expeditionEvent(expedition, "q4.radio_check.completed", { personnel_accounted_for: accounted, endpoint: "Standard" });
          history.event(world, entry.run.run_id, "q4.radio_check.completed", { personnel_accounted_for: accounted, endpoint: "Standard", status: "acknowledged" });
          result = { ok: true, outcome: "radio-check-completed", result: { public_reason: radioMessage.state === "acknowledged" ? acknowledgment : "The radio check is transmitting; acknowledgment has not yet arrived.", time_advanced: cycle.clock.cost, mission_updates: missionUpdates, operational_updates: cycle.public_updates, canonical_event_ids: ["q4.radio_check.completed"] } };
        } else if (verb === "BEGIN_FIELD_OPERATION") {
          const advanced = q4.nextPhase(entry.phase, { action: verb, radio_check_completed: q4Radio.ensure(entry.run.expedition).check_completed });
          if (!advanced.ok) return publicError(advanced.code, "Standard has not authorized field departure.");
          entry.phase = advanced.phase; bootstrap.enterSpatialField(entry.run); q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id);
          result = { ok: true, outcome: "field-operation-entered", result: { public_reason: null, mission_updates: [...(entry.run._last_mission_updates ?? [])] } };
        } else if (verb === "CROSS") {
          result = bootstrap.crossThreshold(entry.run);
          if (result.ok) { const advanced = q4.nextPhase(entry.phase, { action: verb, canonical_crossed: true, legacy_flow: false }); if (!advanced.ok) return publicError(advanced.code, "The expedition cannot cross from its current state."); entry.phase = advanced.phase; q4Radio.authorize(entry.run.expedition); bootstrap.setSpatialPhase(entry.run, entry.phase.phase_id); q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id); }
        } else {
          result = { ok: true, outcome: "phase-advanced" };
          if (verb === "PROCEED") { const readiness = q4Equipment.projection(entry.run.expedition, entry.run.session.startup.player.observer_id); if (!readiness.readiness) { entry.run.expedition.deviations.push("proceeded-with-required-equipment-unavailable"); expeditionEvent(entry.run.expedition, "q4.loadout.proceeded_without_required", { missing: readiness.missing }); } }
          const advanced = q4.nextPhase(entry.phase, { action: verb }); if (!advanced.ok) return publicError(advanced.code, "The expedition cannot advance from its current state."); entry.phase = advanced.phase; bootstrap.setSpatialPhase(entry.run, entry.phase.phase_id); q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id);
        }
        if (verb !== "RADIO_CHECK" && result.ok) {
          if (entry.run.expedition?.mission_state) entry.run.expedition.mission_state.phase = entry.phase.phase_id;
          const authoredCost = bootstrap.dynamicsDefinitionFor(entry.run.spatial_pack_id).action_costs[verb] ?? 0;
          const cycle = bootstrap.resolveOperationalCycle(entry.run, verb, authoredCost, "phase-action");
          result.result = { ...(result.result ?? {}), time_advanced: cycle.clock.cost, mission_updates: [...(result.result?.mission_updates ?? []), ...cycle.mission_updates], operational_updates: cycle.public_updates };
        }
      } else if (entry.kind === "bootstrap") { result = bootstrap.act(entry.run, verb, target); }
      else if (entry.kind === "lost") { if (verb === "MOVE") result = lost.move(world, entry.run, target); else if (verb === "DROP") result = lost.drop(world, entry.run, target); else if (verb === "RETURN") result = lost.escape(world, entry.run); else if (verb === "STRAND") result = lost.strand(world, entry.run); else result = { ok: false, code: "ACTION_UNAVAILABLE" }; }
      else if (entry.kind === "nullzone") { if (verb === "EXPAND") result = nullzone.expand(world, entry.run_id); else if (verb === "DISCOVER") result = nullzone.discoverArtifact(world, entry.run_id); else if (verb === "RETURN") result = nullzone.returnBase(world, entry.run_id); else result = { ok: false, code: "ACTION_UNAVAILABLE" }; }
      else result = verb === "REVIEW_REPORT" ? { ok: true, result: desk.projection(world) } : verb === "ADVANCE" ? desk.advance(world, entry.run_id) : { ok: false, code: "ACTION_UNAVAILABLE" };
      if (!result.ok) return publicError(result.error?.code ?? result.code ?? "ACTION_REJECTED", result.error?.public_reason ?? result.result?.public_reason ?? result.public_reason ?? "That action is not available right now.");
      if (entry.kind === "bootstrap") {
        this.recordQ4Action(entry, `${verb}${target ? ` ${target}` : ""}`, result, world);
        if (["RETURN", "ABORT"].includes(verb) && entry.run.expedition?.mission_state?.return?.requested && entry.phase?.phase_id !== "RETURN") {
          const returning = phases.transition(entry.phase, "RETURN", { reason: verb.toLowerCase(), guard: true });
          if (returning.ok) { entry.phase = returning.phase; bootstrap.evaluateMissionState(entry.run, "RETURN"); }
        }
        if (entry.run.lifecycle === "completed" && entry.run.expedition?.mission && !entry.run.expedition.institutional_closure_ingested) {
          logisticsRuntime.reconcile(entry.run.expedition, bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id), { ...this.q4LogisticsContext(entry, world), actor: entry.run.session.startup.player.observer_id });
          const continuity = q4Continuity.commitOutcome(world, entry.run, entry.run.expedition.mission_state?.return?.abort_requested ? "ABORT" : "RETURN");
           institutionalRuntime.ingestClosure(world, bootstrap.institutionalDefinitionFor(entry.run.spatial_pack_id), entry.run, continuity.review); institutionalRuntime.advance(world, bootstrap.institutionalDefinitionFor(entry.run.spatial_pack_id), 1);
           entry.run.expedition.institutional_closure_ingested = true;
          history.updateQ4Mission(world, entry.run.run_id, entry.run.expedition.mission.id, { status: entry.run.expedition.mission_state.final_result.final_mission_state, result: entry.run.expedition.mission_state.final_result });
          const returned = entry.phase?.phase_id === "RETURN" ? { ok: true, phase: entry.phase } : phases.transition(entry.phase, "RETURN", { reason: verb.toLowerCase(), guard: true });
          entry.phase = returned.ok ? phases.transition(returned.phase, "DEBRIEF", { reason: "mission-review", guard: true }).phase : entry.phase;
          bootstrap.evaluateMissionState(entry.run, "DEBRIEF");
        }
      }
      const missionUpdates = result.result?.mission_updates ?? entry.run?._last_mission_updates ?? [];
      this.persistSession(world, mode, entry);
      const scene = this.sceneFor(entry, mode, { action: verb, scene_type: verb === "LOOK" ? "observation" : "delta", accepted: true, public_reason: result.result?.public_reason ?? result.public_reason }, world);
      return { ok: true, result: { outcome: result.outcome ?? "succeeded", public_reason: result.result?.public_reason ?? result.public_reason ?? null, mission_updates: missionUpdates, scene }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`action failed: ${error.message}`); return publicError("ACTION_RUNTIME_ERROR", "Yellow Beast could not complete that action safely."); }
  }
  naturalContext(world, mode, entry) {
    const projection = this.projectionFor(world, mode, entry); const actions = this.availableFor(world, mode, entry);
    const labels = [...new Set(actions.flatMap((action) => action.targets ?? []).map((target) => target.label).filter(Boolean))];
    const surface = projection.surface ?? {}; const location = surface.view?.location?.alias ?? surface.surroundings?.location?.alias ?? surface.base?.known_access_point ?? "the current setting";
    return { version: "yellow-beast-interpretation-context@v1", profile_title: projection.mode.label, scenario: projection.mode.description, lifecycle: "active", observer_location: location, visible_reference_labels: labels, known_resource_labels: surface.status?.carried ?? [], public_reason: null, grounding: { version: "yellow-beast-observer-grounding-context@v1", candidates: labels.map((label) => ({ ref: label, label, category: "entity", source: "visible", aliases: [label], attributes: [] })) } };
  }
  q4InterpretationContext(world, entry) {
    const projection = this.projectionFor(world, "field-researcher", entry); const view = projection.q4; const actions = projection.available_actions;
    const targets = [...new Map(actions.flatMap((action) => action.targets ?? []).filter((item) => item.label).map((item) => [item.label, item])).values()];
    const local = (view.team ?? []).filter((person) => !person.controlled && person.local_eligible).map((person) => ({ name: person.display_name, role: person.role, observed_condition: person.condition, contact: "speaking-range" }));
    const lastKnown = (view.team ?? []).filter((person) => !person.controlled && !person.local_eligible).map((person) => ({ name: person.display_name, role: person.role, observed_condition: person.condition, contact: person.contact_state ?? "last-known" }));
    const recentActions = (view.channels?.action?.history ?? []).slice(-5).map((item) => ({ attempt: item.player_text ?? item.attempted_behavior, result: item.presentation?.result ?? item.result, at: item.at ?? null }));
    return {
      version: "yellow-beast-interpretation-context@v2",
      authority_contract: { doctrine: "Simulation Doctrine", order: ["canonical-world", "simulation", "institution", "observation", "presentation"], generation_role: "candidate-only", prohibitions: ["no hidden-state inference", "no canonical invention", "no internal identity disclosure"] },
      worldpack_authority: { id: entry.run.spatial_pack_id, operation: "Clear-Q4", threshold_anchor: "fixed", geography: "persistent-canonical-results" },
      phase: entry.phase?.phase_id, lifecycle: entry.run.lifecycle,
      assignment: { display_id: view.mission_record?.display_id, objective: view.display_mission, required_objectives: (view.objectives ?? []).filter((item) => item.required).map((item) => ({ label: item.label, state: item.state, next: item.next_requirement })), restrictions: view.restrictions, reporting: view.reporting },
      observer: { name: view.player?.name, role: view.player?.role, condition: view.player?.condition, location: view.current_location?.name },
      observation: { description: view.field_observation, visible_objects: (view.interactables ?? []).map((item) => item.name ?? item.label), visible_routes: (view.map?.unresolved_exits ?? []).map((item) => item.label), local_witnesses: local },
      personnel_boundaries: { co_present: local, separated_last_known: lastKnown },
      institution: { standard_contact: view.channels?.standard?.state_label, standard_known_locations: (view.standard_spatial_record?.nodes ?? []).map((item) => item.name), unreported_player_locations: (view.map?.nodes ?? []).filter((node) => !(view.standard_spatial_record?.nodes ?? []).some((known) => known.id === node.id)).map((item) => item.name) },
      recent_observer_events: recentActions,
      unresolved_player_intent: entry.run.interpretation_state?.unresolved_intent ?? null,
      visible_reference_labels: targets.map((item) => item.label), known_resource_labels: (view.equipment?.required ?? []).map((item) => item.label), public_reason: recentActions.at(-1)?.result ?? null,
      grounding: { version: "yellow-beast-observer-grounding-context@v1", candidates: [
        ...targets.map((item) => ({ ref: item.ref, label: item.label, category: "entity", source: "visible", aliases: [item.label], attributes: [] })),
        ...local.map((person) => ({ ref: person.name, label: person.name, category: "person", source: "visible", aliases: [person.name], attributes: [person.role] }))
      ] }
    };
  }
  resolveQ4Attempt({ world_id, mode, entry, plan }) {
    const phase = entry.phase?.phase_id;
    const language = [plan.intent?.goals ?? [], plan.steps.map((step) => step.attempted_behavior), plan.intent?.methods ?? []].flat().join(" ").toLowerCase();
    const affordance = { BRIEFING: ["ready", "stage", "confirm"], STAGING: ["proceed", "depart", "prepare"], FACILITY_TRANSIT: ["approach", "continue", "reach"], THRESHOLD: ["cross", "enter"] }[phase];
    let result = null;
    if (affordance?.some((term) => language.includes(term))) result = this.submitAction({ world_id, mode, action: { BRIEFING: "READY", STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "CROSS" }[phase] });
    if (!result && ["FIELD_OPERATION", "RETURN"].includes(phase)) {
      const attempted = plan.steps.map((step) => step.attempted_behavior).join(" then ");
      const objectAttempt = objectRuntime.interpret(entry.run.object_state, bootstrap.interactionDefinitionFor(entry.run.spatial_pack_id), attempted, { location: entry.run.spatial.player_location });
      if (objectAttempt.kind === "interaction") result = this.submitAction({ world_id, mode, action: objectAttempt.action.toUpperCase(), target: objectAttempt.target });
      if (!result) { const members = entry.run.expedition.team.members.filter((member) => member.personnel_id !== entry.run.session.startup.player.observer_id); const parsed = spatialRuntime.interpret(entry.run.spatial, bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id), attempted, { personnel: members.map((member) => ({ id: member.personnel_id, name: member.display_name, first_name: member.first_name })) }); if (parsed.kind === "move") result = this.submitAction({ world_id, mode, action: "MOVE", target: parsed.target }); else if (parsed.kind === "inspect") result = this.submitAction({ world_id, mode, action: "INSPECT", target: parsed.target }); }
    }
    const accepted = Boolean(result?.ok); const location = entry.run.spatial ? spatialRuntime.currentLocation(entry.run.spatial, bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id))?.name : null;
    const summary = result?.result?.public_reason ?? (accepted ? "The attempted behavior produces the recorded operational result." : `Nothing in the current ${location ?? "operational context"} supports that attempted change. No physical or institutional consequence is recorded.`);
    if (!accepted) entry.run.interpretation_state = { unresolved_intent: language, reason: summary };
    else entry.run.interpretation_state = { unresolved_intent: null, reason: summary };
    return { result: { accepted, duplicate: false, canonical_event_ids: result?.result?.canonical_event_ids ?? [], attempted_steps: plan.steps.map((step) => step.id), completed_steps: accepted ? plan.steps.map((step) => step.id) : [], failed_steps: accepted ? [] : plan.steps.map((step) => step.id), interrupted_steps: [], partial_steps: [], time_advanced: result?.result?.time_advanced ?? 0, observer_safe_summary: summary } };
  }
  modeScene(world, mode, entry, natural) {
    const surface = entry.kind === "lost" ? lost.projection(entry.run) : entry.kind === "nullzone" ? { ...nullzone.projection(world), local_observation: nullzone.observeRegion(world) } : entry.kind === "beck" ? desk.projection(world) : {}; const location = surface.view?.location?.alias ?? surface.surroundings?.location?.alias ?? surface.base?.known_access_point ?? "the current setting";
    const scene = { version: "yellow-beast-scene@v1", scene_id: `scene-${crypto.createHash("sha256").update(`${world.world_id}:${mode}:${Date.now()}`).digest("hex").slice(0, 20)}`, world_ref: world.world_id, session_ref: entry.run_id ?? entry.run?.run_id ?? mode, turn_ref: "natural-attempt", observer_ref: mode, mode, profile: mode, scene_type: natural.consequence?.result?.accepted ? "delta" : "observation", significance: "ROUTINE", location: String(location), safe_facts: [{ id: "location", category: "location", text: String(location), required: true }], immediate_changes: [{ id: "consequence", category: "change", text: natural.consequence?.result?.observer_safe_summary ?? "Nothing observable changes here.", required: true }], visible_actors: [], communications: [], sensory_facts: [], inventory: [], object_state_changes: [], unresolved_facts: [], continuing_conditions: [], context: [], interaction_prompt: "What do you do?", provenance: { source: "observer-safe-mode-projection", input: "player-supplied" } };
    return { ...scene, narration: fallbackNarration(scene), narration_source: "fallback" };
  }
  async submitNatural({ world_id, mode, text }) {
    try {
      const world = this.getWorld(world_id);
      const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null));
      if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue this session first.");
      if (entry.kind === "bootstrap" && ["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id) && entry.run.spatial) {
        const members = entry.run.expedition.team.members.filter((member) => member.personnel_id !== entry.run.session.startup.player.observer_id);
        const objectAttempt = objectRuntime.interpret(entry.run.object_state, bootstrap.interactionDefinitionFor(entry.run.spatial_pack_id), text, { location: entry.run.spatial.player_location });
        if (objectAttempt.kind === "interaction") return this.submitAction({ world_id, mode, action: objectAttempt.action.toUpperCase(), target: objectAttempt.target });
        if (objectAttempt.kind === "ambiguous") return publicError("INTERACTION_TARGET_AMBIGUOUS", objectAttempt.reason);
        const parsed = spatialRuntime.interpret(entry.run.spatial, bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id), text, { personnel: members.map((member) => ({ id: member.personnel_id, name: member.display_name, first_name: member.first_name })) });
        if (parsed.kind === "move") return this.submitAction({ world_id, mode, action: "MOVE", target: parsed.target });
        if (parsed.kind === "inspect") return this.submitAction({ world_id, mode, action: /\b(orient|look around|take stock|inspect the room)\b/i.test(text) ? "LOOK" : "INSPECT", target: parsed.target });
        if (parsed.kind === "person" || parsed.kind === "follow") {
          const member = members.find((item) => item.personnel_id === parsed.person.id);
          const relationship = spatialRuntime.proximity(entry.run.spatial, entry.run.session.startup.player.observer_id, member?.personnel_id);
          const person = member ? history.character(world, member.personnel_id) : null;
          const reason = !member ? "That person is not part of the current assignment." : parsed.kind === "follow" && relationship.speaking_range ? `${member.first_name} is beside you and has not started down a route. The team remains together.` : relationship.speaking_range ? `${member.first_name} is beside you, appears ${String(member.observed_condition ?? person?.condition ?? "normal").replace(/-/g, " ")}, and remains within speaking range.` : `${member.first_name}'s last confirmed position is ${entry.run.spatial.last_confirmed_personnel_positions[member.personnel_id]?.location ?? "not currently visible"}.`;
          q4Interactions.record(entry.run.expedition, { channel: "action", speaker: "YOU", targets: member ? [member.display_name] : [], player_text: text, attempted_behavior: parsed.kind === "follow" ? "follow assigned coworker" : "check assigned coworker", eligibility: member ? "eligible" : "rejected", delivery: "not-applicable", presentation: { result: reason } });
          this.persistSession(world, mode, entry);
          const scene = this.sceneFor(entry, mode, { action: "LOOK", scene_type: "observation", accepted: Boolean(member), public_reason: reason }, world);
          return { ok: true, result: { outcome: member ? "succeeded" : "rejected", executed: Boolean(member), public_reason: reason, scene }, projection: this.projectionFor(world, mode, entry) };
        }
        // The bounded interpreter receives only the observer-safe operational
        // context below. Its candidate still has to resolve through the same
        // object/spatial authorities; unsupported intent cannot mutate reality.
      }
      const configured = this.settings().provider === "openai"; const key = configured ? this.credentials.get("openai") : null;
      if (configured && !key) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Language assistance needs an access key. Your world is safe; you can continue offline.");
      const provider = configured ? createOpenAIProvider({ apiKey: key, model: this.settings().openai_model || undefined, timeout: 15000 }) : createMockProvider();
      const nonBootstrap = entry.kind !== "bootstrap"; const adapterRun = nonBootstrap ? { session: { startup: { player: { observer_id: mode } } }, profile_id: mode } : entry.run; const available = this.availableFor(world, mode, entry);
      const phaseBefore = entry.phase?.phase_id; const interpretationContext = nonBootstrap ? this.naturalContext(world, mode, entry) : this.q4InterpretationContext(world, entry); const turn = await executePlayerTurn({ run: adapterRun, mode, provider, player_text: text, request_id: `desktop-natural-${world_id}-${Date.now()}`, context: interpretationContext, consequenceResolver: entry.kind === "bootstrap" ? ({ plan }) => this.resolveQ4Attempt({ world_id, mode, entry, plan }) : ({ plan }) => resolveModeAttempt({ service: this, world_id, mode, plan, available }), sceneBuilder: entry.kind === "bootstrap" ? ({ natural: resolved }) => this.sceneFor(entry, mode, { scene_type: resolved.consequence?.result?.accepted ? "delta" : "observation", accepted: resolved.consequence?.result?.accepted, public_reason: resolved.consequence?.result?.observer_safe_summary }, world) : ({ natural: resolved }) => this.modeScene(world, mode, entry, resolved) });
      if (entry.kind === "bootstrap" && turn.save_required && phaseBefore === entry.phase?.phase_id) this.recordQ4Action(entry, text, { ok: true, result: { time_advanced: turn.consequence?.result?.time_advanced ?? 0, canonical_event_ids: turn.consequence?.result?.canonical_event_ids ?? [] } }, world);
      if (turn.save_required) this.persistSession(world, mode, entry);
      const scene = { ...turn.scene, narration: turn.narration.prose, narration_source: turn.narration.source };
      return { ok: true, result: { turn_status: turn.status, clarification_required: turn.status === "CLARIFICATION_REQUIRED", clarification_question: turn.clarification?.question ?? null, executed: turn.save_required, summary: scene.narration, scene }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`provider unavailable: ${error.message}`); return publicError("PROVIDER_UNAVAILABLE", "Language assistance is unavailable. Your world is safe. Continue using structured controls or try again."); }
  }
  shutdown() { for (const [key, entry] of this.sessions) { const [worldId, mode] = key.split(":"); try { this.persistSession(this.getWorld(worldId), mode, entry); } catch (error) { this.log(`shutdown save failed: ${error.message}`); } } return { ok: true }; }
}

module.exports = { DesktopService, MODES, DEFAULT_SETTINGS };
