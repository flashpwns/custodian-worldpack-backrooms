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
const { event: expeditionEvent } = require("../tools/expedition");
const beckExperience = require("../tools/beck-experience");
const nullzoneExperience = require("../tools/nullzone-experience");
const lostExperience = require("../tools/lost-experience");
const consequenceEchoes = require("../tools/consequence-echoes");
const { resolveAppPaths } = require("../tools/launcher-paths");
const { CredentialStore } = require("./credentials");
const developerInspection = require("../tools/dev-inspection");
const packageVersion = require("../package.json").version;

const clone = (value) => structuredClone(value);
const MODES = Object.freeze([
  { id: "async-command", gameplay_mode: "beck", label: "Async: Beck's Desk", role: "Institutional management", description: "Manage ASYNC operations, personnel, research, recovery, and infrastructure from inside the institution.", playable: false, roadmap_status: "Coming Soon", roadmap_position: 3 },
  { id: "field-researcher", gameplay_mode: "clear-q4", label: "Async: Clear-Q4", role: "Field research", description: "Enter the Complex as a field researcher operating under ASYNC orders.", playable: true, roadmap_status: "Playable now", roadmap_position: 1 },
  { id: "local-anomaly", gameplay_mode: "nullzone", label: "Nullzone Exposure", role: "Civilian investigation", description: "Investigate the Complex independently from a civilian base and personal archive.", playable: false, roadmap_status: "Coming Soon", roadmap_position: 4 },
  { id: "lost", gameplay_mode: "lost", label: "Lost", role: "Survival", description: "Survive and navigate the Complex with limited knowledge and uncertain escape.", playable: false, roadmap_status: "Coming Soon", roadmap_position: 2 }
]);
const DEFAULT_SETTINGS = Object.freeze({ version: 3, input_mode: "structured", provider: "offline", theme: "system", text_scale:"default", reduced_motion: false, guided_introductions: true, reopen_last_world: true, mode_onboarding: {} });
// Non-Q4 language is deliberately a small phrase-to-existing-control adapter.
// It cannot invent a target or capability: recognised phrases only select an
// action already available in the active, observer-safe session.
function publicError(code, message) { return { ok: false, error: { code, message } }; }
function safeId(value) { return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,100}$/i.test(value); }
function friendlyName(value) { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80; }
function ensureDirectory(directory) { fs.mkdirSync(directory, { recursive: true }); }
function readJson(file, fallback) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : clone(fallback); } catch { return clone(fallback); } }
function writeJson(file, value) { ensureDirectory(path.dirname(file)); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); JSON.parse(fs.readFileSync(temporary, "utf8")); fs.renameSync(temporary, file); }

class DesktopService {
  constructor({ appDataPath = null, paths = null, logger = null, credentials = null, developerMode = process.env.YELLOW_BEAST_DEVELOPER_MODE === "1" } = {}) {
    this.paths = paths ?? (appDataPath ? { root: appDataPath, worlds: path.join(appDataPath, "worlds"), saves: path.join(appDataPath, "saves"), logs: path.join(appDataPath, "logs"), config: path.join(appDataPath, "config.json") } : resolveAppPaths());
    this.metadataFile = path.join(this.paths.root, "desktop-worlds.json");
    this.settingsFile = path.join(this.paths.root, "desktop-settings.json");
    this.logger = logger ?? (() => {});
    this.credentials = credentials ?? new CredentialStore();
    this.developerMode = developerMode === true;
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

  getAppInfo() { const data = this.metadata(); return { ok: true, app: { name: "Yellow Beast", version: packageVersion, alpha: true, first_run_complete: Boolean(data.first_run_complete), data_path: this.paths.root, developer_mode:this.developerMode } }; }
  getDeveloperSnapshot({ world_id, mode = null } = {}) { if (!this.developerMode) return publicError("DEVELOPER_DISABLED", "Developer tooling is disabled."); try { const world = this.getWorld(world_id); const entry = mode ? (this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null))) : null; const provider = this.getProviderStatus().provider; return { ok:true, snapshot:developerInspection.snapshot(world), active:{ mode, phase:entry?.phase ?? null, session_kind:entry?.kind ?? null }, provider:{ selected:provider.selected, offline:provider.offline, configured:provider.openai.configured, status:provider.offline ? "offline" : provider.openai.status }, provider_safe_context:entry?.kind === "bootstrap" ? developerInspection.providerSafeContext(entry.run) : null, recent_history:developerInspection.recentHistory(world) }; } catch { return publicError("DEVELOPER_SNAPSHOT_UNAVAILABLE", "The selected world could not be inspected."); } }
  async traceDeveloperIntent({ world_id, mode, text }) { if (!this.developerMode) return publicError("DEVELOPER_DISABLED", "Developer tooling is disabled."); try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry || entry.kind !== "bootstrap") return publicError("TRACE_UNAVAILABLE", "A Clear-Q4 session is required for this non-executing trace."); return { ok:true, trace:await developerInspection.intentTrace({ run:entry.run, provider:createMockProvider(), player_text:text }) }; } catch { return publicError("TRACE_UNAVAILABLE", "The selected session could not be traced."); } }
  listModes() { return { ok: true, modes: clone([...MODES].sort((a, b) => a.roadmap_position - b.roadmap_position)) }; }
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
  updateSettings({ settings }) { if (!settings || typeof settings !== "object") return publicError("SETTINGS_INVALID", "Settings were not understood."); const next = { ...this.settings() }; if (settings.input_mode && !["structured", "natural"].includes(settings.input_mode)) return publicError("SETTINGS_INVALID", "Choose a supported input mode."); if (settings.provider && !["offline", "openai"].includes(settings.provider)) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Choose offline play or configured language assistance."); if (settings.provider === "openai" && !this.credentials.configured("openai")) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Add an access key first, or continue offline."); if (settings.theme && !["system", "light", "dark", "high-contrast"].includes(settings.theme)) return publicError("SETTINGS_INVALID", "Choose a supported appearance."); if (settings.text_scale && !["small", "default", "large", "extra-large"].includes(settings.text_scale)) return publicError("SETTINGS_INVALID", "Choose a supported text size."); if (settings.reduced_motion !== undefined && typeof settings.reduced_motion !== "boolean") return publicError("SETTINGS_INVALID", "Reduced motion must be on or off."); if (settings.guided_introductions !== undefined && typeof settings.guided_introductions !== "boolean") return publicError("SETTINGS_INVALID", "Guided introductions must be on or off."); Object.assign(next, settings); delete next.api_key; writeJson(this.settingsFile, next); return { ok: true, settings: next };
  }
  getProviderStatus() { const selected = this.settings().provider; const configured = this.credentials.configured("openai"); return { ok: true, provider: { selected, offline: selected === "offline", openai: { configured, status: selected === "openai" ? (configured ? "ready" : "configuration-required") : "inactive" }, local_provider: { supported: false, status: "not-available" } } }; }
  configureOpenAI({ api_key, model = null }) { const stored = this.credentials.set("openai", api_key); if (!stored.ok) return publicError(stored.code, "Enter a valid OpenAI key."); const next = { ...this.settings(), provider: "openai", input_mode: "natural" }; if (model && typeof model === "string" && model.length <= 120) next.openai_model = model; writeJson(this.settingsFile, next); return { ok: true, provider: { configured: true, persistent: stored.persistent } }; }
  removeOpenAIKey() { this.credentials.remove("openai"); const next = { ...this.settings(), provider: "offline", input_mode: "structured" }; delete next.openai_model; writeJson(this.settingsFile, next); return { ok: true }; }
  testProvider() { const status = this.getProviderStatus().provider; if (status.selected === "offline") return { ok: true, status: "ready", message: "Offline structured play is ready." }; if (!status.openai.configured) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "OpenAI needs a key. You can continue offline at any time."); return { ok: true, status: "ready", message: "OpenAI is configured. Connection is tested when you choose natural-language input." }; }
  renameWorld({ world_id, name }) { if (!friendlyName(name)) return publicError("WORLD_NAME_INVALID", "Choose a world name between 1 and 80 characters."); const data = this.metadata(); if (!data.worlds[world_id]) return publicError("WORLD_NOT_FOUND", "This world no longer exists."); data.worlds[world_id].name = name.trim(); this.writeMetadata(data); return { ok: true, world: this.loadWorld({ world_id }).world }; }
  restoreBackup({ world_id, confirmed = false }) { if (confirmed !== true) return publicError("RESTORE_CONFIRMATION_REQUIRED", "Confirm that restoring the previous save may lose recent changes."); try { const backup = this.backupFile(world_id); if (!fs.existsSync(backup)) return publicError("BACKUP_UNAVAILABLE", "No previous save is available for this world."); history.loadWorld(backup); fs.copyFileSync(backup, this.worldFile(world_id)); return { ok: true, world: this.loadWorld({ world_id }).world }; } catch { return publicError("BACKUP_RESTORE_FAILED", "The previous save could not be restored safely."); } }
  exportBrokenWorld({ world_id, destination }) { try { const source = this.worldFile(world_id); if (!destination || !path.isAbsolute(destination) || !fs.existsSync(source)) return publicError("EXPORT_DESTINATION_INVALID", "Choose a destination for this world file."); fs.copyFileSync(source, destination); return { ok: true, file: destination }; } catch { return publicError("EXPORT_FAILED", "The world file could not be copied."); } }
  getDiagnostics() { const status = this.getProviderStatus().provider; return { ok: true, diagnostics: { app_version: packageVersion, platform: process.platform, provider: status.selected, provider_status: status.offline ? "offline" : status.openai.status, save_directory: "managed application data", credentials_configured: status.openai.configured, telemetry: "disabled" } }; }
  serializeSession(world, mode, entry) { const phase = entry.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (entry.kind === "bootstrap") return { version: 1, mode, kind: entry.kind, phase, payload: bootstrap.saveRun(entry.run) }; if (entry.kind === "lost") return { version: 1, mode, kind: entry.kind, phase, payload: clone(entry.run) }; return { version: 1, mode, kind: entry.kind, phase, payload: clone(entry) }; }
  restoreSession(world, mode, saved) { if (saved?.mode !== mode) return null; const phase = saved.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (saved.kind === "bootstrap") { const restored = bootstrap.resumeRun(saved.payload, { world }); return restored.ok ? { kind: "bootstrap", run: restored.run, phase } : null; } if (saved.kind === "lost") return { kind: "lost", run: saved.payload, phase }; if (saved.kind === "nullzone") return { kind: "nullzone", run_id: saved.payload.run_id, phase }; if (saved.kind === "beck") return { kind: "beck", run_id: saved.payload.run_id, phase }; return null; }
  session(worldId, mode) { return this.sessions.get(`${worldId}:${mode}`) ?? null; }
  persistSession(world, mode, entry) { if (entry.kind === "bootstrap") q4Equipment.syncWorld(world, entry.run.expedition); writeJson(this.sessionFile(world.world_id, mode), this.serializeSession(world, mode, entry)); this.sessions.set(`${world.world_id}:${mode}`, entry); this.saveCanonical(world); const data = this.metadata(); if (data.worlds[world.world_id]) { data.worlds[world.world_id].last_played_at = new Date().toISOString(); data.worlds[world.world_id].last_mode = mode; data.last_world_id = world.world_id; this.writeMetadata(data); } }
  startSession({ world_id, mode, seed = "desktop" }) {
    try { const world = this.getWorld(world_id); const descriptor = this.getMode(mode); if (!descriptor) return publicError("MODE_INVALID", "Choose one of the available roles."); let entry;
      if (mode === "field-researcher") { const started = bootstrap.startRun({ profile: mode, seed, scenario: "procedural-survey", world }); if (!started.ok) return publicError("SESSION_START_FAILED", "The field session could not start."); entry = { kind: "bootstrap", run: started.run, phase: phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }) }; }
      else if (mode === "lost") entry = { kind: "lost", run: lost.start(world, seed), phase: phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }) };
      else { const run_id = history.beginRun(world, { profile: mode, scenario: mode === "async-command" ? "becks-desk-operations" : "nullzone-exposure", seed }); if (mode === "local-anomaly") { const prepared = nullzone.prepare(world, run_id, ["field-light", "recording-device", "evidence-container"]); if (!prepared.ok || !nullzone.enter(world, run_id).ok) return publicError("SESSION_START_FAILED", "The civilian excursion could not start."); entry = { kind: "nullzone", run_id }; } else entry = { kind: "beck", run_id }; }
      entry.phase ??= phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); this.persistSession(world, mode, entry); return { ok: true, session: { world_id, mode, resumable: true }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`session start failed: ${error.message}`); return publicError("SESSION_START_FAILED", "This session could not start safely."); }
  }
  resumeSession({ world_id, mode }) { try { const world = this.getWorld(world_id); const saved = readJson(this.sessionFile(world_id, mode), null); const entry = this.restoreSession(world, mode, saved); if (!entry) return publicError("SESSION_NOT_FOUND", "There is no compatible session to continue."); this.sessions.set(`${world_id}:${mode}`, entry); return { ok: true, session: { world_id, mode, resumable: true }, projection: this.projectionFor(world, mode, entry) }; } catch { return publicError("SESSION_RESUME_FAILED", "This session could not be resumed safely."); } }
  briefingScene(entry, mode, phaseId = entry.phase?.phase_id, world = null) {
    const view = q4.presentation(entry.run, entry.phase ?? phases.createPhase({ mode }), null, world);
    const team = view.team.map((member) => member.display_name).join(" and ") || "the assigned field team";
    const equipment = (view.equipment?.required ?? []).map((item) => item.label).join(", ") || "the assigned field kit";
    const facts = [
      ["location", "location", phaseId === "BRIEFING" ? "an ASYNC operations briefing context" : phaseId === "STAGING" ? "an ASYNC staging context" : phaseId === "FACILITY_TRANSIT" ? "a controlled facility transit context" : "the approach to the Threshold"],
      ["assignment", "assignment", view.display_mission ?? "the Clear-Q4 field assignment"],
      ["team", "personnel", `Assigned personnel: ${team}.`],
      ["equipment", "readiness", `Readiness: ${equipment}.`],
      ["reporting", "reporting", view.reporting ? `Reporting: ${view.reporting}.` : "Reporting expectations will be confirmed before departure."],
      ["next-step", "next-step", phaseId === "BRIEFING" ? "Before departure, review the assignment and confirm readiness to stage." : phaseId === "STAGING" ? "The next step is to proceed with the team and equipment." : phaseId === "FACILITY_TRANSIT" ? "The next step is to approach the Threshold with the team accounted for." : "Crossing the Threshold remains a player decision after the approach is complete."]
    ].map(([id, category, text]) => ({ id, category, text, required: true }));
    const context = [
      ...(view.restrictions ?? []).map((text, index) => ({ id: `constraint-${index + 1}`, category: "constraint", text, required: false })),
      ...(view.human_context?.procedures ?? []).map((text, index) => ({ id: `procedure-${index + 1}`, category: "procedure", text, required: false }))
    ];
    const scene = { version: "yellow-beast-scene@v1", scene_id: `briefing-${entry.run.run_id ?? entry.run.session.id}`, world_ref: entry.run.world_id ?? null, session_ref: entry.run.session.id, turn_ref: "briefing", observer_ref: "yb-field-player", mode, profile: "clear-q4", scene_type: "briefing", significance: "MEANINGFUL", location: facts[0].text, safe_facts: facts, immediate_changes: [], visible_actors: [], communications: [], sensory_facts: [], inventory: [], object_state_changes: [], unresolved_facts: [], continuing_conditions: [], context, interaction_prompt: "Confirm when you are ready to stage.", provenance: { source: "observer-safe-q4-briefing", input: null } };
    const sentence = (text) => String(text).replace(/[.]+$/, "") + ".";
    scene.narration = `You are in ${sentence(facts[0].text)} ${facts.slice(1).map((fact) => sentence(fact.text)).join(" ")}`;
    scene.narration_source = "fallback";
    return scene;
  }
  sceneFor(entry, mode, options = {}, world = null) { if (entry.kind === "bootstrap") { const phase = options.phase ?? entry.phase?.phase_id; if (phase !== "FIELD_OPERATION" && phase !== "RETURN" && phase !== "DEBRIEF") return this.briefingScene(entry, mode, phase, world); const scene = buildSafeScene({ run: entry.run, mode, ...options }); return { ...scene, narration: fallbackNarration(scene), narration_source: "fallback" }; } return this.modeScene(world, mode, entry, { consequence: { result: { accepted: options.accepted !== false, observer_safe_summary: options.public_reason ?? "The current situation remains unchanged." } } }); }
  projectionFor(world, mode, entry) { const descriptor = this.getMode(mode); const runId = entry.run_id ?? entry.run?.run_id ?? null; let surface;
    if (entry.kind === "bootstrap") surface = bootstrap.status(entry.run); else if (entry.kind === "lost") surface = lost.projection(entry.run); else if (entry.kind === "nullzone") surface = { ...nullzone.projection(world), local_observation: nullzone.observeRegion(world) }; else surface = desk.projection(world);
    const phase = entry.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); const unfinished = consequenceEchoes.unfinishedBusiness(world, mode, { run_id: runId }); return { version: "yellow-beast-desktop-projection@v1", world: this.worldInfo(world, this.metadata().worlds[world.world_id] ?? {}), mode: clone(descriptor), gameplay: gameplay.projection(world, { mode: descriptor.gameplay_mode, run_id: runId }), institution: mode === "async-command" ? desk.projection(world) : null, consequence_echoes: consequenceEchoes.observerView(world, mode, { run_id: runId }), unfinished_business: unfinished, surface: clone(surface), phase: clone(phase), q4: entry.kind === "bootstrap" ? q4.presentation(entry.run, phase, unfinished, world) : null, beck: entry.kind === "beck" ? beckExperience.presentation(world, surface, phase, unfinished) : null, nullzone: entry.kind === "nullzone" ? nullzoneExperience.presentation(world, phase, surface, unfinished) : null, lost: entry.kind === "lost" ? lostExperience.presentation(surface, phase, unfinished) : null, scene: this.sceneFor(entry, mode, {}, world), available_actions: this.availableFor(world, mode, entry), settings: this.settings() };
  }
  getGameplayProjection({ world_id, mode }) { try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue a session first."); return { ok: true, projection: this.projectionFor(world, mode, entry) }; } catch { return publicError("PROJECTION_UNAVAILABLE", "Gameplay state is not available."); } }
  getInstitutionProjection({ world_id }) { try { return { ok: true, projection: desk.projection(this.getWorld(world_id)) }; } catch { return publicError("INSTITUTION_UNAVAILABLE", "Institution state is not available."); } }
  availableFor(world, mode, entry) {
    if (entry.kind === "bootstrap") {
      const phaseActions = { BRIEFING: "READY", STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "CROSS" };
      const state = bootstrap.status(entry.run); const observed = bootstrap.look(entry.run); const targets = state.view.targets.map(({ alias }) => ({ ref: alias, label: alias })); const exits = (observed.view?.exits ?? []).map(({ alias }) => ({ ref: alias, label: alias }));
      const actions = state.available_verbs.filter((type) => type !== "COMMUNICATE" || entry.phase?.phase_id !== "BRIEFING").map((type) => ({ type, target_required: ["MOVE", "INSPECT", "USE", "RECORD", "COMMUNICATE"].includes(type), targets: type === "COMMUNICATE" ? [{ ref: "standard", label: "Standard" }, { ref: "team", label: "Team" }] : type === "MOVE" ? exits : ["INSPECT", "RECORD"].includes(type) ? targets : type === "USE" ? [{ ref: "survey-instrument", label: "Survey instrument" }] : [] }));
      return phaseActions[entry.phase?.phase_id] ? [{ type: phaseActions[entry.phase.phase_id], target_required: false, targets: [] }, ...actions] : actions;
    }
    if (entry.kind === "lost") { const view = lost.projection(entry.run); return [{ type: "MOVE", target_required: true, targets: view.surroundings.exits.map(({ alias }) => ({ ref: alias, label: alias })) }, { type: "DROP", target_required: true, targets: view.status.carried.map((item) => ({ ref: item, label: item })) }, { type: "RETURN", target_required: false, targets: [] }, { type: "STRAND", target_required: false, targets: [] }]; }
    if (entry.kind === "nullzone") return [{ type: "EXPAND", target_required: false, targets: [] }, { type: "DISCOVER", target_required: false, targets: [] }, { type: "RETURN", target_required: false, targets: [] }];
    return [{ type: "REVIEW_REPORT", target_required: false, targets: [] }, { type: "ADVANCE", target_required: false, targets: [] }];
  }
  getAvailableActions({ world_id, mode }) { const current = this.getGameplayProjection({ world_id, mode }); return current.ok ? { ok: true, actions: current.projection.available_actions } : current; }
  recordQ4Action(entry, text, result) {
    return q4Interactions.record(entry.run.expedition, { channel: "action", speaker: "You", targets: [], player_text: text, attempted_behavior: text, eligibility: result.ok ? "eligible" : "rejected", delivery: "not-applicable", time_cost: result.result?.time_advanced ?? (/^WAIT\b/.test(text) ? 1 : 0), canonical_effects: result.result?.canonical_event_ids ?? [], presentation: { result: result.ok ? result.outcome ?? "succeeded" : result.error?.code ?? "rejected" } });
  }
  submitQ4Communication({ world_id, channel, text, target = null }) {
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before communicating.");
      if (!q4Interactions.CHANNELS.includes(channel) || channel === "action") return publicError("CHANNEL_INVALID", "Choose a communication channel.");
      const message = typeof text === "string" ? text.trim().slice(0, 2000) : "";
      if (!message) return publicError("COMMUNICATION_EMPTY", "Say or transmit something before sending it.");
      const expedition = entry.run.expedition; const peer = expedition.team.members.find((member) => member.personnel_id !== entry.run.session.startup.player.observer_id); const person = history.character(world, peer?.personnel_id ?? peer?.id); const observed = q4Personnel.observerStatus(peer, person, entry.phase?.phase_id);
      const field = entry.phase?.phase_id === "FIELD_OPERATION";
      if (channel === "local") {
        const acceptedTargets = ["team", "teammate", peer?.personnel_id, peer?.first_name, peer?.display_name].filter(Boolean).map((value) => String(value).toLowerCase());
        const eligible = field && observed.local_eligible && (!target || acceptedTargets.includes(String(target).toLowerCase()));
        if (!eligible) {
          q4Interactions.record(expedition, { channel, speaker: "You", targets: [peer?.display_name ?? "no nearby teammate"], player_text: message, attempted_behavior: "speak with a nearby teammate", eligibility: "target-out-of-range", delivery: "not-delivered", presentation: { result: "The teammate is not available for a local conversation here." } });
          this.persistSession(world, "field-researcher", entry);
          return publicError("LOCAL_TARGET_UNAVAILABLE", "No nearby teammate is available for local conversation here.");
        }
        const request = /\b(hand|pass|give|bring|transfer)\b/i.test(message);
        const response = request ? `${peer.first_name}: I hear the request. The equipment remains with me until we complete a physical handoff.` : `${peer.first_name}: I can hear you. I can answer from what the team has shared locally.`;
        const interaction = q4Interactions.record(expedition, { channel, speaker: "You", targets: [peer.display_name], player_text: message, attempted_behavior: "speak with a nearby teammate", eligibility: "eligible", delivery: "heard", time_cost: 1, presentation: { result: "heard", response } });
        this.persistSession(world, "field-researcher", entry);
        const scene = this.sceneFor(entry, "field-researcher", { scene_type: "delta", accepted: true, action: "LOCAL", public_reason: response }, world);
        return { ok: true, result: { outcome: "succeeded", public_reason: response, scene }, projection: this.projectionFor(world, "field-researcher", entry) };
      }
      const radio = expedition.equipment?.["survey-radio"];
      if (entry.phase?.phase_id === "BRIEFING" || !q4Equipment.stateUsable(radio) || radio.holder !== entry.run.session.startup.player.observer_id || radio.charges <= 0) {
        q4Interactions.record(expedition, { channel, speaker: "You", targets: ["Standard"], player_text: message, attempted_behavior: "transmit over the survey radio", eligibility: "radio-unavailable", delivery: "not-delivered", presentation: { result: "The radio channel is not available from this operational context." } });
        this.persistSession(world, "field-researcher", entry);
        return publicError("STANDARD_UNAVAILABLE", "The Standard radio channel is not available from here.");
      }
      const delivered = bootstrap.act(entry.run, "COMMUNICATE", "standard");
      if (!delivered.ok) return publicError("STANDARD_UNAVAILABLE", "The Standard radio channel could not receive the transmission.");
      const interaction = q4Interactions.record(expedition, { channel, speaker: "You", targets: ["Standard"], player_text: message, attempted_behavior: "transmit over the survey radio", eligibility: "eligible", delivery: "delivered", time_cost: 1, canonical_effects: ["communication.sent"], observer_knowledge: [{ observer: "Standard", kind: "reported-communication", text: message }], presentation: { result: "delivered" } });
      history.event(world, entry.run.run_id, "q4.communication.reported", { interaction_id: interaction.id, endpoint: "Standard", report: message, status: "reported" });
      history.recordInstitutional(world, entry.run.run_id, `q4-reported-communication-${entry.run.run_id}-${interaction.id}`, { channel: "standard", report: message, status: "reported", source_interaction: interaction.id });
      this.persistSession(world, "field-researcher", entry);
      const scene = this.sceneFor(entry, "field-researcher", { scene_type: "delta", accepted: true, action: "STANDARD", public_reason: "The transmission is delivered as a report." }, world);
      return { ok: true, result: { outcome: "succeeded", public_reason: "The transmission is delivered as a report.", scene }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) { this.log(`Q4 communication failed: ${error.message}`); return publicError("COMMUNICATION_RUNTIME_ERROR", "The communication could not be resolved safely."); }
  }
  submitQ4Handoff({ world_id, item_id, target = null }) {
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before handing over equipment.");
      const player = entry.run.session.startup.player.observer_id; const peer = entry.run.expedition.team.members.find((member) => member.personnel_id !== player); const peerPerson = history.character(world, peer?.personnel_id ?? peer?.id); const observed = q4Personnel.observerStatus(peer, peerPerson, entry.phase?.phase_id);
      const targetText = String(target ?? peer?.first_name ?? "").toLowerCase(); const validTarget = observed.local_eligible && [peer?.personnel_id, peer?.first_name, peer?.display_name, "team", "teammate"].filter(Boolean).map((value) => String(value).toLowerCase()).includes(targetText);
      if (!validTarget) return publicError("HANDOFF_TARGET_UNAVAILABLE", "That person is not available for a physical handoff here.");
      const key = entry.run.expedition.equipment[item_id] ? item_id : Object.entries(entry.run.expedition.equipment).find(([, item]) => item.id === item_id)?.[0];
      const transferred = q4Equipment.transfer(entry.run.expedition, key, player, peer.personnel_id, "with teammate");
      if (!transferred.ok) return publicError(transferred.code, "The equipment cannot be handed over in its current condition.");
      q4Interactions.record(entry.run.expedition, { channel: "action", speaker: "You", targets: [peer.display_name], player_text: `hand over ${transferred.item.label}`, attempted_behavior: "physically hand equipment to a nearby teammate", eligibility: "eligible", delivery: "transferred", time_cost: 1, canonical_effects: ["equipment.handoff"], presentation: { result: "transferred" } });
      history.event(world, entry.run.run_id, "q4.equipment.handed_over", { equipment_id: transferred.item.id, from: player, to: peer.personnel_id });
      this.persistSession(world, "field-researcher", entry);
      return { ok: true, result: { outcome: "succeeded", public_reason: `${peer.first_name} takes the ${transferred.item.label}.` }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) { this.log(`Q4 handoff failed: ${error.message}`); return publicError("HANDOFF_RUNTIME_ERROR", "The physical handoff could not be resolved safely."); }
  }
  selectQ4OptionalStore({ world_id, item_id }) {
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before selecting stores.");
      if (entry.phase?.phase_id !== "STAGING") return publicError("STAGING_REQUIRED", "Optional stores can only be selected during staging.");
      const selected = q4Equipment.selectOptional(entry.run.expedition, item_id, entry.run.session.startup.player.observer_id);
      if (!selected.ok) return publicError(selected.code, "That optional store is not available from staging.");
      expeditionEvent(entry.run.expedition, "q4.loadout.optional_selected", { equipment_id: selected.item.id, type: selected.item.type });
      this.persistSession(world, "field-researcher", entry);
      return { ok: true, result: { outcome: "succeeded", public_reason: `${selected.item.label} added to the field case.` }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) { this.log(`Q4 store selection failed: ${error.message}`); return publicError("STAGING_RUNTIME_ERROR", "The optional store could not be selected safely."); }
  }
  submitAction({ world_id, mode, action, target = null }) {
    try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue a session first."); const verb = String(action ?? "").toUpperCase(); let result;
      if (entry.kind === "bootstrap" && verb === "COMMUNICATE") return this.submitQ4Communication({ world_id, channel: String(target).toLowerCase() === "standard" ? "standard" : "local", text: String(target).toLowerCase() === "standard" ? "Check-in to Standard." : "Check in with the team.", target });
      if (entry.kind === "bootstrap" && ["READY", "PROCEED", "APPROACH", "CROSS"].includes(verb)) {
        const phase = entry.phase?.phase_id;
        const expected = { BRIEFING: "READY", STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "CROSS" }[phase];
        if (verb !== expected) return publicError("PHASE_GUARD_REJECTED", "That transition is not available from the current expedition phase.");
        if (verb === "CROSS") {
          const exit = bootstrap.look(entry.run).view?.exits?.[0]?.alias;
          result = exit ? bootstrap.act(entry.run, "MOVE", exit) : { ok: false, code: "PHASE_GUARD_REJECTED" };
          if (result.ok) { const advanced = q4.nextPhase(entry.phase, { action: verb, canonical_crossed: true }); if (!advanced.ok) return publicError(advanced.code, "The expedition cannot cross from its current state."); entry.phase = advanced.phase; q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id); }
        } else {
          result = { ok: true, outcome: "phase-advanced" };
          if (verb === "PROCEED") { const readiness = q4Equipment.projection(entry.run.expedition, entry.run.session.startup.player.observer_id); if (!readiness.readiness) { entry.run.expedition.deviations.push("proceeded-with-required-equipment-unavailable"); expeditionEvent(entry.run.expedition, "q4.loadout.proceeded_without_required", { missing: readiness.missing }); } }
          const advanced = q4.nextPhase(entry.phase, { action: verb }); if (!advanced.ok) return publicError(advanced.code, "The expedition cannot advance from its current state."); entry.phase = advanced.phase; q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id);
        }
      } else if (entry.kind === "bootstrap") result = bootstrap.act(entry.run, verb, target);
      else if (entry.kind === "lost") { if (verb === "MOVE") result = lost.move(world, entry.run, target); else if (verb === "DROP") result = lost.drop(world, entry.run, target); else if (verb === "RETURN") result = lost.escape(world, entry.run); else if (verb === "STRAND") result = lost.strand(world, entry.run); else result = { ok: false, code: "ACTION_UNAVAILABLE" }; }
      else if (entry.kind === "nullzone") { if (verb === "EXPAND") result = nullzone.expand(world, entry.run_id); else if (verb === "DISCOVER") result = nullzone.discoverArtifact(world, entry.run_id); else if (verb === "RETURN") result = nullzone.returnBase(world, entry.run_id); else result = { ok: false, code: "ACTION_UNAVAILABLE" }; }
      else result = verb === "REVIEW_REPORT" ? { ok: true, result: desk.projection(world) } : verb === "ADVANCE" ? desk.advance(world, entry.run_id) : { ok: false, code: "ACTION_UNAVAILABLE" };
      if (!result.ok) return publicError(result.error?.code ?? result.code ?? "ACTION_REJECTED", result.error?.public_reason ?? result.public_reason ?? "That action is not available right now."); if (entry.kind === "bootstrap") this.recordQ4Action(entry, `${verb}${target ? ` ${target}` : ""}`, result); this.persistSession(world, mode, entry); const scene = this.sceneFor(entry, mode, { action: verb, scene_type: verb === "LOOK" ? "observation" : "delta", accepted: true, public_reason: result.result?.public_reason ?? result.public_reason }, world); return { ok: true, result: { outcome: result.outcome ?? "succeeded", public_reason: result.result?.public_reason ?? result.public_reason ?? null, scene }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`action failed: ${error.message}`); return publicError("ACTION_RUNTIME_ERROR", "Yellow Beast could not complete that action safely."); }
  }
  naturalContext(world, mode, entry) {
    const projection = this.projectionFor(world, mode, entry); const actions = this.availableFor(world, mode, entry);
    const labels = [...new Set(actions.flatMap((action) => action.targets ?? []).map((target) => target.label).filter(Boolean))];
    const surface = projection.surface ?? {}; const location = surface.view?.location?.alias ?? surface.surroundings?.location?.alias ?? surface.base?.known_access_point ?? "the current setting";
    return { version: "yellow-beast-interpretation-context@v1", profile_title: projection.mode.label, scenario: projection.mode.description, lifecycle: "active", observer_location: location, visible_reference_labels: labels, known_resource_labels: surface.status?.carried ?? [], public_reason: null, grounding: { version: "yellow-beast-observer-grounding-context@v1", candidates: labels.map((label) => ({ ref: label, label, category: "entity", source: "visible", aliases: [label], attributes: [] })) } };
  }
  resolveQ4Attempt({ world_id, mode, entry, plan }) {
    const phase = entry.phase?.phase_id;
    const language = [plan.intent?.goals ?? [], plan.steps.map((step) => step.attempted_behavior), plan.intent?.methods ?? []].flat().join(" ").toLowerCase();
    const affordance = { BRIEFING: ["ready", "stage", "confirm"], STAGING: ["proceed", "depart", "prepare"], FACILITY_TRANSIT: ["approach", "continue", "reach"], THRESHOLD: ["cross", "enter"] }[phase];
    if (!affordance?.some((term) => language.includes(term))) return null;
    const action = { BRIEFING: "READY", STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "CROSS" }[phase];
    const result = this.submitAction({ world_id, mode, action });
    return { result: { accepted: result.ok, duplicate: false, canonical_event_ids: [], attempted_steps: plan.steps.map((step) => step.id), completed_steps: result.ok ? plan.steps.map((step) => step.id) : [], failed_steps: result.ok ? [] : plan.steps.map((step) => step.id), interrupted_steps: [], partial_steps: [], time_advanced: 0, observer_safe_summary: result.ok ? "The expedition advances to its next operational context." : "The expedition remains in its current operational context." } };
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
      const configured = this.settings().provider === "openai"; const key = configured ? this.credentials.get("openai") : null;
      if (configured && !key) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Language assistance needs an access key. Your world is safe; you can continue offline.");
      const provider = configured ? createOpenAIProvider({ apiKey: key, model: this.settings().openai_model || undefined, timeout: 15000 }) : createMockProvider();
      const nonBootstrap = entry.kind !== "bootstrap"; const adapterRun = nonBootstrap ? { session: { startup: { player: { observer_id: mode } } }, profile_id: mode } : entry.run; const available = this.availableFor(world, mode, entry);
      const phaseBefore = entry.phase?.phase_id; const turn = await executePlayerTurn({ run: adapterRun, mode, provider, player_text: text, request_id: `desktop-natural-${world_id}-${Date.now()}`, context: nonBootstrap ? this.naturalContext(world, mode, entry) : null, consequenceResolver: entry.kind === "bootstrap" ? ({ plan }) => this.resolveQ4Attempt({ world_id, mode, entry, plan }) : ({ plan }) => resolveModeAttempt({ service: this, world_id, mode, plan, available }), sceneBuilder: entry.kind === "bootstrap" ? () => this.sceneFor(entry, mode, {}, world) : ({ natural: resolved }) => this.modeScene(world, mode, entry, resolved) });
      if (entry.kind === "bootstrap" && turn.save_required && phaseBefore === entry.phase?.phase_id) this.recordQ4Action(entry, text, { ok: true, result: { time_advanced: turn.consequence?.result?.time_advanced ?? 0, canonical_event_ids: turn.consequence?.result?.canonical_event_ids ?? [] } });
      if (turn.save_required) this.persistSession(world, mode, entry);
      const scene = { ...turn.scene, narration: turn.narration.prose, narration_source: turn.narration.source };
      return { ok: true, result: { turn_status: turn.status, clarification_required: turn.status === "CLARIFICATION_REQUIRED", clarification_question: turn.clarification?.question ?? null, executed: turn.save_required, summary: scene.narration, scene }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`provider unavailable: ${error.message}`); return publicError("PROVIDER_UNAVAILABLE", "Language assistance is unavailable. Your world is safe. Continue using structured controls or try again."); }
  }
  shutdown() { for (const [key, entry] of this.sessions) { const [worldId, mode] = key.split(":"); try { this.persistSession(this.getWorld(worldId), mode, entry); } catch (error) { this.log(`shutdown save failed: ${error.message}`); } } return { ok: true }; }
}

module.exports = { DesktopService, MODES, DEFAULT_SETTINGS };
