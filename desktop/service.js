"use strict";

// Desktop-facing application facade.  This is deliberately the only layer that
// combines application storage with Yellow Beast's public runtime modules.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
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
const { createLivingProvider } = require("../tools/ai-living-provider");
const { ProviderPool } = require("../tools/ai-provider-pool");
const { executeLivingTurn } = require("../tools/ai-living-turn");
const { summarizeLanguageAssistance, failureReason } = require("./language-assistance");
const { PROVIDER_SPECS } = require("../tools/ai-hosted-transport");
const { buildLocalDialoguePacket, validateLocalDialogue } = require("../tools/ai-local-dialogue");
const referenceExpedition = require("../tools/reference-expedition");
const interpretiveDirector = require("../tools/interpretive-director");
const canonLexicon = require("../tools/canon-lexicon");
const canonLinter = require("../tools/canon-linter");
const canonicalLedger = require("../tools/canonical-world-ledger");
const { buildSafeScene, fallbackNarration } = require("../tools/scene-presentation");
const phases = require("../tools/mode-phases");
const q4 = require("../tools/q4-experience");
const q4Interactions = require("../tools/q4-interactions");
const personnelContinuity = require("../tools/q4-personnel-continuity");
const localIntent = require("../tools/q4-local-intent");
const standardOperator = require("../tools/q4-standard-operator");
const q4Personnel = require("../tools/q4-personnel");
const q4Equipment = require("../tools/q4-equipment");
const q4Trajectories = require("../tools/q4-trajectories");
const q4Continuity = require("../tools/q4-continuity");
const q4Career = require("../tools/q4-career-loop");
const assignmentEngine = require("../tools/q4-assignment-engine");
const q4Radio = require("../tools/q4-radio");
const q4Time = require("../tools/q4-time");
const communicationRuntime = require("../tools/communication-runtime");
const teamRuntime = require("../tools/team-runtime");
const hazardRuntime = require("../tools/hazard-runtime");
const spatialRuntime = require("../tools/spatial-runtime");
const objectRuntime = require("../tools/object-runtime");
const logisticsRuntime = require("../tools/logistics-runtime");
const institutionalRuntime = require("../tools/institutional-runtime");
const missionRuntime = require("../tools/mission-runtime");
const surveyFrontier = require("../tools/survey-frontier");
const evidenceAuthority = require("../tools/q4-evidence-authority");
const evidenceMedia = require("../tools/q4-evidence-media");
const environment = require("../tools/q4-environment");
const phenomenonEcology = require("../tools/q4-phenomenon-ecology");
const outcomes = require("../tools/q4-outcome-authority");
const consequenceRuntime = require("../tools/consequence-runtime");
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
const doctrineRuntime = require("../tools/doctrine-runtime");
const { createRegistry: createAuthorityRegistry } = require("../tools/authority-registry");
const SAVE_SCHEMA_VERSION = "yellow-beast-session@7";
const PERSISTENCE_PAIR_VERSION = "yellow-beast-persistence-pair@v1";

const clone = (value) => structuredClone(value);
const currentClearQ4 = (payload) => payload?.version === "yellow-beast-save@v9" && (payload.lifecycle ?? "active") === "active" && payload.spatial_pack_id === "clear-q4";
const hasCurrentEnvironment = (payload) => payload?.spatial?.environment?.version === environment.VERSION;
const hasCurrentStandardOperator = (world) => world?.q4_standard_operator?.version === standardOperator.VERSION;
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
function pairMaterial(world, session) { const worldValue = history.canonicalJson(world); const sessionValue = history.canonicalJson(session, { code:"SESSION_VALUE_INVALID" }); delete worldValue.persistence_pair; delete worldValue.persistence_pairs; delete sessionValue.persistence_pair; return { world:worldValue, session:sessionValue }; }
function pairIdentity(world, session) { const material = pairMaterial(world, session); return crypto.createHash("sha256").update(JSON.stringify(material.session)).digest("hex"); }
function stampPersistencePair(world, session, mode) { const priorPairs = world?.persistence_pairs && typeof world.persistence_pairs === "object" && !Array.isArray(world.persistence_pairs) ? history.canonicalJson(world.persistence_pairs) : {}; const material = pairMaterial(world, session); const marker = { version:PERSISTENCE_PAIR_VERSION, id:pairIdentity(material.world, material.session) }; material.world.persistence_pairs = { ...priorPairs, [mode]:marker }; material.session.persistence_pair = clone(marker); return material; }
function persistencePairMatches(world, session, { mode = session?.mode, allowUnmarked = false } = {}) { if ((session?.version ?? 1) < 7) return allowUnmarked; const worldMarker = world?.persistence_pairs?.[mode] ?? world?.persistence_pair; const sessionMarker = session?.persistence_pair; if (worldMarker == null && sessionMarker == null) return allowUnmarked; if (!worldMarker || !sessionMarker || worldMarker.version !== PERSISTENCE_PAIR_VERSION || sessionMarker.version !== PERSISTENCE_PAIR_VERSION || typeof worldMarker.id !== "string" || worldMarker.id !== sessionMarker.id) return false; return pairIdentity(world, session) === worldMarker.id; }
function sessionRuntimeCandidate(entry) {
  const dataObject = (value, pathLabel, omit = new Set()) => { const result = {}; for (const key of Object.getOwnPropertyNames(value ?? {})) { if (omit.has(key)) continue; const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || descriptor.writable !== true || descriptor.configurable !== true) throw Object.assign(new Error(`invalid session runtime property at ${pathLabel}.${key}`), { code:"SESSION_VALUE_INVALID" }); result[key] = descriptor.value; } if (Object.getOwnPropertySymbols(value ?? {}).length) throw Object.assign(new Error(`invalid session runtime symbols at ${pathLabel}`), { code:"SESSION_VALUE_INVALID" }); return result; };
  const rawEntry = dataObject(entry, "$");
  if (entry?.kind === "bootstrap") {
    const rawRun = dataObject(entry.run, "$.run"); const descriptor = Object.getOwnPropertyDescriptor(entry.run?.expedition ?? {}, "objectives");
    if (descriptor && !("value" in descriptor) && (typeof descriptor.get !== "function" || descriptor.set != null || descriptor.enumerable !== false || descriptor.configurable !== true)) throw Object.assign(new Error("invalid session objectives compatibility property"), { code:"SESSION_VALUE_INVALID" });
    const rawExpedition = dataObject(entry.run.expedition, "$.run.expedition", new Set(["objectives"])); rawRun.expedition = rawExpedition; rawEntry.run = rawRun;
  }
  const safe = history.canonicalJson(rawEntry, { code:"SESSION_VALUE_INVALID" });
  if (entry?.kind === "bootstrap") {
    const saved = history.canonicalJson(bootstrap.saveRun(entry.run), { code:"SESSION_VALUE_INVALID" }); const priorWorld = safe.run._world ?? null; const restored = bootstrap.resumeRun(saved, { world:priorWorld, spatial_worldpack:saved.spatial_pack_id });
    if (!restored.ok) throw Object.assign(new Error("session runtime could not be reconstructed from its current save"), { code:restored.error?.code ?? "SESSION_SAVE_INVALID" }); safe.run = restored.run;
  }
  return safe;
}
function redactDiagnostic(value) { if (Array.isArray(value)) return value.map(redactDiagnostic); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /key|token|password|secret|credential/i.test(key) ? "[redacted]" : redactDiagnostic(item)])); return typeof value === "string" ? value.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]+\b/g, "[redacted]") : value; }

class DesktopService {
  constructor({ appDataPath = null, paths = null, logger = null, credentials = null, evidenceMediaProviders = {}, livingTurnProvider = null, localDialogueProvider = null, defaultQ4Scenario = "procedural-survey", developerMode = process.env.YELLOW_BEAST_DEVELOPER_MODE === "1" } = {}) {
    this.paths = paths ?? (appDataPath ? { root: appDataPath, worlds: path.join(appDataPath, "worlds"), saves: path.join(appDataPath, "saves"), logs: path.join(appDataPath, "logs"), media: path.join(appDataPath, "media"), config: path.join(appDataPath, "config.json") } : resolveAppPaths());
    this.paths.media ??= path.join(this.paths.root, "media");
    this.metadataFile = path.join(this.paths.root, "desktop-worlds.json");
    this.settingsFile = path.join(this.paths.root, "desktop-settings.json");
    this.logger = logger ?? (() => {});
    this.credentials = credentials ?? new CredentialStore();
    this.developerMode = developerMode === true;
    this.sessions = new Map();
    this.naturalTurnInflight = new Map();
    this.naturalCommandContext = new AsyncLocalStorage();
    this.recovery = new Map();
    this.recoveredWorlds = new Map();
    [this.paths.root, this.paths.worlds, this.paths.saves, this.paths.logs, this.paths.media].forEach(ensureDirectory);
    this.evidenceMedia = new evidenceMedia.EvidenceMediaRenderer({ media_root:this.paths.media, providers:evidenceMediaProviders });
    this.evidenceRenderInflight = new Map();
    this.interpretationProvenance = [];
    this.authorityRegistry = createAuthorityRegistry();
    this.livingTurnProvider = livingTurnProvider;
    this.localDialogueProvider = localDialogueProvider;
    this.defaultQ4Scenario = defaultQ4Scenario === "reference-expedition" ? "reference-expedition" : "procedural-survey";
    this.providerPool = new ProviderPool({
      credentials: this.credentials,
      settingsGetter: () => this.settings(),
      onInvocation: (event) => this.recordProviderInvocation(event),
      onProvenance: (summary) => this.recordAttemptChain(summary)
    });
  }

  recordAttemptChain(summary) {
    if (!summary || typeof summary !== "object") return;
    this.traceNaturalTurn("provider-attempt-chain", summary);
    this.recordInterpretationProvenance({
      request_id: summary.request_id,
      route: summary.route,
      event: "attempt-chain-completed",
      input: "player-supplied",
      mode: summary.mode,
      selected_provider: summary.selected_provider,
      attempts: summary.attempts,
      duration_ms: summary.duration_ms,
      canonical_resolution: "ai-provider-pool -> Custodian",
      observer_projection: "live-scene-projection@v1"
    });
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
  getWorld(worldId) { const recovered = this.recoveredWorlds.get(worldId); if (recovered) return clone(recovered); const file = this.worldFile(worldId); if (!fs.existsSync(file)) throw Object.assign(new Error("world not found"), { code: "WORLD_NOT_FOUND" }); try { return this.loadWorldFile(file); } catch (error) { if (error.code === "WORLD_VERSION_UNSUPPORTED") throw error; const backup = this.backupFile(worldId); try { const restored = this.loadWorldFile(backup); this.noteRecovery(worldId, "world", "previous-good-world"); return restored; } catch { throw error; } } }
  saveCanonical(world) {
    if (this.recoveredWorlds.has(world.world_id)) throw Object.assign(new Error("automatic recovery is read-only until explicitly adopted"), { code:"PERSISTENCE_RECOVERY_READ_ONLY" });
    const file = this.worldFile(world.world_id); const backup = this.backupFile(world.world_id);
    const temporary = `${file}.${process.pid}.tmp`; const previousCandidate = `${backup}.${process.pid}.tmp`;
    let primaryCommitted = false; let hasPreviousCandidate = false;
    try {
      history.saveWorld(temporary, world); history.loadWorld(temporary);
      if (fs.existsSync(file)) {
        let currentValid = false; try { this.loadWorldFile(file); currentValid = true; } catch {}
        if (currentValid) { fs.copyFileSync(file, previousCandidate); this.loadWorldFile(previousCandidate); hasPreviousCandidate = true; }
      }
      fs.renameSync(temporary, file); primaryCommitted = true;
      if (hasPreviousCandidate) {
        try { fs.renameSync(previousCandidate, backup); hasPreviousCandidate = false; }
        catch (error) { fs.renameSync(previousCandidate, file); hasPreviousCandidate = false; primaryCommitted = false; throw error; }
      }
      return { ok: true };
    } catch (error) {
      for (const artifact of [temporary, previousCandidate]) { try { if (fs.existsSync(artifact)) fs.unlinkSync(artifact); } catch {} }
      if (primaryCommitted) throw Object.assign(new Error("canonical save could not be rolled back"), { code:"WORLD_SAVE_ROLLBACK_FAILED", cause:error });
      throw error;
    }
  }
  worldInfo(world, metadata = {}) { return { id: world.world_id, name: metadata.name ?? world.world_id, version: world.version, created_at: metadata.created_at ?? null, last_played_at: metadata.last_played_at ?? null, last_mode: metadata.last_mode ?? null, status: outcomes.isRetired(world) ? "retired" : "ready" }; }

  getAppInfo() { const data = this.metadata(); const build = buildInfo.read(); return { ok: true, app: { name: "Yellow Beast", version: packageVersion, alpha: true, build, first_run_complete: Boolean(data.first_run_complete), data_path: this.paths.root, developer_mode:this.developerMode } }; }
  getInterpretationProvenance({ limit = 20 } = {}) { if (!this.developerMode) return publicError("DEVELOPER_DISABLED", "Developer tooling is disabled."); return { ok: true, records: clone(this.interpretationProvenance.slice(-Math.max(1, Math.min(100, Number(limit) || 20)))) }; }
  recordInterpretationProvenance(record) { const offline = record.provider === "deterministic-mock" || record.provider === "deterministic-living-provider"; this.interpretationProvenance.push({ ...record, execution_mode: offline ? "offline" : (record.provider ?? "unknown"), provider_invoked: record.provider_invoked === true, response_classification: record.response_classification ?? (offline ? "deterministic" : "not-yet-observed"), authority_registry: this.authorityRegistry?.version ?? null, authority_context_order: ["simulation-doctrine", "worldpack-and-domain-authority", "canonical-current-state", "observer-safe-projection", "persisted-history", "player-submission", "response-contract"], authority_sources: this.authorityRegistry?.sourceMetadata?.() ?? [], recorded_at: new Date().toISOString() }); if (this.interpretationProvenance.length > 100) this.interpretationProvenance.shift(); }
  recordProviderInvocation({ request_id, route, ...event }) {
    this.recordInterpretationProvenance({ request_id, route, event:"provider-invocation", ...event, provider_invoked:true, invocation_status:event.status, response_classification:event.status === "completed" ? "model-response-parsed" : event.status === "failed" ? "provider-failure" : "provider-request-started" });
    this.traceNaturalTurn("provider-invocation", { request_id, route, ...event });
  }
  traceNaturalTurn(stage, detail = {}) {
    if (process.env.YELLOW_BEAST_TURN_TRACE !== "1") return;
    // Callers supply bounded metadata only: never credentials, raw prompts, or saves.
    try { this.log(JSON.stringify({ diagnostic:"natural-turn", stage, ...detail })); } catch {}
  }
  getDeveloperSnapshot({ world_id, mode = null } = {}) { if (!this.developerMode) return publicError("DEVELOPER_DISABLED", "Developer tooling is disabled."); try { const world = this.getWorld(world_id); const entry = mode ? (this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null))) : null; const provider = this.getProviderStatus().provider; const run = entry?.kind === "bootstrap" ? entry.run : null; const simulationTruth = run ? { developer_only: true, authoritative_clock: structuredClone(run.expedition.clock), event_queue: structuredClone(run.expedition.operational?.events ?? []), mission_state: structuredClone(run.expedition.mission_state), teammate_locations: structuredClone(run.spatial?.personnel_locations ?? {}), teammate_decisions: structuredClone(run.expedition.team_runtime?.decision_history ?? run.expedition.operational?.decision_history ?? []), hazard_state: structuredClone(run.expedition.hazards ?? {}), phenomenon_state:phenomenonEcology.diagnostics(world,{developer:true}), item_custody: structuredClone(run.expedition.logistics?.items ?? {}), container_contents: structuredClone(run.expedition.logistics?.containers ?? {}), institutional_knowledge: structuredClone(world.institutional_response?.confirmed_knowledge ?? []), standard_response_queue: structuredClone(world.institutional_response?.pending_decisions ?? []), observer_safe_projection: q4.presentation(run, entry.phase, null, world) } : null; return { ok:true, snapshot:developerInspection.snapshot(world), active:{ mode, phase:entry?.phase ?? null, session_kind:entry?.kind ?? null, simulation_truth:simulationTruth }, provider:{ selected:provider.selected, offline:provider.offline, configured:provider.openai.configured, status:provider.offline ? "offline" : provider.openai.status }, doctrine: doctrineRuntime.read(), interpretation_provenance: clone(this.interpretationProvenance), provider_safe_context:run ? developerInspection.providerSafeContext(run) : null, recent_history:developerInspection.recentHistory(world) }; } catch { return publicError("DEVELOPER_SNAPSHOT_UNAVAILABLE", "The selected world could not be inspected."); } }
  async traceDeveloperIntent({ world_id, mode, text }) { if (!this.developerMode) return publicError("DEVELOPER_DISABLED", "Developer tooling is disabled."); try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry || entry.kind !== "bootstrap") return publicError("TRACE_UNAVAILABLE", "A Clear-Q4 session is required for this non-executing trace."); return { ok:true, trace:await developerInspection.intentTrace({ run:entry.run, provider:createMockProvider(), player_text:text }) }; } catch { return publicError("TRACE_UNAVAILABLE", "The selected session could not be traced."); } }
  controlQ4PhenomenonFixture({ world_id, action="instantiate", family=null, location_id=null, profile_id=null, phenomenon_id=null, text=null, target_id=null, alias=null }={}) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation."); if(!this.developerMode)return publicError("DEVELOPER_DISABLED","Developer tooling is disabled.");try{const world=this.getWorld(world_id);const entry=this.session(world_id,"field-researcher")??this.restoreSession(world,"field-researcher",readJson(this.sessionFile(world_id,"field-researcher"),null));if(!entry||entry.kind!=="bootstrap"||!entry.run.spatial)return publicError("FIXTURE_SESSION_REQUIRED","Start Clear-Q4 before using a controlled phenomenon fixture.");const run=entry.run;const player=run.session.startup.player.observer_id;const location=location_id??run.spatial.player_location;let result;
    if(action==="instantiate")result=phenomenonEcology.instantiateFixture(world,{family,location_id:location,profile_id,fixture_id:`desktop-${family}-${profile_id??"canonical"}-${location}`,spatial:run.spatial},{control:phenomenonEcology.FIXTURE_TOKEN});
    else if(action==="observe")result=phenomenonEcology.observe(world,{run,observer:player,location_id:location,co_observers:Object.entries(run.spatial.personnel_locations).filter(([id,value])=>id!==player&&value===location).map(([id])=>id),has_field_light:q4Equipment.stateUsable(run.expedition.equipment?.["field-light"])});
    else if(action==="stimulus")result=phenomenonEcology.stillLifeStimulus(world,run,phenomenon_id,{kind:text??"approach",actor_location:run.spatial.player_location});
    else if(action==="speech")result={ok:true,acquired:phenomenonEcology.recordSpeech(world,run,{speaker:player,text:text??"Can anyone hear me?",location_id:run.spatial.player_location})};
    else if(action==="mimic")result=phenomenonEcology.bacteriaMimic(world,run,phenomenon_id,{observers:Object.keys(run.spatial.personnel_locations)});
    else if(action==="acquire")result=phenomenonEcology.acquireBacteria(world,run,phenomenon_id,{target_id:target_id??player,signal:text==="acoustic"?"acoustic":"visual"});
    else if(action==="pursue")result=phenomenonEcology.bacteriaPursue(world,run,phenomenon_id);
    else if(action==="capture")result=phenomenonEcology.bacteriaCapture(world,run,phenomenon_id,{target_id:target_id??player});
    else if(action==="slam")result=phenomenonEcology.bacteriaSlam(world,run,phenomenon_id,{surface_id:text,witnesses:Object.keys(run.spatial.personnel_locations)});
    else if(action==="fatal") { const person=target_id??player; const member=run.expedition.team.members.find((item)=>(item.personnel_id??item.id)===person); if(!member) return publicError("FIXTURE_TARGET_INVALID","The controlled fatal fixture requires an assigned personnel record."); member.condition="dead"; member.status="dead"; result=outcomes.resolve(world,run,{cause:{id:"developer-controlled-fatal-causal-fixture"}}); if(result.player_deceased) this.persistTerminalRetirement(world,"field-researcher",entry); }
    else if(action==="alias")result=phenomenonEcology.coinAlias(world,phenomenon_id,{alias,originator:player,informed_observers:[],at:run.expedition.clock.interval,provenance:"developer-controlled-encounter-speech"});
    else return publicError("FIXTURE_ACTION_INVALID","That controlled fixture action is unavailable.");
    if(!outcomes.isRetired(world)) this.persistSession(world,"field-researcher",entry);return{ok:result?.ok!==false,result,diagnostics:phenomenonEcology.diagnostics(world,{developer:true}),projection:this.projectionFor(world,"field-researcher",entry)};
  }catch(error){this.log(`controlled phenomenon fixture failed: ${error.message}`);return publicError("FIXTURE_RUNTIME_ERROR","The controlled fixture could not be resolved safely.");} }
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
  createQ4Personnel({ world_id, first_name, last_name, display_name = null }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation."); try { const world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); const created = q4Personnel.createPlayer(world, { first_name, last_name, display_name }); if (!created.ok) return publicError(created.code, "Enter a valid first and last name for the personnel record."); this.saveCanonical(world); return { ok: true, created: created.created, player: created.player }; } catch { return publicError("PERSONNEL_CREATION_FAILED", "The ASYNC personnel record could not be created safely."); } }
  confirmQ4Personnel({ world_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation."); try { const world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); const identity = world.q4_operations?.controlled_player; const person = identity ? history.character(world, identity) : null; if (!person) return publicError("PERSONNEL_CREATION_REQUIRED", "Create your ASYNC personnel record before confirming it."); world.q4_operations.personnel_confirmation = { completed: true, personnel_id: identity, confirmed_at: world.q4_operations.personnel_confirmation?.confirmed_at ?? new Date().toISOString() }; this.saveCanonical(world); return { ok: true, player: q4Personnel.safePerson(person) }; } catch { return publicError("PERSONNEL_CONFIRMATION_FAILED", "The personnel record could not be confirmed safely."); } }
  saveWorld({ world_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation."); try { const world = this.getWorld(world_id); this.saveCanonical(world); return { ok: true }; } catch (error) { return publicError(error.code ?? "WORLD_SAVE_FAILED", "This world could not be saved."); } }
  deleteWorld({ world_id, confirmed = false }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (confirmed !== true) return publicError("DELETE_CONFIRMATION_REQUIRED", "Confirm deletion before removing this world.");
    try { const file = this.worldFile(world_id); if (!fs.existsSync(file)) return publicError("WORLD_NOT_FOUND", "This world no longer exists."); fs.unlinkSync(file);
      for (const mode of MODES) { const session = this.sessionFile(world_id, mode.id); if (fs.existsSync(session)) fs.unlinkSync(session); this.sessions.delete(`${world_id}:${mode.id}`); }
      const data = this.metadata(); delete data.worlds[world_id]; if (data.last_world_id === world_id) data.last_world_id = null; this.writeMetadata(data); return { ok: true };
    } catch (error) { this.log(`world delete failed: ${error.message}`); return publicError("WORLD_DELETE_FAILED", "This world could not be deleted."); }
  }
  exportWorld({ world_id, destination }) { try { const source = this.worldFile(world_id); if (!destination || !path.isAbsolute(destination)) return publicError("EXPORT_DESTINATION_INVALID", "Choose an export destination."); history.loadWorld(source); fs.copyFileSync(source, destination); return { ok: true, file: destination }; } catch (error) { return publicError("WORLD_EXPORT_FAILED", "This world could not be exported."); } }
  importWorld({ source, name = null }) { try { if (!source || !path.isAbsolute(source)) return publicError("IMPORT_SOURCE_INVALID", "Choose a world export to import."); const world = history.loadWorld(source); const data = this.metadata(); if (fs.existsSync(this.worldFile(world.world_id)) || data.worlds[world.world_id]) return publicError("WORLD_CONFLICT", "A world with this identity is already present."); this.saveCanonical(world); const now = new Date().toISOString(); data.worlds[world.world_id] = { name: friendlyName(name) ? name.trim() : world.world_id, created_at: now, last_played_at: now, last_mode: null }; this.writeMetadata(data); return { ok: true, world: this.worldInfo(world, data.worlds[world.world_id]) }; } catch { return publicError("WORLD_IMPORT_FAILED", "That export is not a compatible Yellow Beast world."); } }
  getSettings() { return { ok: true, settings: this.settings(), provider: this.getProviderStatus().provider }; }
  updateSettings({ settings }) { if (!settings || typeof settings !== "object") return publicError("SETTINGS_INVALID", "Settings were not understood."); const next = { ...this.settings() }; if (settings.input_mode && !["structured", "natural"].includes(settings.input_mode)) return publicError("SETTINGS_INVALID", "Choose a supported input mode."); if (settings.provider && !["auto", "offline", "openai", "groq", "gemini", "openrouter"].includes(settings.provider)) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Choose offline play or configured language assistance."); if (settings.provider && !["auto", "offline"].includes(settings.provider) && settings.provider !== next.provider && !this.credentials.configured(settings.provider)) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Add an access key first, or continue offline."); if (settings.theme && !["system", "light", "dark", "high-contrast"].includes(settings.theme)) return publicError("SETTINGS_INVALID", "Choose a supported appearance."); if (settings.text_scale && !["small", "default", "large", "extra-large"].includes(settings.text_scale)) return publicError("SETTINGS_INVALID", "Choose a supported text size."); if (settings.reduced_motion !== undefined && typeof settings.reduced_motion !== "boolean") return publicError("SETTINGS_INVALID", "Reduced motion must be on or off."); if (settings.reduced_sensory !== undefined && typeof settings.reduced_sensory !== "boolean") return publicError("SETTINGS_INVALID", "Reduced sensory must be on or off."); if (settings.audio_muted !== undefined && typeof settings.audio_muted !== "boolean") return publicError("SETTINGS_INVALID", "Audio mute must be on or off."); for (const key of ["audio_master", "audio_interface", "audio_radio", "audio_ambient"]) if (settings[key] !== undefined && (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 1)) return publicError("SETTINGS_INVALID", `${key} must be between 0 and 1.`); if (settings.guided_introductions !== undefined && typeof settings.guided_introductions !== "boolean") return publicError("SETTINGS_INVALID", "Guided introductions must be on or off."); if (settings.visual_adapter && !["fallback", "comfyui", "hosted"].includes(settings.visual_adapter)) return publicError("SETTINGS_INVALID", "Choose a supported visual renderer."); if (settings.visual_quality && !["documentary", "detailed"].includes(settings.visual_quality)) return publicError("SETTINGS_INVALID", "Choose a supported visual quality."); if (settings.media_effect_intensity && !["restrained", "reduced"].includes(settings.media_effect_intensity)) return publicError("SETTINGS_INVALID", "Choose a supported media effect intensity."); for (const key of ["visual_rendering", "automatic_evidence_rendering", "retry_failed_renders"]) if (settings[key] !== undefined && typeof settings[key] !== "boolean") return publicError("SETTINGS_INVALID", `${key} must be on or off.`); for (const id of Object.keys(PROVIDER_SPECS)) { const key = `${id}_model`; if (Object.hasOwn(settings,key)) { if (typeof settings[key] !== "string" || !settings[key].trim() || settings[key].length > 120) return publicError("MODEL_INVALID", "Enter a model name up to 120 characters."); if (settings[key] !== next[key]) this.providerPool.resetHealth(id); } } Object.assign(next, settings); delete next.api_key; writeJson(this.settingsFile, next); return { ok: true, settings: next };
  }
  getProviderStatus() { const selected = this.settings().provider ?? "offline"; const configured = this.credentials.configured("openai"); const settings = this.settings(); const media = this.evidenceMedia.status(settings); const pool = this.providerPool; return { ok: true, provider: { selected, entries:this.providerEntries(), offline: selected === "offline", openai: { configured, status: selected === "openai" ? (configured ? "ready" : "configuration-required") : "inactive" }, groq: { configured: this.credentials.configured("groq"), status: selected === "groq" ? (this.credentials.configured("groq") ? "ready" : "configuration-required") : "inactive" }, gemini: { configured: this.credentials.configured("gemini"), status: selected === "gemini" ? (this.credentials.configured("gemini") ? "ready" : "configuration-required") : "inactive" }, openrouter: { configured: this.credentials.configured("openrouter"), status: selected === "openrouter" ? (this.credentials.configured("openrouter") ? "ready" : "configuration-required") : "inactive" }, auto: { active: selected === "auto", eligible: pool ? pool.getCandidates({ preferredProvider: "auto" }) : [], health: pool ? Object.fromEntries(["groq", "gemini", "openrouter", "openai"].map((id) => [id, pool.getHealth(id)])) : {} }, local_provider: { supported: true, adapter: settings.visual_adapter, endpoint: settings.comfyui_endpoint, status: media.local.selected ? (media.local.available ? "ready" : "unavailable") : "inactive" }, evidence_media: media } }; }
  async renderEvidence({ world_id, evidence_id, retry = false } = {}) { const key = `${world_id}:${evidence_id}:${retry ? "retry" : "render"}`; if (this.evidenceRenderInflight.has(key)) return this.evidenceRenderInflight.get(key); const task = this.renderEvidenceNow({ world_id, evidence_id, retry }).finally(() => this.evidenceRenderInflight.delete(key)); this.evidenceRenderInflight.set(key, task); return task; }
  async renderEvidenceNow({ world_id, evidence_id, retry = false } = {}) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation."); try { const world = this.getWorld(world_id); const record = evidenceAuthority.archive(world, { observer:"player" }).records.find((item) => item.id === evidence_id); if (!record) return publicError("EVIDENCE_UNAVAILABLE", "That evidence record is not available to this observer."); const before = clone(record); const result = await this.evidenceMedia.render({ world_id:world.world_id, record, settings:this.settings(), retry, onPresentation:(presentation) => evidenceAuthority.setPresentation(world, evidence_id, presentation) }); this.saveCanonical(world); const after = evidenceAuthority.archive(world, { observer:"player" }).records.find((item) => item.id === evidence_id); const canonicalUnchanged = JSON.stringify({ ...before, render_status:undefined, render_presentation:undefined }) === JSON.stringify({ ...after, render_status:undefined, render_presentation:undefined }); if (!canonicalUnchanged) throw new Error("evidence truth changed during media rendering"); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null)); return { ok:true, result:{ success:result.ok, code:result.code ?? null, presentation:result.presentation ?? null, fallback:result.fallback ?? null }, projection:entry ? this.projectionFor(world, "field-researcher", entry) : null }; } catch (error) { this.log(`evidence rendering failed: ${error.message}`); return publicError("EVIDENCE_RENDER_FAILED", "The evidence record remains available; visual rendering could not be completed."); } }
  providerEntries() {
    return ["groq", "gemini", "openrouter", "openai"].map(id => {
      const info = this.credentials.describe?.(id) ?? { configured:this.credentials.configured(id) };
      const health = this.providerPool.getHealth(id);
      return { id, label:PROVIDER_SPECS[id].displayName, model:this.providerPool.getModel(id), default_model:PROVIDER_SPECS[id].defaultModel,
        ...info, status:!info.configured ? "No usable key" : health.last_failure_class ? failureReason([{ attempts:[{ failure_class:health.last_failure_class }] }]) : health.last_success ? "Response received this session" : "Stored; connection not tested",
        last_success:health.last_success, last_failure:health.last_failure_class, cooldown_until:health.cooldown_until };
    });
  }
  configureProvider({ provider = "openai", api_key, model = null, activate = true } = {}) {
    if (!Object.hasOwn(PROVIDER_SPECS, provider)) return publicError("PROVIDER_INVALID", "Choose a supported provider.");
    if (model !== null && (typeof model !== "string" || model.trim().length > 120)) return publicError("MODEL_INVALID", "Enter a model name up to 120 characters.");
    const stored = this.credentials.set(provider, api_key);
    if (!stored.ok) return publicError(stored.code, `Enter a valid ${provider} key.`);
    const next = { ...this.settings(), ...(activate ? { provider, input_mode:"natural" } : {}) };
    if (model?.trim()) next[`${provider}_model`] = model.trim();
    this.providerPool.resetHealth(provider);
    writeJson(this.settingsFile, next);
    return { ok:true, provider:{ configured:true, persistent:stored.persistent }, settings:next };
  }
  configureOpenAI(input = {}) { return this.configureProvider({ ...input, provider:"openai" }); }
  removeProviderKey({ provider = "openai" } = {}) {
    if (!Object.hasOwn(PROVIDER_SPECS, provider)) return publicError("PROVIDER_INVALID", "Choose a supported provider.");
    const removed = this.credentials.remove(provider);
    if (removed?.ok === false) return publicError(removed.code, "The saved key could not be deleted. It remains available; retry after checking device storage access.");
    this.providerPool.resetHealth(provider);
    const next = { ...this.settings() };
    // Keep the selected mode explicit. Deleting a key must not authorize a
    // different hosted provider or silently switch gameplay offline.
    delete next[`${provider}_model`]; writeJson(this.settingsFile, next);
    return { ok:true, configured:this.credentials.configured(provider) };
  }
  removeOpenAIKey() { return this.removeProviderKey({ provider:"openai" }); }
  testProvider({ provider = null, live = false } = {}) {
    const target = provider || this.settings().provider;
    if (target === "offline") return { ok:true, status:"ready", message:"Offline deterministic play is selected. No hosted AI request was made." };
    if (target !== "auto" && !Object.hasOwn(PROVIDER_SPECS,target)) return publicError("PROVIDER_INVALID", "Choose a supported provider.");
    if (live) return this.testHostedProvider(target);
    return { ok:true, status:"not-tested", message:"Connection has not been tested. Use Test connection to send a small request." };
  }
  async testHostedProvider(provider) {
    this.providerTests ??= new Map();
    if (this.providerTests.has(provider)) return this.providerTests.get(provider);
    const task = (async () => {
      const executions = [];
      // A user-requested connection test explicitly retries the selected key.
      if (provider !== "auto") this.providerPool.resetHealth(provider);
      try {
        const result = await this.providerPool.executeWithFallback({ requestKind:"connection-test", requestId:`provider-test-${crypto.randomUUID()}`, route:"settings/test-provider", preferredProvider:provider, allowOffline:false, onComplete:summary => executions.push(summary), executeFn:async candidate => {
          const result = await candidate.interpretLiving({ player_text:"Wait here.", context:{ version:"yellow-beast-provider-check@v1", authority_contract:{ interpretation:"candidate-only", canonical_mutation:"forbidden" }, observer:{label:"You",location:"test room"}, local_coworkers:[], visible_targets:[], available_equipment:[], sinks:{ single_attempt:[{type:"WAIT",target_required:false,target_labels:[]}], coordinated_attempt:{player_actions:[],coworker_actions:[]} } } });
          if (result?.status !== "proposal" || result?.noncanonical !== true || result?.attempts?.length !== 1 || result.attempts[0].actor?.kind !== "player" || result.attempts[0].action !== "WAIT") throw Object.assign(new Error("Invalid connection-test proposal"),{ code:"MALFORMED_RESPONSE" });
          return result;
        } });
        return { ok:true, status:"response-received", selected_provider:result.selected_provider, message:`${PROVIDER_SPECS[result.selected_provider].displayName} returned a valid structured response. Expedition gameplay is tested separately.` };
      } catch { return { ok:false, error:{ code:"PROVIDER_UNAVAILABLE", message:failureReason(executions), provider_failure:true } }; }
    })();
    this.providerTests.set(provider,task);
    try { return await task; } finally { this.providerTests.delete(provider); }
  }
  renameWorld({ world_id, name }) { if (!friendlyName(name)) return publicError("WORLD_NAME_INVALID", "Choose a world name between 1 and 80 characters."); const data = this.metadata(); if (!data.worlds[world_id]) return publicError("WORLD_NOT_FOUND", "This world no longer exists."); data.worlds[world_id].name = name.trim(); this.writeMetadata(data); return { ok: true, world: this.loadWorld({ world_id }).world }; }
  replaceRecoveryPrimaries(replacements) {
    const tag = `${process.pid}.${crypto.randomUUID()}`; const staged = []; const rollback = [];
    try {
      for (const { source, target } of replacements) { const next = `${target}.${tag}.restore-stage.tmp`; const prior = `${target}.${tag}.restore-rollback.tmp`; fs.copyFileSync(source, next); if (fs.existsSync(target)) fs.copyFileSync(target, prior); staged.push({ next, target }); rollback.push({ prior, target, existed:fs.existsSync(target) }); }
      let committed = 0;
      try { for (const item of staged) { fs.renameSync(item.next, item.target); committed += 1; } }
      catch (error) { for (let index = 0; index < committed; index += 1) { const item = rollback[index]; if (item.existed) fs.copyFileSync(item.prior, item.target); else if (fs.existsSync(item.target)) fs.unlinkSync(item.target); } throw error; }
    } finally { for (const file of [...staged.map((item) => item.next), ...rollback.map((item) => item.prior)]) { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {} } }
  }
  restoreBackup({ world_id, confirmed = false }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (confirmed !== true) return publicError("RESTORE_CONFIRMATION_REQUIRED", "Confirm that restoring the previous save may lose recent changes.");
    try {
      const worldBackup = this.backupFile(world_id); if (!fs.existsSync(worldBackup)) return publicError("BACKUP_UNAVAILABLE", "No previous save is available for this world."); const world = this.loadWorldFile(worldBackup);
      const metadataMode = this.metadata().worlds?.[world_id]?.last_mode ?? null; const modes = [...new Set([metadataMode, ...MODES.map((item) => item.id)].filter(Boolean))]; let sessionChoice = null; let hasSessionArtifact = false;
      sessionSearch: for (const mode of modes) for (const source of [this.sessionFile(world_id, mode), this.sessionBackupFile(world_id, mode)]) {
        if (!fs.existsSync(source)) continue; hasSessionArtifact = true; const candidate = readJsonCandidate(source); if (!candidate.ok || this.validateSessionSave(candidate.value, mode) || !persistencePairMatches(world, candidate.value, { mode, allowUnmarked:false }) || !this.restoreSession(world, mode, candidate.value)) continue; sessionChoice = { mode, source, value:candidate.value }; break sessionSearch;
      }
      if (hasSessionArtifact && !sessionChoice) return publicError("BACKUP_PAIR_INCOMPATIBLE", "The previous world and available operation records do not form one verified persistence pair. Nothing was restored.");
      const replacements = [{ source:worldBackup, target:this.worldFile(world_id) }]; if (sessionChoice && sessionChoice.source !== this.sessionFile(world_id, sessionChoice.mode)) replacements.push({ source:sessionChoice.source, target:this.sessionFile(world_id, sessionChoice.mode) }); this.replaceRecoveryPrimaries(replacements);
      this.recoveredWorlds.delete(world_id); for (const key of [...this.sessions.keys()]) if (key.startsWith(`${world_id}:`)) this.sessions.delete(key); for (const key of [...this.recovery.keys()]) if (key.startsWith(`${world_id}:`)) this.recovery.delete(key);
      return { ok:true, world:this.loadWorld({ world_id }).world };
    } catch { return publicError("BACKUP_RESTORE_FAILED", "The previous save could not be restored safely."); }
  }
  exportBrokenWorld({ world_id, destination }) { try { const source = this.worldFile(world_id); if (!destination || !path.isAbsolute(destination) || !fs.existsSync(source)) return publicError("EXPORT_DESTINATION_INVALID", "Choose a destination for this world file."); fs.copyFileSync(source, destination); return { ok: true, file: destination }; } catch { return publicError("EXPORT_FAILED", "The world file could not be copied."); } }
  getDiagnostics() { const status = this.getProviderStatus().provider; const hosted = this.interpretationProvenance.filter((record) => (record.provider_invoked || record.invocation_status) && record.provider !== "offline" && record.provider !== "deterministic-mock").at(-1); const activeProvider = status.selected; const isOffline = status.offline || activeProvider === "offline"; const providerStatus = isOffline ? "offline" : (status[activeProvider]?.status ?? (activeProvider === "auto" ? "ready" : "inactive")); const anyConfigured = Boolean(status.openai?.configured || status.groq?.configured || status.gemini?.configured || status.openrouter?.configured); return { ok: true, diagnostics: { app_version: packageVersion, platform: process.platform, provider: activeProvider, provider_status: providerStatus, hosted_ai:hosted ? { provider:hosted.provider, request_id:hosted.request_id, request_kind:hosted.request_kind, invocation_status:hosted.invocation_status, hosted_request:hosted.hosted_request === true, response_received:hosted.response_received === true, response_parsed:hosted.response_parsed === true, model:hosted.model, duration_ms:hosted.duration_ms, error_type:hosted.error_type ?? null, error_status:hosted.error_status ?? null, error_code:hosted.error_code ?? null, error_param:hosted.error_param ?? null } : { invocation_status:"not-observed", hosted_request:false, response_received:false, response_parsed:false }, evidence_media:{ pipeline_version:evidenceMedia.PIPELINE_VERSION, provider_mode:status.evidence_media.selected, provider_available:status.evidence_media.available, fallback:status.evidence_media.fallback }, environment:{ version:environment.VERSION, config_version:environment.CONFIG_VERSION, authority:"canonical-spatial-snapshot" }, save_directory: "managed application data", credentials_configured: anyConfigured, save_schema_version: SAVE_SCHEMA_VERSION, telemetry: "disabled", offline_gameplay: true } }; }
  sanitizedLogTail() { const file = path.join(this.paths.logs, "desktop.log"); try { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-40).map((line) => redactDiagnostic(line)); } catch { return []; } }
  exportTesterReport({ world_id, mode = "field-researcher", note = null } = {}) { try { const world = this.getWorld(world_id); const loaded = this.loadSession(world, mode); const entry = this.session(world_id, mode) ?? loaded.entry ?? null; const projection = entry ? this.projectionFor(world, mode, entry) : null; const provider = this.getProviderStatus().provider; const active = provider.selected; const render_diagnostics = evidenceAuthority.archive(world, { observer:"player" }).records.map((record) => ({ evidence_id:record.id, request_id:record.render_presentation?.request_id ?? null, status:record.render_status, last_error:record.render_presentation?.last_error ?? null, artifact_reference:record.render_presentation?.artifact?.relative_path ?? null, seed:record.render_presentation?.seed ?? null, model:record.render_presentation?.provider_model ?? null, pipeline_version:record.render_presentation?.pipeline_version ?? null })); const environment_diagnostics = environment.diagnostics(world.q4_geography?.environment, entry?.run?.spatial?.player_location ?? null); const phenomenon_diagnostics=phenomenonEcology.diagnostics(world); const recent_public_events=developerInspection.recentHistory(world).filter((item)=>!String(item.type).startsWith("q4.phenomenon.")); const input = { world, session: projection, provider: { selected: provider.selected, offline: provider.offline, configured: Boolean(provider.openai?.configured || provider.groq?.configured || provider.gemini?.configured || provider.openrouter?.configured), status: provider.offline ? "offline" : (provider[active]?.status ?? (active === "auto" ? "ready" : "inactive")), evidence_media:provider.evidence_media }, interpretation_provenance: this.interpretationProvenance, doctrine: { source: doctrineRuntime.SOURCE, sha256: doctrineRuntime.read().sha256, priority: "constitutional" }, render_diagnostics, environment_diagnostics, phenomenon_diagnostics, note, save_schema_version: SAVE_SCHEMA_VERSION, recent_public_events, logs: this.sanitizedLogTail(), recovery: { world: this.recoveryStatus(world_id, "world"), session: this.recoveryStatus(world_id, mode) } }; const safeInput = redactDiagnostic(input); const report = q4BetaReport.report(safeInput); const file = q4BetaReport.writeReport(this.paths.logs, safeInput); return { ok: true, file, report }; } catch { return publicError("TESTER_REPORT_FAILED", "The diagnostic record could not be exported safely."); } }
  serializeSession(world, mode, entry) { const phase = entry.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (entry.kind === "bootstrap") return { version: 7, schema: SAVE_SCHEMA_VERSION, mode, kind: entry.kind, legacy_flow: entry.legacy_flow === true, phase, payload: bootstrap.saveRun(entry.run) }; if (entry.kind === "lost") return { version: 7, schema: SAVE_SCHEMA_VERSION, mode, kind: entry.kind, phase, payload: clone(entry.run) }; return { version: 7, schema: SAVE_SCHEMA_VERSION, mode, kind: entry.kind, phase, payload: clone(entry) }; }
  validateSessionSave(saved, mode) { if (!saved || typeof saved !== "object") return "SESSION_SAVE_DAMAGED"; if (saved.mode !== mode) return "SESSION_MODE_INVALID"; if (![1, 2, 3, 4, 5, 6, 7].includes(saved.version ?? 1)) return "SESSION_VERSION_UNSUPPORTED"; if (saved.version === 7 && saved.schema !== SAVE_SCHEMA_VERSION) return "SESSION_SCHEMA_UNSUPPORTED"; if (!["bootstrap", "lost", "nullzone", "beck"].includes(saved.kind)) return "SESSION_SAVE_DAMAGED"; if (saved.phase?.mode_id && saved.phase.mode_id !== mode) return "SESSION_SAVE_DAMAGED"; if (saved.kind === "bootstrap" && currentClearQ4(saved.payload) && (!hasCurrentEnvironment(saved.payload) || !bootstrap.resumeRun(saved.payload).ok)) return "SESSION_SAVE_DAMAGED"; try { if (saved.phase?.phase_id) phases.validate(mode, saved.phase.phase_id); } catch { return "SESSION_SAVE_DAMAGED"; } return null; }
  restoreSession(world, mode, saved, { allowUnmarked = true } = {}) { if (this.validateSessionSave(saved, mode) || !persistencePairMatches(world, saved, { mode, allowUnmarked })) return null; const phase = saved.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (saved.kind === "bootstrap") { const current = saved.payload?.version === "yellow-beast-save@v9"; if (currentClearQ4(saved.payload) && !hasCurrentStandardOperator(world)) return null; const hadSpatialState = Boolean(saved.payload?.spatial); const hadRadioState = Boolean(saved.payload?.expedition?.radio); const hadOperationalState = Boolean(saved.payload?.expedition?.operational); const restored = bootstrap.resumeRun(saved.payload, { world, spatial_worldpack: mode === "field-researcher" ? "clear-q4" : null, phase: phase.phase_id }); if (!restored.ok) return null; if (!current) { bootstrap.ensureSpatial(restored.run, phase.phase_id); if (!hadSpatialState) { if (["FIELD_OPERATION", "RETURN", "DEBRIEF"].includes(phase.phase_id)) bootstrap.enterSpatialField(restored.run); else bootstrap.setSpatialPhase(restored.run, phase.phase_id); } if (!hadRadioState && ["FIELD_OPERATION", "RETURN", "DEBRIEF"].includes(phase.phase_id)) q4Radio.completeCheck(restored.run.expedition); if (!hadOperationalState && restored.run.expedition?.clock?.check_in_due_at != null && !restored.run.expedition.communications?.check_ins?.length) q4Time.schedule(restored.run.expedition, Math.max(1, restored.run.expedition.clock.check_in_due_at - restored.run.expedition.clock.interval)); bootstrap.evaluateMissionState(restored.run, phase.phase_id); } return { kind: "bootstrap", run: restored.run, legacy_flow: saved.legacy_flow === true || phase.legacy_flow === true, restored_from_legacy:!current, phase }; } if (saved.kind === "lost") return { kind: "lost", run: saved.payload, phase }; if (saved.kind === "nullzone") return { kind: "nullzone", run_id: saved.payload.run_id, phase }; if (saved.kind === "beck") return { kind: "beck", run_id: saved.payload.run_id, phase }; return null; }
  loadSession(world, mode) { const file = this.sessionFile(world.world_id, mode); const current = readJsonCandidate(file); if (!current.ok && current.code === "SAVE_MISSING") return { ok:false, code:"SESSION_NOT_FOUND" }; const problem = current.ok ? this.validateSessionSave(current.value, mode) : "SESSION_SAVE_DAMAGED"; const entry = !problem ? this.restoreSession(world, mode, current.value) : null; if (entry) return { ok:true, entry, recovery:this.recoveryStatus(world.world_id, mode) }; if (["SESSION_VERSION_UNSUPPORTED","SESSION_SCHEMA_UNSUPPORTED"].includes(problem)) return { ok:false, code:problem }; const backup = readJsonCandidate(this.sessionBackupFile(world.world_id, mode)); const recovered = backup.ok && !this.validateSessionSave(backup.value, mode) ? this.restoreSession(world, mode, backup.value, { allowUnmarked:false }) : null; if (recovered) return { ok:true, entry:recovered, recovery:this.noteRecovery(world.world_id, mode, "previous-good-session") }; return { ok:false, code:problem ?? "SESSION_SAVE_DAMAGED" }; }
  loadPersistencePair(worldId, mode) {
    const worldPrimary = this.worldFile(worldId); const worldBackup = this.backupFile(worldId); const sessionPrimary = this.sessionFile(worldId, mode); const sessionBackup = this.sessionBackupFile(worldId, mode);
    const worlds = []; for (const [source,file] of [["primary",worldPrimary],["previous-good",worldBackup]]) { try { worlds.push({ source, value:this.loadWorldFile(file) }); } catch (error) { if (source === "primary" && error.code === "WORLD_VERSION_UNSUPPORTED") return { ok:false, code:error.code }; } }
    const sessions = []; let primaryProblem = "SESSION_SAVE_DAMAGED"; for (const [source,file] of [["primary",sessionPrimary],["previous-good",sessionBackup]]) { const candidate = readJsonCandidate(file); if (!candidate.ok) { if (source === "primary" && candidate.code === "SAVE_MISSING") primaryProblem = "SESSION_NOT_FOUND"; continue; } const problem = this.validateSessionSave(candidate.value, mode); if (source === "primary") primaryProblem = problem; if (!problem) sessions.push({ source, value:candidate.value }); }
    if (["SESSION_VERSION_UNSUPPORTED","SESSION_SCHEMA_UNSUPPORTED"].includes(primaryProblem)) return { ok:false, code:primaryProblem };
    const primaryWorld = worlds.find((item) => item.source === "primary"); const primarySession = sessions.find((item) => item.source === "primary");
    if (primaryWorld && primarySession) { if (persistencePairMatches(primaryWorld.value, primarySession.value, { mode, allowUnmarked:true })) { const entry = this.restoreSession(primaryWorld.value, mode, primarySession.value); if (entry) return { ok:true, world:primaryWorld.value, entry, worldSource:"primary", sessionSource:"primary" }; } return { ok:false, code:primaryProblem ?? "SESSION_SAVE_DAMAGED" }; }
    const order = [["previous-good","previous-good"],["previous-good","primary"],["primary","previous-good"]];
    for (const [worldSource,sessionSource] of order) { const world = worlds.find((item) => item.source === worldSource); const session = sessions.find((item) => item.source === sessionSource); if (!world || !session) continue; const allowUnmarked = worldSource === "primary" && sessionSource === "primary"; if (!persistencePairMatches(world.value, session.value, { mode, allowUnmarked })) continue; const entry = this.restoreSession(world.value, mode, session.value, { allowUnmarked }); if (entry) return { ok:true, world:world.value, entry, worldSource, sessionSource }; }
    return { ok:false, code:primaryProblem ?? "SESSION_SAVE_DAMAGED" };
  }
  saveSession(worldId, mode, serialized, { validateOnly = false } = {}) {
    const file = this.sessionFile(worldId, mode); const backup = this.sessionBackupFile(worldId, mode); const temporary = `${file}.${process.pid}.tmp`; const previousCandidate = `${backup}.${process.pid}.tmp`; let primaryCommitted = false; let hasPreviousCandidate = false;
    if (validateOnly) { const safe = history.canonicalJson(serialized, { code:"SESSION_VALUE_INVALID" }); if (this.validateSessionSave(safe, mode)) throw Object.assign(new Error("session candidate failed validation"), { code:"SESSION_SAVE_INVALID" }); return { ok:true, validated:true }; }
    try { const safe = history.canonicalJson(serialized, { code:"SESSION_VALUE_INVALID" }); ensureDirectory(path.dirname(temporary)); fs.writeFileSync(temporary, `${JSON.stringify(safe, null, 2)}\n`); const verified = readJsonCandidate(temporary); if (!verified.ok || this.validateSessionSave(verified.value, mode)) throw Object.assign(new Error("session candidate failed validation"), { code:"SESSION_SAVE_INVALID" }); if (fs.existsSync(file)) { const current = readJsonCandidate(file); if (current.ok && !this.validateSessionSave(current.value, mode)) { fs.copyFileSync(file, previousCandidate); const prior = readJsonCandidate(previousCandidate); if (!prior.ok || this.validateSessionSave(prior.value, mode)) throw Object.assign(new Error("session backup candidate failed validation"), { code:"SESSION_BACKUP_INVALID" }); hasPreviousCandidate = true; } } fs.renameSync(temporary, file); primaryCommitted = true; if (hasPreviousCandidate) { try { fs.renameSync(previousCandidate, backup); hasPreviousCandidate = false; } catch (error) { fs.renameSync(previousCandidate, file); hasPreviousCandidate = false; primaryCommitted = false; throw error; } } }
    catch (error) { for (const artifact of [temporary, previousCandidate]) { try { if (fs.existsSync(artifact)) fs.unlinkSync(artifact); } catch {} } if (primaryCommitted) throw Object.assign(new Error("session save could not be rolled back"), { code:"SESSION_SAVE_ROLLBACK_FAILED", cause:error }); throw error; }
  }
  commitPersistencePair(world, mode, serialized) {
    const stamped = stampPersistencePair(history.normalizeWorld(world), history.canonicalJson(serialized, { code:"SESSION_VALUE_INVALID" }), mode); const normalizedWorld = stamped.world; const safeSession = stamped.session;
    if (this.validateSessionSave(safeSession, mode) || !this.restoreSession(normalizedWorld, mode, safeSession, { allowUnmarked:false })) throw Object.assign(new Error("coordinated session candidate failed validation"), { code:"SESSION_SAVE_INVALID" });
    const worldFile = this.worldFile(normalizedWorld.world_id); const sessionFile = this.sessionFile(normalizedWorld.world_id, mode); const worldBackup = this.backupFile(normalizedWorld.world_id); const sessionBackup = this.sessionBackupFile(normalizedWorld.world_id, mode); const tag = `${process.pid}.${crypto.randomUUID()}`;
    const stagedWorld = `${worldFile}.${tag}.pair-world.tmp`; const stagedSession = `${sessionFile}.${tag}.pair-session.tmp`; const priorWorld = `${worldFile}.${tag}.pair-primary-rollback.tmp`; const priorSession = `${sessionFile}.${tag}.pair-primary-rollback.tmp`; const priorWorldBackup = `${worldBackup}.${tag}.pair-backup-rollback.tmp`; const priorSessionBackup = `${sessionBackup}.${tag}.pair-backup-rollback.tmp`; const nextWorldBackup = `${worldBackup}.${tag}.pair-next-backup.tmp`; const nextSessionBackup = `${sessionBackup}.${tag}.pair-next-backup.tmp`; const artifacts = [stagedWorld, stagedSession, priorWorld, priorSession, priorWorldBackup, priorSessionBackup, nextWorldBackup, nextSessionBackup];
    const existed = new Map([[worldFile,fs.existsSync(worldFile)],[sessionFile,fs.existsSync(sessionFile)],[worldBackup,fs.existsSync(worldBackup)],[sessionBackup,fs.existsSync(sessionBackup)]]); let commitStarted = false;
    const preserve = (source, target) => { if (fs.existsSync(source)) fs.copyFileSync(source, target); };
    const restore = (target, source) => { if (existed.get(target)) fs.copyFileSync(source, target); else if (fs.existsSync(target)) fs.unlinkSync(target); };
    try {
      fs.writeFileSync(stagedWorld, `${JSON.stringify(normalizedWorld, null, 2)}\n`); history.loadWorld(stagedWorld);
      fs.writeFileSync(stagedSession, `${JSON.stringify(safeSession, null, 2)}\n`); const staged = readJsonCandidate(stagedSession); if (!staged.ok || this.validateSessionSave(staged.value, mode) || !this.restoreSession(normalizedWorld, mode, staged.value, { allowUnmarked:false })) throw Object.assign(new Error("staged session failed validation"), { code:"SESSION_SAVE_INVALID" });
      preserve(worldFile, priorWorld); preserve(sessionFile, priorSession); preserve(worldBackup, priorWorldBackup); preserve(sessionBackup, priorSessionBackup);
      if (existed.get(worldFile)) { this.loadWorldFile(worldFile); fs.copyFileSync(worldFile, nextWorldBackup); history.loadWorld(nextWorldBackup); }
      if (existed.get(sessionFile)) { const old = readJsonCandidate(sessionFile); if (old.ok && !this.validateSessionSave(old.value, mode)) fs.copyFileSync(sessionFile, nextSessionBackup); }
      commitStarted = true; fs.renameSync(stagedWorld, worldFile); fs.renameSync(stagedSession, sessionFile);
      if (fs.existsSync(nextWorldBackup)) fs.renameSync(nextWorldBackup, worldBackup); if (fs.existsSync(nextSessionBackup)) fs.renameSync(nextSessionBackup, sessionBackup);
      return { ok:true, world:normalizedWorld, session:safeSession };
    } catch (error) {
      if (commitStarted) { try { restore(worldFile, priorWorld); restore(sessionFile, priorSession); restore(worldBackup, priorWorldBackup); restore(sessionBackup, priorSessionBackup); } catch (rollbackError) { throw Object.assign(new Error("coordinated persistence rollback failed"), { code:"PERSISTENCE_PAIR_ROLLBACK_FAILED", cause:rollbackError, original:error }); } }
      throw error;
    } finally { for (const artifact of artifacts) { try { if (fs.existsSync(artifact)) fs.unlinkSync(artifact); } catch {} } }
  }
  reconcileSessionCandidate(world, entry) {
    if (entry.kind !== "bootstrap") return;
    const candidate = bootstrap.saveRun(entry.run); if (currentClearQ4(candidate) && !hasCurrentStandardOperator(world)) throw Object.assign(new Error("current Clear-Q4 session is missing its Standard operator"), { code:"SESSION_WORLD_STATE_INVALID" });
    const sessionInstitution = entry.run._world?.institutional_response; const canonicalInstitution = world.institutional_response; if (sessionInstitution && (!canonicalInstitution || (sessionInstitution.revision ?? 0) > (canonicalInstitution.revision ?? 0))) world.institutional_response = clone(sessionInstitution); entry.run._world = world;
    const expedition = entry.run.expedition; q4Equipment.absorbCompatibility(expedition); if (expedition.logistics) logisticsRuntime.attach(expedition); q4Equipment.syncWorld(world, expedition); q4Trajectories.syncWorld(world, expedition);
    if (entry.run.spatial) { for (const change of entry.run.spatial.environment?.history ?? []) if (!change.world_history_id) change.world_history_id = history.event(world, entry.run.run_id, "q4.environment.changed", { environment_event_id:change.id, kind:change.kind, target:change.target, from:change.from ?? null, to:change.to ?? null, condition_id:change.condition_id ?? null, interval:change.at ?? expedition.clock.interval }, "canonical-environment-authority").id; world.q4_geography = spatialRuntime.canonicalSnapshot(entry.run.spatial); phenomenonEcology.materializeEligible(world,{spatial:world.q4_geography,at:expedition.clock.interval}); }
    if (entry.run.object_state) world.q4_object_state = clone(entry.run.object_state);
    for (const member of expedition.team?.members ?? []) { const person = history.character(world, member.personnel_id ?? member.id); if (!person) continue; const memberStatus = String(member.status ?? "").toLowerCase(); const memberCondition = String(member.condition ?? "").toLowerCase(); const observerOnly = ["normal","uninjured"].includes(memberCondition) && ["unavailable","missing"].includes(memberStatus); if (["missing","dead"].includes(person.status)) { if (!consequenceRuntime.PERSONNEL_STATUSES.has(memberStatus) || !new Set([...consequenceRuntime.PERSONNEL_CONDITIONS,"normal","recovering","deceased"]).has(memberCondition)) throw Object.assign(new Error("invalid terminal personnel observation state"), { code:"SESSION_PERSONNEL_STATE_INVALID" }); continue; } if (observerOnly) continue; const checked = consequenceRuntime.validatePersonnelSnapshot(member); if (!checked.ok) throw Object.assign(new Error("invalid session personnel authority state"), { code:checked.code }); const changed = person.status !== checked.status || String(person.condition).toLowerCase() !== checked.condition; person.status = checked.status; person.condition = checked.condition; if (changed) history.event(world, entry.run.run_id, "q4.personnel.condition.changed", { identity: person.identity, status: person.status, condition: person.condition, interval: expedition.clock.interval }, "authoritative-operational-consequence"); }
    for (const message of expedition.messages ?? []) { if (message.intended_recipient !== "Standard" || !["delivered", "acknowledged"].includes(message.state) || message.institutional_recorded) continue; const recordId = `q4-delivered-communication-${message.id}`; history.event(world, entry.run.run_id, "q4.communication.reported", { message_id: message.id, endpoint: "Standard", purpose: message.purpose, status: message.state, interval: message.delivered_at }); history.recordInstitutional(world, entry.run.run_id, recordId, { channel: "standard", purpose: message.purpose, report: message.text, status: message.state, source_message: message.id, delivered_at: message.delivered_at }); if (message.geography_report === true && entry.run.survey_frontier) surveyFrontier.report(entry.run.survey_frontier, message.sender, { at: message.delivered_at ?? expedition.clock?.interval ?? 0, message_id: message.id }); for (const evidenceId of message.evidence_ids ?? []) { history.recordInstitutional(world, entry.run.run_id, `institutional-evidence-${evidenceId}`, { evidence_id: evidenceId, source_message: message.id, status: "reported" }); evidenceAuthority.report(world, evidenceId, message.id); } message.institutional_recorded = recordId; }
    if (entry.run.survey_frontier) world.q4_survey_frontier = clone(entry.run.survey_frontier);
  }
  adoptPersistencePair(world, entry, committed) {
    for (const key of Object.keys(world)) delete world[key]; Object.assign(world, committed.world);
    if (entry.kind !== "bootstrap" || committed.entry?.kind !== "bootstrap") return;
    const source = committed.entry.run; const target = entry.run;
    const environmentIds = new Map((source.spatial?.environment?.history ?? []).map((change) => [change.id, change.world_history_id])); for (const change of target.spatial?.environment?.history ?? []) if (environmentIds.has(change.id)) change.world_history_id = environmentIds.get(change.id);
    const messageRecords = new Map((source.expedition?.messages ?? []).map((message) => [message.id, message.institutional_recorded])); for (const message of target.expedition?.messages ?? []) if (messageRecords.get(message.id)) message.institutional_recorded = messageRecords.get(message.id);
    target.survey_frontier = clone(source.survey_frontier); q4Equipment.absorbCompatibility(target.expedition); if (target.expedition.logistics) logisticsRuntime.attach(target.expedition); missionRuntime.attachCompatibilityView(target.expedition); target._world = world;
  }
  session(worldId, mode) { return this.sessions.get(`${worldId}:${mode}`) ?? null; }
  persistSession(world, mode, entry) { if (this.recoveredWorlds.has(world.world_id)) throw Object.assign(new Error("automatic recovery is read-only until explicitly adopted"), { code:"PERSISTENCE_RECOVERY_READ_ONLY" }); const candidateWorld = history.canonicalJson(world, { code:"CANONICAL_WORLD_VALUE_INVALID" }); const candidateEntry = sessionRuntimeCandidate(entry); if (candidateEntry.kind === "bootstrap") missionRuntime.attachCompatibilityView(candidateEntry.run.expedition); this.reconcileSessionCandidate(candidateWorld, candidateEntry); const serialized = this.serializeSession(candidateWorld, mode, candidateEntry); const committed = this.commitPersistencePair(candidateWorld, mode, serialized); committed.entry = candidateEntry; this.adoptPersistencePair(world, entry, committed); this.sessions.set(`${world.world_id}:${mode}`, entry); try { const data = this.metadata(); if (data.worlds[world.world_id]) { data.worlds[world.world_id].last_played_at = new Date().toISOString(); data.worlds[world.world_id].last_mode = mode; data.last_world_id = world.world_id; this.writeMetadata(data); } } catch (error) { this.log(`persistence metadata update failed after coordinated commit: ${error.message}`); } }
  persistTerminalRetirement(world, mode, entry) {
    if (this.recoveredWorlds.has(world.world_id)) throw Object.assign(new Error("automatic recovery is read-only until explicitly adopted"), { code:"PERSISTENCE_RECOVERY_READ_ONLY" });
    const candidateWorld = history.canonicalJson(world, { code:"CANONICAL_WORLD_VALUE_INVALID" });
    const candidateEntry = sessionRuntimeCandidate(entry);
    if (candidateEntry.kind === "bootstrap") {
      candidateEntry.run._world = candidateWorld;
      missionRuntime.attachCompatibilityView(candidateEntry.run.expedition);
    }
    const retired = outcomes.retire(candidateWorld, candidateEntry.run);
    if (!retired.ok) throw Object.assign(new Error("terminal retirement rejected"), { code:retired.code });
    const serialized = this.serializeSession(candidateWorld, mode, candidateEntry);
    const committed = this.commitPersistencePair(candidateWorld, mode, serialized);
    committed.entry = candidateEntry;
    this.adoptPersistencePair(world, entry, committed);
    this.sessions.set(`${world.world_id}:${mode}`, entry);
    try {
      const data = this.metadata();
      data.legacy_personnel_archive ??= {};
      if (retired.legacy) data.legacy_personnel_archive[retired.legacy.id] = clone(retired.legacy);
      if (data.worlds[world.world_id]) data.worlds[world.world_id].last_mode = mode;
      this.writeMetadata(data);
    } catch (error) {
      this.log(`retirement metadata update failed after coordinated commit: ${error.message}`);
    }
    this.saveSession(world.world_id, mode, serialized, { validateOnly:true });
    return retired;
  }
  startSession({ world_id, mode, seed = "desktop", require_personnel = false, scenario = null }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try { const world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); const descriptor = this.getMode(mode); if (!descriptor) return publicError("MODE_INVALID", "Choose one of the available roles."); let entry;
      if (mode === "field-researcher") { if (require_personnel && !world.q4_operations?.controlled_player) return publicError("PERSONNEL_CREATION_REQUIRED", "Create your ASYNC personnel record before receiving an assignment."); const requestedScenario = scenario === "reference-expedition" || (scenario == null && this.defaultQ4Scenario === "reference-expedition") ? "reference-expedition" : "procedural-survey"; const started = bootstrap.startRun({ profile: mode, seed, scenario: requestedScenario, world, spatial_worldpack: "clear-q4" }); if (!started.ok) return publicError("SESSION_START_FAILED", "The field session could not start."); standardOperator.ensure(world, started.run.run_id); entry = { kind: "bootstrap", run: started.run, legacy_flow: false, phase: phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }) }; bootstrap.setSpatialPhase(entry.run, entry.phase.phase_id); }
      else if (mode === "lost") entry = { kind: "lost", run: lost.start(world, seed), phase: phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }) };
      else { const run_id = history.beginRun(world, { profile: mode, scenario: mode === "async-command" ? "becks-desk-operations" : "nullzone-exposure", seed }); if (mode === "local-anomaly") { const prepared = nullzone.prepare(world, run_id, ["field-light", "recording-device", "evidence-container"]); if (!prepared.ok || !nullzone.enter(world, run_id).ok) return publicError("SESSION_START_FAILED", "The civilian excursion could not start."); entry = { kind: "nullzone", run_id }; } else entry = { kind: "beck", run_id }; }
      entry.phase ??= phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (entry.kind === "bootstrap") entry.phase.legacy_flow = entry.legacy_flow === true; this.persistSession(world, mode, entry); return { ok: true, session: { world_id, mode, resumable: true }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`session start failed: ${error.message}`); return publicError("SESSION_START_FAILED", "This session could not start safely."); }
  }
  resumeSession({ world_id, mode }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const loaded = this.loadPersistencePair(world_id, mode);
      if (!loaded.ok) {
        const messages = {
          SESSION_NOT_FOUND: "There is no operational record to continue.",
          SESSION_VERSION_UNSUPPORTED: "This operation record was created by a newer unsupported version and was left unchanged.",
          SESSION_SCHEMA_UNSUPPORTED: "This operation record cannot be opened safely by this version and was left unchanged.",
          SESSION_SAVE_DAMAGED: "This operation record is damaged and no verified coordinated previous record is available. It was left unchanged."
        };
        return publicError(loaded.code, messages[loaded.code] ?? "This operation record could not be resumed safely.");
      }
      const world = loaded.world;
      if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is retired. Its historical archive remains available.");
      const recovered = loaded.worldSource !== "primary" || loaded.sessionSource !== "primary";
      if (recovered) {
        this.recoveredWorlds.set(world_id, clone(world));
        if (loaded.worldSource !== "primary") this.noteRecovery(world_id, "world", "previous-good-world");
        if (loaded.sessionSource !== "primary") this.noteRecovery(world_id, mode, "previous-good-session");
      }
      if (mode === "field-researcher" && loaded.entry.kind === "bootstrap" && loaded.entry.restored_from_legacy) {
        standardOperator.ensure(world, loaded.entry.run.run_id);
        if (!recovered) this.persistSession(world, mode, loaded.entry);
      }
      this.sessions.set(`${world_id}:${mode}`, loaded.entry);
      return { ok:true, session:{ world_id, mode, resumable:true }, recovery:{ world:this.recoveryStatus(world_id, "world"), session:this.recoveryStatus(world_id, mode), coordinated_pair:recovered }, projection:this.projectionFor(world, mode, loaded.entry) };
    } catch {
      return publicError("SESSION_RESUME_FAILED", "This session could not be resumed safely.");
    }
  }
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
    const phaseInstruction = { BRIEFING: "Review the Clear-Q4 survey assignment and continue to staging.", STAGING: "Review issued equipment and proceed to the threshold room.", FACILITY_TRANSIT: "Proceed with the accounted team toward the Threshold room.", THRESHOLD: "Confirm personnel accountability and begin the Standard radio procedure.", STANDARD_RADIO_CHECK: "Establish contact with Standard before entering the field." }[phaseId];
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
  decorateEvidenceMedia(projection, world) { if (!projection.q4?.archive) return projection; const safe = clone(projection); safe.q4.archive.records = safe.q4.archive.records.map((record) => { const presentation = record.render_presentation ?? evidenceAuthority.presentation(record); const available = presentation.status === "ready" && evidenceMedia.artifactAvailable(this.paths.media, presentation.artifact); const status = !available && presentation.status === "ready" ? "unavailable" : presentation.status; return { ...record, render_presentation:{ ...presentation, status, artifact_available:available, artifact_url:available ? `file:///${path.resolve(this.paths.media, presentation.artifact.relative_path).replace(/\\/g, "/")}` : null }, fallback:evidenceMedia.fallback(record, available ? "" : presentation.last_error?.message ?? "not generated") }; }); return safe; }
  projectionFor(world, mode, entry) { const descriptor = this.getMode(mode); const runId = entry.run_id ?? entry.run?.run_id ?? null; let surface;
    if (entry.kind === "bootstrap") surface = bootstrap.status(entry.run); else if (entry.kind === "lost") surface = lost.projection(entry.run); else if (entry.kind === "nullzone") surface = { ...nullzone.projection(world), local_observation: nullzone.observeRegion(world) }; else surface = desk.projection(world);
    const phase = entry.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); const unfinished = consequenceEchoes.unfinishedBusiness(world, mode, { run_id: runId }); return this.decorateEvidenceMedia({ version: "yellow-beast-desktop-projection@v1", world: this.worldInfo(world, this.metadata().worlds[world.world_id] ?? {}), mode: clone(descriptor), gameplay: gameplay.projection(world, { mode: descriptor.gameplay_mode, run_id: runId }), institution: mode === "async-command" ? desk.projection(world) : null, consequence_echoes: consequenceEchoes.observerView(world, mode, { run_id: runId }), unfinished_business: unfinished, surface: clone(surface), phase: clone(phase), q4: entry.kind === "bootstrap" ? q4.presentation(entry.run, phase, unfinished, world) : null, beck: entry.kind === "beck" ? beckExperience.presentation(world, surface, phase, unfinished) : null, nullzone: entry.kind === "nullzone" ? nullzoneExperience.presentation(world, phase, unfinished) : null, lost: entry.kind === "lost" ? lostExperience.presentation(surface, phase, unfinished) : null, scene: this.sceneFor(entry, mode, {}, world), available_actions: this.availableFor(world, mode, entry), settings: this.settings() }, world);
  }
  getGameplayProjection({ world_id, mode }) { try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue a session first."); return { ok: true, projection: this.projectionFor(world, mode, entry) }; } catch { return publicError("PROJECTION_UNAVAILABLE", "Gameplay state is not available."); } }
  getRetiredWorldArchive({ world_id }) { try { const world = this.getWorld(world_id); if (!outcomes.isRetired(world)) return publicError("WORLD_ACTIVE", "This world is still an active simulation."); return { ok:true, archive:outcomes.archive(world), reviews:clone(world.q4_reviews ?? {}), evidence:evidenceAuthority.archive(world,{observer:"player"}) }; } catch { return publicError("ARCHIVE_UNAVAILABLE", "The historical record could not be opened safely."); } }
  getInstitutionProjection({ world_id }) { try { const world = this.getWorld(world_id); return { ok: true, projection: { management: desk.projection(world), standard: institutionalRuntime.project(world, bootstrap.institutionalDefinitionFor("clear-q4")) } }; } catch { return publicError("INSTITUTION_UNAVAILABLE", "Institution state is not available."); } }

  q4LogisticsContext(entry, world) { const player = entry.run.session.startup.player.observer_id; const team = entry.run.expedition.team?.members ?? []; const names = Object.fromEntries(team.map((member) => [member.personnel_id ?? member.id, member.display_name])); const institution = institutionalRuntime.ensure(world, bootstrap.institutionalDefinitionFor(entry.run.spatial_pack_id)); return { player, actor: player, team, names, spatial: entry.run.spatial, location: entry.run.spatial?.player_location, at: entry.run.expedition.clock?.interval ?? 0, phase: entry.phase?.phase_id, restrictions: institution.restrictions?.equipment ?? [] }; }
  prepareQ4Return(world, entry) {
    const expedition = entry.run.expedition;
    if (expedition.return_processing?.evidence_custody_completed) return expedition.return_processing;
    logisticsRuntime.reconcile(expedition, bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id), { ...this.q4LogisticsContext(entry, world), actor:entry.run.session.startup.player.observer_id });
    q4Equipment.syncWorld(world, expedition);
    evidenceAuthority.synchronizeReturn(world, entry.run, expedition.mission_state?.final_result?.return_outcome?.completed === true);
    expedition.return_processing = { version:"yellow-beast-return-processing@v1", evidence_custody_completed:true, completed_at:{ interval:expedition.clock?.interval ?? 0 } };
    return expedition.return_processing;
  }
  finalizeQ4Closure(world, entry) {
    const expedition = entry.run.expedition;
    if (expedition.institutional_closure_ingested) return q4Continuity.review(world, expedition.mission?.id);
    this.prepareQ4Return(world, entry);
    const continuity = q4Continuity.commitOutcome(world, entry.run, expedition.mission_state?.return?.abort_requested ? "ABORT" : "RETURN");
    institutionalRuntime.ingestClosure(world, bootstrap.institutionalDefinitionFor(entry.run.spatial_pack_id), entry.run, continuity.review);
    expedition.institutional_closure_ingested = true;
    history.updateQ4Mission(world, entry.run.run_id, expedition.mission.id, { status:expedition.mission_state.final_result.final_mission_state, result:expedition.mission_state.final_result });
    assignmentEngine.resolve(world, expedition.mission.work_order_id ?? expedition.mission.id, { completed:expedition.mission_state.final_result.final_mission_state === "completed", aborted:expedition.mission_state.return?.abort_requested === true });
    const readyForDebrief = ["RETURN", "REPORT"].includes(entry.phase?.phase_id) ? { ok:true, phase:entry.phase } : phases.transition(entry.phase, "RETURN", { reason:"mission-closure", guard:true });
    entry.phase = readyForDebrief.ok ? phases.transition(readyForDebrief.phase, "DEBRIEF", { reason:"mission-review", guard:true }).phase : entry.phase;
    bootstrap.evaluateMissionState(entry.run, "DEBRIEF");
    return continuity.review;
  }
  submitReferenceWrittenReport({ world_id, text }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    const world = this.getWorld(world_id);
    const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
    if (!entry || entry.kind !== "bootstrap" || !referenceExpedition.isReference(entry.run.scenario) || entry.phase?.phase_id !== "REPORT") return publicError("REFERENCE_REPORT_UNAVAILABLE", "A written expedition report is not available from the current phase.");
    const written = referenceExpedition.writeReport(entry.run, { author:entry.run.session.startup.player.observer_id, text, at:entry.run.expedition.clock?.interval ?? 0 });
    if (!written.ok) return publicError(written.code, written.code === "REFERENCE_REPORT_EMPTY" ? "Enter the account you intend to submit to A-Sync." : written.code === "REFERENCE_REPORT_TOO_LONG" ? "The written report exceeds the 4,000-character field limit." : "The written report could not be accepted.");
    const report = entry.run.expedition.written_report;
    const records = evidenceAuthority.archive(world, { observer:"standard" }).records.filter((record) => record.operation_id === report.mission_id);
    report.available_evidence_ids = records.map((record) => record.id);
    const prior = entry.run.expedition.mission.prior_history.find((item) => item.id === referenceExpedition.definition.prior_record.id);
    report.institutional_assessment = referenceExpedition.assessInstitutionalRecord({ report, prior_record:prior, evidence_records:records });
    const institutionDefinition = bootstrap.institutionalDefinitionFor(entry.run.spatial_pack_id);
    if (records.length) institutionalRuntime.ingest(world, null, institutionDefinition, { type:"evidence-report", state:"confirmed", quality:"recorded", summary:`${records.length} returned evidence record${records.length === 1 ? "" : "s"} entered Evidence Intake custody.`, facts:records.map((record) => ({ kind:"returned-evidence", id:record.id })), provenance:{ kind:"returned-evidence", id:`${report.id}:evidence-intake`, report_id:report.id } });
    const assessment = report.institutional_assessment;
    institutionalRuntime.ingest(world, null, institutionDefinition, { type:assessment.status === "no-spatial-discrepancy-entered" ? "normal-report" : "contradictory-report", state:"confirmed", quality:assessment.basis.evidence_ids.length ? "recorded" : "claim", summary:report.text, facts:[{ kind:"written-report-claim", id:report.id }, ...(assessment.status === "no-spatial-discrepancy-entered" ? [] : [{ kind:"spatial-discrepancy-assessment", id:assessment.status }])], provenance:{ kind:"written-report", id:report.id, author:report.author } });
    history.event(world, entry.run.run_id, "q4.written-report.submitted", { report_id:report.id, mission_id:report.mission_id, author:report.author, available_evidence_ids:[...report.available_evidence_ids], assessment_status:assessment.status }, "q4-canonical-continuity");
    const review = this.finalizeQ4Closure(world, entry);
    this.persistSession(world, "field-researcher", entry);
    const scene = this.sceneFor(entry, "field-researcher", { scene_type:"delta", accepted:true, public_reason:assessment.summary }, world);
    return { ok:true, result:{ turn_status:"REPORT_SUBMITTED", executed:true, report_id:report.id, institutional_assessment:clone(assessment), summary:assessment.summary, scene }, projection:this.projectionFor(world, "field-researcher", entry), review };
  }
  submitQ4Logistics({ world_id, action, item_id = null, container_id = null, target_holder = null, target_container = null, source_item_id = null, quantity = 1 }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (outcomes.isRetired(this.getWorld(world_id))) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
    try { const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null)); if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before managing equipment."); const context = this.q4LogisticsContext(entry, world); const definition = bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id); const resolveHolder = (value) => { if (!value) return null; if (value === "You") return context.actor; const member = context.team.find((candidate) => [candidate.personnel_id, candidate.id, candidate.display_name].includes(value)); return member?.personnel_id ?? member?.id ?? value; }; const request = { action, item_id, container_id, actor: context.actor, target_holder: resolveHolder(target_holder), target_container, source_item_id, quantity }; const result = container_id ? logisticsRuntime.transactContainer(entry.run.expedition, definition, request, context) : logisticsRuntime.transact(entry.run.expedition, definition, request, context); if (!result.ok) return publicError(result.code, result.public_reason); logisticsRuntime.syncSpatial(entry.run.expedition, entry.run.spatial); spatialRuntime.syncEquipment(entry.run.spatial, entry.run.expedition); const authoredCost = bootstrap.dynamicsDefinitionFor(entry.run.spatial_pack_id).action_costs[String(action).toUpperCase()] ?? (/^INSPECT|^VERIFY/.test(String(action).toUpperCase()) ? 0 : 1); const cycle = bootstrap.resolveOperationalCycle(entry.run, String(action).toUpperCase(), authoredCost, "logistics-transaction"); expeditionEvent(entry.run.expedition, "logistics.transaction.committed", { transaction_id: result.transaction.id, action: result.transaction.action, item_id: result.transaction.item_id ?? null, container_id: result.transaction.container_id ?? null }); this.persistSession(world, "field-researcher", entry); return { ok: true, result: { outcome: "succeeded", public_reason: result.public_reason, transaction: { action: result.transaction.action, summary: result.transaction.summary, at: result.transaction.at }, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates }, projection: this.projectionFor(world, "field-researcher", entry) }; } catch (error) { this.log(`Q4 logistics failed: ${error.message}`); return publicError("LOGISTICS_RUNTIME_ERROR", "The logistics transaction could not be committed safely."); }
  }
  availableFor(world, mode, entry) {
    if (outcomes.isRetired(world)) return [];
    if (entry.kind === "bootstrap") {
      if (entry.phase?.phase_id === "REPORT") return [];
      const legacyFlow = entry.legacy_flow === true || entry.phase?.legacy_flow === true;
      const phaseActions = legacyFlow
        ? { BRIEFING: "READY", STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "CROSS", STANDARD_RADIO_CHECK: q4Radio.read(entry.run.expedition).check_completed ? "BEGIN_FIELD_OPERATION" : null }
        : { BRIEFING: "READY", STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "READY", STANDARD_RADIO_CHECK: q4Radio.read(entry.run.expedition).check_completed ? "CROSS" : null };
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
        if (type === "USE" && referenceExpedition.isReference(entry.run.scenario) && entry.run.spatial?.player_location !== referenceExpedition.definition.measurement.location_id && !objectActionTypes.has("USE")) return false;
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
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap" || entry.run.lifecycle !== "completed" || entry.phase?.phase_id !== "DEBRIEF") return publicError("REVIEW_REQUIRED", "Complete the current review before advancing operations.");
      const processed = q4Career.process(world, bootstrap.institutionalDefinitionFor(entry.run.spatial_pack_id), entry.run, q4Continuity.review(world, entry.run.expedition?.mission?.id));
      const seed = q4Continuity.nextSeed(world, entry.run.expedition?.mission?.id ?? entry.run.expedition?.id); const current = world.q4_operations?.controlled_player;
      if (history.character(world, current)?.status === "dead") return publicError("WORLD_RETIRED", "Controlled personnel death retires this world; begin a new career in a new world.");
      const started = bootstrap.startRun({ profile: "field-researcher", seed, scenario: "procedural-survey", world, player_identity: current, spatial_worldpack: "clear-q4" }); if (!started.ok) return publicError("NEXT_EXPEDITION_UNAVAILABLE", "The next assignment could not be prepared safely.");
      const next = { kind: "bootstrap", run: started.run, phase: phases.createPhase({ mode: "field-researcher", guided: this.settings().guided_introductions !== false }) }; this.persistSession(world, "field-researcher", next); return { ok: true, result: { outcome: "operations-advanced", public_reason: processed.idempotent ? "The recorded institutional cycle was already complete; the next assignment remains unchanged." : "Institutional processing completed; the next Clear-Q4 assignment is available.", career_cycle: processed.cycle }, projection: this.projectionFor(world, "field-researcher", next) };
    } catch { return publicError("NEXT_EXPEDITION_UNAVAILABLE", "The next assignment could not be prepared safely."); }
  }
  recordQ4Action(entry, text, result, world = null, submission_id = null, canonicalAction = null) {
    const verb = canonicalAction ?? String(text).trim().split(/\s+/, 1)[0].toUpperCase();
    if (verb === "RETURN" && entry.run.expedition?.mission?.hidden_trajectory?.state?.status !== "dormant") q4Trajectories.contain({ world, expedition: entry.run.expedition, run_id: entry.run.run_id, reason: "early return or completed field work" });
    const observation = q4Trajectories.resolveAction({ world, expedition: entry.run.expedition, run_id: entry.run.run_id, phase: entry.phase?.phase_id, verb: verb === "PHOTOGRAPH" ? "RECORD" : verb, result, observation_kind: /record|photograph/i.test(text) ? "record" : /contact|radio|check.?in/i.test(text) ? "contact" : null, comparison: /compare|reconcile|prior|layout/i.test(text) });
    if (observation.observed && result.result) result.result.public_reason = observation.summary;
    return q4Interactions.record(entry.run.expedition, { channel: "action", speaker: "You", targets: [], player_text: text, attempted_behavior: text, eligibility: result.ok ? "eligible" : "rejected", delivery: "not-applicable", time_cost: result.result?.time_advanced ?? (/^WAIT\b/.test(text) ? 1 : 0), canonical_effects: result.result?.canonical_event_ids ?? [], presentation: { result: observation.summary ?? (result.ok ? result.outcome ?? "succeeded" : result.error?.code ?? "rejected") }, submission_id });
  }
  submitQ4LocalIntent({ world_id, text, request_id = null }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before issuing a LOCAL order.");
      if (!["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id)) return publicError("LOCAL_PHASE_INVALID", "Nearby field orders are available only during an active field operation or return.");
      const run = entry.run; const expedition = run.expedition; const player = run.session.startup.player.observer_id;
      const requestId = request_id ?? `local-${crypto.createHash("sha256").update(`${run.run_id}|${expedition.clock.interval}|${text}`).digest("hex").slice(0, 18)}`;
      expedition.local_intent_requests ??= []; const duplicate = expedition.local_intent_requests.find((item) => item.id === requestId);
      if (duplicate) return { ok: true, result: { ...clone(duplicate.result), duplicate: true }, projection: this.projectionFor(world, "field-researcher", entry) };
      const local = expedition.team.members.filter((member) => member.personnel_id !== player && q4Personnel.observerStatus(member, history.character(world, member.personnel_id), entry.phase.phase_id, run.spatial, player).local_eligible);
      const inventory = Object.values(expedition.equipment ?? {}).filter((item) => item.holder === player);
      const knownLocations = surveyFrontier.map(run.survey_frontier, bootstrap.topologyFor(run), player).nodes.map((node) => ({ id: node.id, name: node.name }));
      const parsed = localIntent.parse(text, { local, inventory, locations: knownLocations, request_id: requestId });
      if (!parsed.ok) return publicError(parsed.code, parsed.clarification ?? "Clarify the nearby-worker request.");
      const validated = localIntent.validateProposal(parsed.proposal, { local, inventory, locations: knownLocations });
      if (!validated.ok) return publicError(validated.code, "The proposed LOCAL action is not available in this context.");
      const recipient = validated.recipient; const recipientId = recipient.personnel_id ?? recipient.id;
      const delivered = communicationRuntime.local(expedition, { sender: player, recipients: [recipientId], text, purpose: "local-order", eligible: true });
      phenomenonEcology.recordSpeech(world, run, { speaker:player, text, location_id:run.spatial.player_location });
      const results = [];
      for (const action of validated.proposal.actions) {
        if (action.type === "QUERY") { results.push({ action: action.type, state: "clarification-requested", reason: "No new observation is established by a question alone." }); continue; }
        if (action.type === "TRANSFER") {
          const item = Object.entries(expedition.equipment).find(([, value]) => value.id === action.equipment_id || value.instance_id === action.equipment_id);
          if (!item || item[1].holder !== player) { results.push({ action: action.type, state: "refused", reason: "EQUIPMENT_NOT_IN_PLAYER_CUSTODY" }); continue; }
          const transferred = logisticsRuntime.transact(expedition, bootstrap.logisticsDefinitionFor(run.spatial_pack_id), { action: "HAND_OVER", item_id: item[0], actor: player, target_holder: recipientId }, this.q4LogisticsContext(entry, world));
          if (!transferred.ok) { results.push({ action: action.type, state: "refused", reason: transferred.code }); continue; }
          personnelContinuity.recordCustody(world, { run_id: run.run_id, equipment_id: transferred.item.instance_id, from: player, to: recipientId, at: expedition.clock.interval });
          personnelContinuity.recordSharedHistory(world, { run_id: run.run_id, participants: [player, recipientId], kind: "equipment-transferred", refs: { equipment_id: transferred.item.instance_id }, at: expedition.clock.interval });
          results.push({ action: action.type, state: "completed", equipment_id: transferred.item.instance_id }); continue;
        }
        const type = { STAY: "hold", FOLLOW: "follow", WAIT: "wait", MOVE: "move-to", RETURN: "return", REPORT: "communicate-local", ASSIST: "assist", INVESTIGATE: "investigate" }[action.type];
        if (!type) { results.push({ action: action.type, state: "clarification-requested", reason: "ACTION_FAMILY_NOT_BACKED_BY_TEAM_RUNTIME" }); continue; }
        const workerKnowsDestination = !action.location_id || surveyFrontier.known(run.survey_frontier, recipientId, action.location_id);
        const decision = personnelContinuity.decide(personnelContinuity.decisionContext({ world, run, phase: entry.phase.phase_id, worker_id: recipientId, request: { type, received: true, target_location: action.location_id ?? null, reachable: workerKnowsDestination, perceived_risk: 0 } }));
        const order = teamRuntime.issueOrder(run, bootstrap.spatialDefinitionFor(run.spatial_pack_id), { recipient: recipientId, type, target: action.location_id ?? null, channel: "LOCAL", decision });
        if (order.order && action.deferred) order.order.deferred_condition = clone(action.deferred);
        results.push({ action: action.type, state: order.order?.state ?? "failed", reason: order.order?.reason ?? null, order: order.order ?? null });
      }
      personnelContinuity.recordSharedHistory(world, { run_id: run.run_id, participants: [player, recipientId], kind: "local-order-received", refs: { request_id: requestId, message_id: delivered.message.id }, at: expedition.clock.interval });
      q4Interactions.record(expedition, { channel: "local", speaker: "You", targets: [recipient.display_name], player_text: text, attempted_behavior: "issue a bounded nearby-worker order", eligibility: "eligible", delivery: "heard", canonical_effects: results.filter((item) => ["accepted", "completed"].includes(item.state)).map((item) => `local.${item.action.toLowerCase()}`), presentation: { result: results.map((item) => `${item.action}: ${item.state}`).join("; ") } });
      const cycle = bootstrap.resolveOperationalCycle(run, "LOCAL_ORDER", 0, "local-natural-order");
      const result = { outcome: results.some((item) => ["accepted", "completed"].includes(item.state)) ? "resolved" : "clarification-or-refusal", proposal: clone(validated.proposal), results: clone(results), public_reason: `${recipient.first_name}: ${results.map((item) => item.state.replace(/-/g, " ")).join(", ")}.`, time_advanced: cycle.clock.cost };
      result.scene = this.sceneFor(entry, "field-researcher", { action:"LOCAL_ORDER", scene_type:"delta", accepted:true, public_reason:result.public_reason }, world); expedition.local_intent_requests.push({ id: requestId, result: clone(result) }); this.persistSession(world, "field-researcher", entry);
      return { ok: true, result, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) { this.log(`LOCAL intent failed: ${error.message}`); return publicError("LOCAL_INTENT_RUNTIME_ERROR", "The nearby-worker request could not be resolved safely."); }
  }
  submitQ4Communication(input = {}) {
    const canonical = this.submitQ4CommunicationCanonical(input);
    const providerSetting = this.settings().provider;
    const configured = ["openai", "auto", "groq", "gemini", "openrouter"].includes(providerSetting);
    if (input.channel !== "local" || !canonical?.ok || (!configured && !this.localDialogueProvider)) return canonical;
    return this.presentHostedLocalDialogue(input, canonical, { configured });
  }
  async presentHostedLocalDialogue({ world_id }, canonical, { configured }) {
    const context = canonical._local_dialogue_context;
    delete canonical._local_dialogue_context;
    if (!context) return canonical;
    const requestId = `desktop-local-${world_id}-${Date.now()}`;
    const providerSetting = this.settings().provider;
    const isManualHosted = ["openai", "groq", "gemini", "openrouter"].includes(providerSetting);
    const key = isManualHosted ? this.credentials.get(providerSetting) : null;
    if (isManualHosted && !key && !this.localDialogueProvider) {
      canonical.result.provider_unavailable = true;
      canonical.result.presentation_source = "deterministic-fallback";
      canonical.result.public_reason = `Language assistance is unavailable. Deterministic response: ${context.fallback_text}`;
      canonical.result.scene.narration = canonical.result.public_reason;
      canonical.result.scene.narration_source = "deterministic-fallback";
      return canonical;
    }
    const provider = this.localDialogueProvider ?? this.providerPool.createAutoProvider({ requestId, route:"submitQ4Communication/local-dialogue" });
    this.recordInterpretationProvenance({ request_id:requestId, route:"submitQ4Communication/local-dialogue", event:"provider-selected", input:"player-supplied", provider:provider.name, model:provider.model ?? "injected", provider_invoked:false, response_classification:"not-yet-observed", canonical_resolution:"communication-runtime -> personnel-continuity -> presentation-validation", observer_projection:"local-dialogue-packet@v1" });
    try {
      if (typeof provider.presentLocal !== "function") throw new Error("local dialogue provider unavailable");
      const packet = buildLocalDialoguePacket(context);
      const validation = validateLocalDialogue(packet, await provider.presentLocal(structuredClone(packet)));
      if (!validation.ok) {
        canonical.result.provider_unavailable = true;
        canonical.result.presentation_source = "deterministic-fallback";
        canonical.result.public_reason = `Language assistance returned an invalid response and was rejected. Deterministic response: ${context.fallback_text}`;
      } else {
        canonical.result.presentation_source = "hosted-model";
        canonical.result.hosted_request = { request_id:requestId, provider:provider.name, status:"completed" };
        canonical.result.public_reason = `${context.speaker.display_name}: ${validation.candidate.speech}`;
        context.interaction.presentation.response = validation.candidate.speech;
        context.interaction.presentation.source = "hosted-model";
        this.persistSession(context.world, "field-researcher", context.entry);
      }
    } catch (error) {
      this.log(`LOCAL language assistance unavailable: ${error.message}`);
      canonical.result.provider_unavailable = true;
      canonical.result.presentation_source = "deterministic-fallback";
      canonical.result.public_reason = `Language assistance is unavailable. Deterministic response: ${context.fallback_text}`;
    }
    canonical.result.scene.narration = canonical.result.public_reason;
    canonical.result.scene.narration_source = canonical.result.presentation_source;
    return canonical;
  }
  submitQ4CommunicationCanonical({ world_id, channel, text, target = null }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (outcomes.isRetired(this.getWorld(world_id))) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before communicating.");
      if (!q4Interactions.CHANNELS.includes(channel) || channel === "action") return publicError("CHANNEL_INVALID", "Choose a communication channel.");
      const message = typeof text === "string" ? text.trim().slice(0, 2000) : "";
      if (!message) return publicError("COMMUNICATION_EMPTY", "Say or transmit something before sending it.");
      const expedition = entry.run.expedition; const playerId = entry.run.session.startup.player.observer_id; const coworkers = expedition.team.members.filter((member) => member.personnel_id !== playerId); const requested = String(target ?? "").toLowerCase(); const peer = requested && !["team", "teammate", "standard"].includes(requested) ? coworkers.find((member) => [member.personnel_id, member.first_name, member.display_name].filter(Boolean).some((value) => String(value).toLowerCase() === requested)) : null; const person = peer ? history.character(world, peer.personnel_id ?? peer.id) : null; const observed = peer && channel === "local" ? q4Personnel.observerStatus(peer, person, entry.phase?.phase_id, entry.run.spatial, playerId) : null;
      if (channel === "local") {
        const localPeers = coworkers.filter((member) => { const record = history.character(world, member.personnel_id ?? member.id); return member.status === "active" && q4Personnel.observerStatus(member, record, entry.phase?.phase_id, entry.run.spatial, playerId).local_eligible; });
        if (peer && !localPeers.some((m) => (m.personnel_id ?? m.id) === (peer.personnel_id ?? peer.id))) {
          const reason = peer?.condition === "Unresponsive" ? "The teammate is unresponsive." : `${peer.first_name || peer.display_name} is not within speaking range.`;
          communicationRuntime.local(expedition, { sender: playerId, recipients: [peer.personnel_id ?? peer.id], text: message, eligible: false, failure_reason: reason });
          q4Interactions.record(expedition, { channel, speaker: "You", targets: [peer.display_name], player_text: message, attempted_behavior: "speak with a nearby teammate", eligibility: "target-out-of-range", delivery: "not-delivered", presentation: { result: reason } });
          this.persistSession(world, "field-researcher", entry);
          return publicError("LOCAL_TARGET_UNAVAILABLE", reason);
        }
        const recipients = peer ? localPeers.filter((m) => (m.personnel_id ?? m.id) === (peer.personnel_id ?? peer.id)) : localPeers;
        const eligible = recipients.length > 0;
        if (!eligible) {
          const reason = peer?.condition === "Unresponsive" ? "The teammate is unresponsive." : observed?.contact_category === "LOCAL" ? "The local conversation could not be delivered." : `No nearby participating personnel can hear this transmission.`;
          communicationRuntime.local(expedition, { sender: playerId, recipients: [peer?.personnel_id ?? peer?.id ?? "unconfirmed teammate"], text: message, eligible: false, failure_reason: reason });
          q4Interactions.record(expedition, { channel, speaker: "You", targets: [peer?.display_name ?? "no nearby teammate"], player_text: message, attempted_behavior: "speak with a nearby teammate", eligibility: "target-out-of-range", delivery: "not-delivered", presentation: { result: reason } });
          this.persistSession(world, "field-researcher", entry);
          return publicError("LOCAL_TARGET_UNAVAILABLE", reason);
        }
         const deliveredLocal = communicationRuntime.local(expedition, { sender: playerId, recipients: recipients.map((member) => member.personnel_id ?? member.id), text: message, eligible: true });
        phenomenonEcology.recordSpeech(world, entry.run, { speaker:playerId, text:message, location_id:entry.run.spatial.player_location });
        if (/\b(route|corridor|passage|location|map|survey|where)\b/i.test(message) && entry.run.survey_frontier) for (const recipient of recipients) surveyFrontier.share(entry.run.survey_frontier, recipient.personnel_id ?? recipient.id, playerId, { at: expedition.clock.interval });
        for (const recipient of recipients) {
          recipient.last_communication = { channel: "LOCAL", direction: "received", at: expedition.clock.interval, message_id: deliveredLocal.message.id };
          recipient.known_information ??= [];
          recipient.known_information.push({ kind: "reported-knowledge", text: message, source: "local-communication", sender: playerId, at: expedition.clock.interval, message_id: deliveredLocal.message.id });
        }
        const request = /\b(hand|pass|give|bring|transfer)\b/i.test(message);
        const requestedEquipment = request ? Object.values(expedition.equipment ?? {}).find((item) => [item.id, item.label, item.type].filter(Boolean).some((value) => message.toLowerCase().includes(String(value).toLowerCase()) || String(value).toLowerCase().split(/\s+/).some((term) => term.length > 4 && message.toLowerCase().includes(term)))) : null;
        const equipmentHolder = requestedEquipment ? expedition.team.members.find((member) => member.personnel_id === requestedEquipment.holder) : null;
        const responses = recipients.map((recipient) => { const recipientPerson = history.character(world, recipient.personnel_id ?? recipient.id); const reactionContext = personnelContinuity.reactionContext({ world, run: entry.run, phase: entry.phase?.phase_id, worker_id: recipient.personnel_id, player_id: playerId, event: { id: deliveredLocal.message.id, category: "local-communication", summary: `The teammate heard the player's statement: ${message}`, novelty_key: request ? "local-equipment-request" : `local-statement-${message.toLowerCase().slice(0, 80)}`, operational_importance: request ? 58 : 85, perceived_risk: 0, observed_by: [recipient.personnel_id], delivered_to: [recipient.personnel_id], participants: [playerId, recipient.personnel_id] } }); const reaction = personnelContinuity.react(world, reactionContext); const knownAnswer = personnelContinuity.presentKnownAnswer(entry.run, recipient.personnel_id, message); const response = request ? (requestedEquipment?.holder === recipient.personnel_id ? `${recipient.first_name}: I hear the request. The ${requestedEquipment.label.toLowerCase()} remains with me until we complete a physical handoff.` : requestedEquipment?.holder === playerId ? `${recipient.first_name}: You already hold the ${requestedEquipment.label.toLowerCase()}.` : equipmentHolder ? `${recipient.first_name}: ${equipmentHolder.first_name} has the ${requestedEquipment.label.toLowerCase()}; a physical handoff still has to happen in person.` : `${recipient.first_name}: I hear the request, but I cannot confirm that equipment in my custody.`) : knownAnswer ?? personnelContinuity.presentReaction(recipientPerson, reaction.reaction, message); return { recipient, person:recipientPerson, reaction_context:reactionContext, reaction:reaction.reaction, text:response }; });
        const addressed = peer ? responses.find((item) => item.recipient.personnel_id === peer.personnel_id) : null;
        const namedInMessage = recipients.find((m) => [m.first_name, m.last_name, m.display_name].filter(Boolean).some((n) => new RegExp(`\\b${String(n).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i").test(message)));
        const roleInMessage = recipients.find((m) => { const role = String(m.role ?? "").toLowerCase(); return role && role.split(/\s+/).some((w) => w.length > 3 && new RegExp(`\\b${w}\\b`, "i").test(message)); });
        const addressedRecipient = addressed ?? (namedInMessage ? responses.find((item) => item.recipient.personnel_id === (namedInMessage.personnel_id ?? namedInMessage.id)) : (roleInMessage ? responses.find((item) => item.recipient.personnel_id === (roleInMessage.personnel_id ?? roleInMessage.id)) : null));
        const equipmentRespondent = requestedEquipment && equipmentHolder ? responses.find((item) => item.recipient.personnel_id === equipmentHolder.personnel_id) : null;
        const chosen = addressedRecipient ?? equipmentRespondent ?? responses.find((item) => item.reaction && item.text) ?? responses[0];
        const response = chosen?.text || "";
        personnelContinuity.recordSharedHistory(world, { run_id: entry.run.run_id, participants: [playerId, ...recipients.map((recipient) => recipient.personnel_id ?? recipient.id)], kind: "local-communication", refs: { message_id: deliveredLocal.message.id, geography_shared: /\b(route|corridor|passage|location|map|survey|where)\b/i.test(message) }, at: expedition.clock.interval });
        const interactionTargets = recipients.map(recipient => recipient.display_name);
        const responseBody = response.replace(new RegExp(`^${String(chosen?.recipient?.first_name ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`, "i"), "");
        const interaction = q4Interactions.record(expedition, { channel, speaker: "You", targets: interactionTargets, player_text: message, attempted_behavior: "speak with nearby participating personnel", eligibility: "eligible", delivery: "heard", time_cost: 0, canonical_effects: ["communication.local.delivered"], response_speaker: chosen?.recipient?.first_name ?? chosen?.recipient?.display_name ?? null, presentation: { result: "heard", response:responseBody } });
        q4Trajectories.noteCommunication({ world, expedition, run_id: entry.run.run_id, channel: "local", delivered: true, text: message });
        const cycle = bootstrap.resolveOperationalCycle(entry.run, "LOCAL", 0, "local-communication");
        this.persistSession(world, "field-researcher", entry);
        const publicReason = response || "Your message is heard. No further response is required.";
        const scene = this.sceneFor(entry, "field-researcher", { scene_type: "delta", accepted: true, action: "LOCAL", public_reason: publicReason }, world);
        const output = { ok: true, result: { outcome: "delivered", public_reason: publicReason, message: { id: deliveredLocal.message.id, state: deliveredLocal.message.state }, mission_updates: cycle.mission_updates, scene }, projection: this.projectionFor(world, "field-researcher", entry) };
        const authorized = chosen?.reaction && chosen.text ? chosen : (responses.find((item) => item.reaction && item.text) ?? null);
        if (authorized) Object.defineProperty(output, "_local_dialogue_context", { configurable:true, enumerable:false, value:{ run:entry.run, player_text:message, speaker:authorized.recipient, person:authorized.person, reaction_context:authorized.reaction_context, reaction:authorized.reaction, fallback_text:authorized.text, interaction, world, entry } });
        return output;
      }
      const radio = expedition.equipment?.["survey-radio"];
      const radioCheckPhase = entry.phase?.phase_id === "STANDARD_RADIO_CHECK" && !q4Radio.ensure(expedition).check_completed;
      if (!["STANDARD_RADIO_CHECK", "FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id) || !q4Equipment.stateUsable(radio) || radio.holder !== playerId || radio.charges <= 0 || (!radioCheckPhase && !q4Radio.available(expedition))) {
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
      const purpose = radioCheckPhase ? "radio-check" : /\b(request|seek).{0,24}\b(authoriz|deviat)|\bdeviation request\b/i.test(message) ? "deviation-request" : /\b(emergency|injur|medical|help|missing|casualty|deceased)\b/i.test(message) ? "emergency-report" : /\b(assist|assistance)\b/i.test(message) ? "assistance-request" : /\b(return|coming back)\b/i.test(message) ? "return-request" : evidenceReport ? "evidence-report" : pendingCheckIn ? "scheduled-check-in" : "routine-report";
      const geographyReport = /\b(route|corridor|passage|location|map|survey)\b/i.test(message);
      const environmentConditionIds = /\b(power|light|lighting|relay|coverage|signal|blocked|debris|structural|route)\b/i.test(message) ? Object.values(entry.run.spatial?.environment?.conditions ?? {}).filter((condition) => condition.status === "unresolved").map((condition) => condition.id) : [];
      const queued = communicationRuntime.queueRadio(entry.run, bootstrap.dynamicsDefinitionFor(entry.run.spatial_pack_id), { sender: playerId, recipient: "Standard", text: message, purpose, geography_report: geographyReport, environment_condition_ids:environmentConditionIds, evidence_ids: evidenceReport ? (expedition.evidence ?? []).filter((item) => item.available_to_player !== false).map((item) => item.id) : [] });
      phenomenonEcology.recordSpeech(world, entry.run, { speaker:playerId, text:message, location_id:entry.run.spatial.player_location });
      if (pendingCheckIn && (purpose === "scheduled-check-in" || checkInReport)) queued.message.check_in_id = pendingCheckIn.id;
      const cycle = bootstrap.resolveOperationalCycle(entry.run, "COMMUNICATE", 1, "standard-radio");
      let acknowledgmentCycle = null;
      let resolvedMessage = expedition.messages.find((item) => item.id === queued.message.id);
      if (radioCheckPhase && resolvedMessage.state === "delivered") {
        acknowledgmentCycle = bootstrap.resolveOperationalCycle(entry.run, "RADIO_ACK", 1, "radio-check-acknowledgment");
        resolvedMessage = expedition.messages.find((item) => item.id === queued.message.id);
      }
      const actuallyDelivered = ["delivered", "acknowledged"].includes(resolvedMessage.state);
      if (radioCheckPhase && resolvedMessage.state === "acknowledged") {
        q4Radio.completeCheck(expedition);
        expeditionEvent(expedition, "q4.radio_check.completed", { endpoint: "Standard", source_message_id: resolvedMessage.id });
        history.event(world, entry.run.run_id, "q4.radio_check.completed", { endpoint: "Standard", status: "acknowledged", source_message_id: resolvedMessage.id });
      }
      if (actuallyDelivered) {
        standardOperator.recordContact(world, entry.run, resolvedMessage);
        if (/\b(entity|form|figure|voice|sound|discrepancy|structure|humanoid|unidentified)\b/i.test(message)) for (const observation of phenomenonEcology.projection(world,{observer:playerId,location_id:entry.run.spatial.player_location})) { const item=phenomenonEcology.resolveObservedTarget(world,{observer:playerId,location_id:entry.run.spatial.player_location,target:observation.designation}); if(item)phenomenonEcology.deliverReport(world,item.id,{observer:playerId,message_id:resolvedMessage.id,summary:message,include_alias:message.toLowerCase().includes(String(observation.alias??"").toLowerCase())&&Boolean(observation.alias),at:resolvedMessage.delivered_at??expedition.clock.interval}); }
      }
      const delivery = actuallyDelivered ? "delivered" : resolvedMessage.state === "delayed" ? "delayed" : "queued";
      const interaction = q4Interactions.record(expedition, { channel, speaker: "You", targets: ["Standard"], player_text: message, attempted_behavior: "transmit over the survey radio", eligibility: "eligible", delivery, time_cost: 1, canonical_effects: ["communication.sent"], observer_knowledge: actuallyDelivered ? [{ observer: "Standard", kind: "reported-communication", text: message }] : [], presentation: { result: delivery } });
      if (radioCheckPhase && resolvedMessage.state === "acknowledged") q4Interactions.record(expedition, { channel: "standard", speaker: "STANDARD", targets: ["Clear-Q4 team"], player_text: "Standard acknowledgment received for Radio check.", attempted_behavior: "scheduled radio-check acknowledgment", eligibility: "eligible", delivery: "received", canonical_effects: ["q4.radio.check.acknowledged"], presentation: { result: "received" } });
      if (!radioCheckPhase) q4Trajectories.noteCommunication({ world, expedition, run_id: entry.run.run_id, channel: "standard", delivered: actuallyDelivered, text: message });
      const missionUpdates = [...cycle.mission_updates, ...(acknowledgmentCycle?.mission_updates ?? [])];
      this.persistSession(world, "field-researcher", entry);
      const publicReason = resolvedMessage.state === "delayed" ? resolvedMessage.interference?.public_description ?? "The transmission is delayed; no delivery confirmation has been received." : actuallyDelivered ? "The transmission was delivered. Standard acknowledgment remains separately recorded." : "The transmission is queued; delivery has not been confirmed.";
      const scene = this.sceneFor(entry, "field-researcher", { scene_type: "delta", accepted: true, action: "STANDARD", public_reason: publicReason }, world);
      return { ok: true, result: { outcome: resolvedMessage.state, public_reason: publicReason, message: { id: resolvedMessage.id, state: resolvedMessage.state }, mission_updates: missionUpdates, operational_updates: cycle.public_updates, scene }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) { this.log(`Q4 communication failed: ${error.message}`); return publicError("COMMUNICATION_RUNTIME_ERROR", "The communication could not be resolved safely."); }
  }
  submitQ4Handoff({ world_id, item_id, target = null }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (outcomes.isRetired(this.getWorld(world_id))) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before handing over equipment.");
      const player = entry.run.session.startup.player.observer_id; const coworkers = entry.run.expedition.team.members.filter((member) => member.personnel_id !== player); const targetText = String(target ?? "").toLowerCase(); const key = entry.run.expedition.equipment[item_id] ? item_id : Object.entries(entry.run.expedition.equipment).find(([, item]) => item.id === item_id)?.[0]; const item = entry.run.expedition.equipment[key];
      if (["player", "you"].includes(targetText)) {
        if (entry.phase?.phase_id !== "STAGING") return publicError("HANDOFF_TARGET_UNAVAILABLE", "Coworker-to-player custody reassignment is available during accountable staging only.");
        const source = coworkers.find((member) => member.personnel_id === item?.holder); if (!source) return publicError("HANDOFF_SOURCE_UNAVAILABLE", "No assigned coworker holds that equipment for staging reassignment.");
        const transferred = logisticsRuntime.transact(entry.run.expedition, bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id), { action:"HAND_OVER", item_id:key, actor:source.personnel_id, target_holder:player }, this.q4LogisticsContext(entry, world));
        if (!transferred.ok) return publicError(transferred.code, transferred.public_reason);
        q4Interactions.record(entry.run.expedition, { channel:"action", speaker:"You", targets:[source.display_name], player_text:`accept custody of ${transferred.item.display_name} during staging`, attempted_behavior:"reassign staged equipment custody to the controlled worker", eligibility:"eligible", delivery:"transferred", time_cost:1, canonical_effects:["equipment.handoff"], presentation:{ result:"transferred" } });
        history.event(world, entry.run.run_id, "q4.equipment.handed_over", { equipment_id:transferred.item.instance_id, from:source.personnel_id, to:player }); personnelContinuity.recordCustody(world, { run_id:entry.run.run_id, equipment_id:transferred.item.instance_id, from:source.personnel_id, to:player, at:entry.run.expedition.clock?.interval ?? 0 }); if (entry.run.spatial) spatialRuntime.syncEquipment(entry.run.spatial, entry.run.expedition); const cycle = bootstrap.resolveOperationalCycle(entry.run, "HANDOFF", 1, "staging-equipment-handoff"); this.persistSession(world, "field-researcher", entry); return { ok:true, result:{ outcome:"succeeded", public_reason:`You take accountable custody of the ${transferred.item.display_name} from ${source.first_name}.`, time_advanced:cycle.clock.cost, mission_updates:cycle.mission_updates }, projection:this.projectionFor(world, "field-researcher", entry) };
      }
      const peer = coworkers.find((member) => [member.personnel_id, member.first_name, member.display_name].filter(Boolean).some((value) => String(value).toLowerCase() === targetText)) ?? coworkers[0]; const peerPerson = history.character(world, peer?.personnel_id ?? peer?.id); const observed = q4Personnel.observerStatus(peer, peerPerson, entry.phase?.phase_id, entry.run.spatial, player);
      const validTarget = observed.local_eligible && [peer?.personnel_id, peer?.first_name, peer?.display_name, "team", "teammate"].filter(Boolean).map((value) => String(value).toLowerCase()).includes(targetText || String(peer?.first_name ?? "").toLowerCase());
      if (!validTarget) return publicError("HANDOFF_TARGET_UNAVAILABLE", "That person is not available for a physical handoff here.");
      const transferred = logisticsRuntime.transact(entry.run.expedition, bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id), { action: "HAND_OVER", item_id: key, actor: player, target_holder: peer.personnel_id }, this.q4LogisticsContext(entry, world));
      if (!transferred.ok) return publicError(transferred.code, transferred.public_reason);
      q4Interactions.record(entry.run.expedition, { channel: "action", speaker: "You", targets: [peer.display_name], player_text: `hand over ${transferred.item.display_name}`, attempted_behavior: "physically hand equipment to a nearby teammate", eligibility: "eligible", delivery: "transferred", time_cost: 1, canonical_effects: ["equipment.handoff"], presentation: { result: "transferred" } });
      history.event(world, entry.run.run_id, "q4.equipment.handed_over", { equipment_id: transferred.item.instance_id, from: player, to: peer.personnel_id }); personnelContinuity.recordCustody(world, { run_id: entry.run.run_id, equipment_id: transferred.item.instance_id, from: player, to: peer.personnel_id, at: entry.run.expedition.clock?.interval ?? 0 }); personnelContinuity.recordSharedHistory(world, { run_id: entry.run.run_id, participants: [player, peer.personnel_id], kind: "equipment-transferred", refs: { equipment_id: transferred.item.instance_id }, at: entry.run.expedition.clock?.interval ?? 0 }); if (entry.run.spatial) spatialRuntime.syncEquipment(entry.run.spatial, entry.run.expedition); const cycle = bootstrap.resolveOperationalCycle(entry.run, "HANDOFF", 1, "equipment-handoff"); this.persistSession(world, "field-researcher", entry); return { ok: true, result: { outcome: "succeeded", public_reason: `${peer.first_name} takes the ${transferred.item.display_name}.`, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) { this.log(`Q4 handoff failed: ${error.message}`); return publicError("HANDOFF_RUNTIME_ERROR", "The physical handoff could not be resolved safely."); }
  }
  selectQ4OptionalStore({ world_id, item_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
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
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (this.recoveredWorlds.has(world_id)) return publicError("PERSISTENCE_RECOVERY_READ_ONLY", "This verified previous record is available for inspection only until it is explicitly restored.");
    try { const world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue a session first."); const verb = String(action ?? "").toUpperCase(); let result; if (entry.kind === "bootstrap") { entry.run._last_mission_updates = []; entry.run._active_submission_id = `player-submission-${crypto.createHash("sha256").update(JSON.stringify([entry.run.run_id, entry.run.expedition.interaction_history?.length ?? 0, verb, target ?? null])).digest("hex").slice(0, 18)}`; }
      if (entry.kind === "bootstrap" && verb === "ADVANCE_OPERATIONS") return this.advanceQ4Operations({ world_id });
      if (entry.kind === "bootstrap" && verb === "COMMUNICATE") return publicError("PLAYER_TRANSMISSION_REQUIRED", "Type and deliberately submit your own message in the communication composer.");
      if (entry.kind === "bootstrap" && ["DEPLOY", "READY", "PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION"].includes(verb)) {
        const phase = entry.phase?.phase_id;
        const radioChecked = q4Radio.ensure(entry.run.expedition).check_completed;
        const legacyFlow = entry.legacy_flow === true || entry.phase?.legacy_flow === true;
        const expected = legacyFlow
          ? { BRIEFING: "READY", STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "CROSS", STANDARD_RADIO_CHECK: radioChecked ? "BEGIN_FIELD_OPERATION" : "RADIO_CHECK" }[phase]
          : { BRIEFING: "READY", STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "READY", STANDARD_RADIO_CHECK: radioChecked ? "CROSS" : "RADIO_CHECK" }[phase];
        if (verb !== expected) return publicError("PHASE_GUARD_REJECTED", "That transition is not available from the current expedition phase.");
        if (verb === "RADIO_CHECK") {
          return publicError("PLAYER_TRANSMISSION_REQUIRED", "Type and deliberately submit the required radio check in the STANDARD composer. The application will not speak for you.");
        } else if (verb === "BEGIN_FIELD_OPERATION") {
          const advanced = q4.nextPhase(entry.phase, { action: verb, radio_check_completed: q4Radio.ensure(entry.run.expedition).check_completed });
          if (!advanced.ok) return publicError(advanced.code, "Standard has not authorized field departure.");
          entry.phase = advanced.phase; bootstrap.enterSpatialField(entry.run); q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id);
          result = { ok: true, outcome: "field-operation-entered", result: { public_reason: null, mission_updates: [...(entry.run._last_mission_updates ?? [])] } };
        } else if (verb === "DEPLOY") {
          const crossed = bootstrap.crossThreshold(entry.run);
          if (!crossed.ok) return publicError(crossed.error?.code ?? crossed.code ?? "DEPLOYMENT_REJECTED", crossed.error?.public_reason ?? crossed.reason ?? "Deployment could not be established from the current preparation state.");
          const advanced = q4.nextPhase(entry.phase, { action: verb, canonical_crossed: true, legacy_flow: false });
          if (!advanced.ok) return publicError(advanced.code, "The expedition cannot deploy from its current preparation state.");
          entry.phase = advanced.phase; q4Radio.authorize(entry.run.expedition); bootstrap.setSpatialPhase(entry.run, entry.phase.phase_id); q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id);
          result = { ok: true, outcome: "deployed-to-radio-readiness", result: { public_reason: "You deliberately deployed the accounted team to radio readiness." } };
        } else if (verb === "CROSS") {
          result = bootstrap.crossThreshold(entry.run, { require_radio_check: !legacyFlow });
          if (result.ok) {
            const advanced = q4.nextPhase(entry.phase, { action: verb, canonical_crossed: true, radio_check_completed: radioChecked, legacy_flow: legacyFlow });
            if (!advanced.ok) return publicError(advanced.code, "The expedition cannot cross from its current state.");
            entry.phase = advanced.phase;
            if (entry.phase.phase_id === "FIELD_OPERATION") {
              bootstrap.enterSpatialField(entry.run);
              result.result = { ...(result.result ?? {}), mission_updates:[...(entry.run._last_mission_updates ?? [])] };
            }
            else q4Radio.authorize(entry.run.expedition, "legacy-threshold-crossed");
            q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id);
          }
        } else {
          result = { ok: true, outcome: "phase-advanced" };
          if (verb === "PROCEED") { const readiness = q4Equipment.projection(entry.run.expedition, entry.run.session.startup.player.observer_id); if (!readiness.readiness) { entry.run.expedition.deviations.push("proceeded-with-required-equipment-unavailable"); expeditionEvent(entry.run.expedition, "q4.loadout.proceeded_without_required", { missing: readiness.missing }); } }
          const advanced = q4.nextPhase(entry.phase, { action: verb, legacy_flow: legacyFlow }); if (!advanced.ok) return publicError(advanced.code, "The expedition cannot advance from its current state."); entry.phase = advanced.phase; bootstrap.setSpatialPhase(entry.run, entry.phase.phase_id); if (entry.phase.phase_id === "STANDARD_RADIO_CHECK") q4Radio.authorize(entry.run.expedition); q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id);
        }
        if (verb !== "RADIO_CHECK" && result.ok) {
          if (entry.run.expedition?.mission_state) entry.run.expedition.mission_state.phase = entry.phase.phase_id;
          const authoredCost = verb === "DEPLOY" ? 1 : (bootstrap.dynamicsDefinitionFor(entry.run.spatial_pack_id).action_costs[verb] ?? 0);
          const cycle = bootstrap.resolveOperationalCycle(entry.run, verb, authoredCost, "phase-action");
          result.result = { ...(result.result ?? {}), time_advanced: cycle.clock.cost, mission_updates: [...(result.result?.mission_updates ?? []), ...cycle.mission_updates], operational_updates: cycle.public_updates };
        }
      } else if (entry.kind === "bootstrap") { result = bootstrap.act(entry.run, verb, target); }
      else if (entry.kind === "lost") { if (verb === "MOVE") result = lost.move(world, entry.run, target); else if (verb === "DROP") result = lost.drop(world, entry.run, target); else if (verb === "RETURN") result = lost.escape(world, entry.run); else if (verb === "STRAND") result = lost.strand(world, entry.run); else result = { ok: false, code: "ACTION_UNAVAILABLE" }; }
      else if (entry.kind === "nullzone") { if (verb === "EXPAND") result = nullzone.expand(world, entry.run_id); else if (verb === "DISCOVER") result = nullzone.discoverArtifact(world, entry.run_id); else if (verb === "RETURN") result = nullzone.returnBase(world, entry.run_id); else result = { ok: false, code: "ACTION_UNAVAILABLE" }; }
      else result = verb === "REVIEW_REPORT" ? { ok: true, result: desk.projection(world) } : verb === "ADVANCE" ? desk.advance(world, entry.run_id) : { ok: false, code: "ACTION_UNAVAILABLE" };
      if (!result.ok) return publicError(result.error?.code ?? result.code ?? "ACTION_REJECTED", result.error?.public_reason ?? result.result?.public_reason ?? result.public_reason ?? "That action is not available right now.");
      if (entry.kind === "bootstrap" && q4Radio.ensure(entry.run.expedition).check_completed && !q4Interactions.history(entry.run.expedition, "standard").some((item) => item.attempted_behavior === "scheduled radio-check acknowledgment")) {
        const acknowledged = entry.run.expedition.messages?.find((item) => item.purpose === "radio-check" && item.state === "acknowledged");
        if (acknowledged) q4Interactions.record(entry.run.expedition, { channel: "standard", speaker: "STANDARD", targets: ["Clear-Q4 team"], player_text: "Standard acknowledgment received for Radio check.", attempted_behavior: "scheduled radio-check acknowledgment", eligibility: "eligible", delivery: "received", canonical_effects: ["q4.radio.check.acknowledged"], presentation: { result: "received" } });
      }
      if (entry.kind === "bootstrap") {
        this.recordQ4Action(entry, `${verb}${target ? ` ${target}` : ""}`, result, world, entry.run._active_submission_id);
        this.finishQ4Action(world, entry, verb, result);
      }
      const missionUpdates = result.result?.mission_updates ?? entry.run?._last_mission_updates ?? [];
      const mortality = entry.kind === "bootstrap" ? outcomes.resolve(world, entry.run, { cause: result.result?.consequence_id ?? result.outcome ?? verb }) : null;
      if (mortality?.player_deceased) this.persistTerminalRetirement(world, mode, entry); else this.persistSession(world, mode, entry);
      const scene = this.sceneFor(entry, mode, { action: verb, scene_type: verb === "LOOK" ? "observation" : "delta", accepted: true, public_reason: result.result?.public_reason ?? result.public_reason }, world);
      return { ok: true, result: { outcome: result.outcome ?? "succeeded", public_reason: result.result?.public_reason ?? result.public_reason ?? null, mission_updates: missionUpdates, scene }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`action failed: ${error.message}`); return publicError("ACTION_RUNTIME_ERROR", "Yellow Beast could not complete that action safely."); }
  }
  naturalContext(world, mode, entry) {
    const projection = this.projectionFor(world, mode, entry); const actions = this.availableFor(world, mode, entry);
    const labels = [...new Set(actions.flatMap((action) => action.targets ?? []).map((target) => target.label).filter(Boolean))];
    const surface = projection.surface ?? {}; const location = surface.view?.location?.alias ?? surface.surroundings?.location?.alias ?? surface.base?.known_access_point ?? "the current setting";
    const doctrine = doctrineRuntime.context(); return { version: "yellow-beast-interpretation-context@v1", profile_title: projection.mode.label, scenario: projection.mode.description, lifecycle: "active", authority_contract: { doctrine: doctrine.source, doctrine_sha256: doctrine.sha256, doctrine_priority: doctrine.priority, order: ["canonical-world", "simulation", "institution", "observation", "presentation"], generation_role: "candidate-only" }, doctrine_runtime: doctrine, observer_location: location, visible_reference_labels: labels, known_resource_labels: surface.status?.carried ?? [], public_reason: null, grounding: { version: "yellow-beast-observer-grounding-context@v1", candidates: labels.map((label) => ({ ref: label, label, category: "entity", source: "visible", aliases: [label], attributes: [] })) } };
  }
  retryQ4Communication({ world_id, message_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      const prior = entry?.run?.expedition?.messages?.find((item) => item.id === message_id);
      if (!prior || prior.channel !== "FIELD_RADIO" || !["failed", "expired"].includes(prior.state)) return publicError("COMMUNICATION_RETRY_UNAVAILABLE", "That radio transmission is not in a retryable state.");
      return this.submitQ4Communication({ world_id, channel: "standard", text: prior.text });
    } catch { return publicError("COMMUNICATION_RETRY_UNAVAILABLE", "The radio transmission could not be retried safely."); }
  }
  cancelQ4Communication({ world_id, message_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null)); const message = entry?.run?.expedition?.messages?.find((item) => item.id === message_id);
      if (!message || !["queued", "transmitting", "delayed", "delivered"].includes(message.state)) return publicError("COMMUNICATION_CANCEL_UNAVAILABLE", "That radio transmission cannot be cancelled now.");
      communicationRuntime.transition(entry.run.expedition, message, "expired", "player cancelled the unresolved radio transmission"); q4Radio.transition(entry.run.expedition, "available", "player-cancelled-radio-recovery"); this.persistSession(world, "field-researcher", entry); return { ok: true, result: { outcome: "cancelled", message_id, recoverable: true }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch { return publicError("COMMUNICATION_CANCEL_UNAVAILABLE", "The radio transmission could not be cancelled safely."); }
  }
  q4InterpretationContext(world, entry) {
    const projection = this.projectionFor(world, "field-researcher", entry); const view = projection.q4; const actions = projection.available_actions;
    const targets = [...new Map(actions.flatMap((action) => action.targets ?? []).filter((item) => item.label).map((item) => [item.label, item])).values()];
    const local = (view.team ?? []).filter((person) => !person.controlled && person.local_eligible).map((person) => ({ name: person.display_name, role: person.role, observed_condition: person.condition, contact: "speaking-range" }));
    const lastKnown = (view.team ?? []).filter((person) => !person.controlled && !person.local_eligible).map((person) => ({ name: person.display_name, role: person.role, observed_condition: person.condition, contact: person.contact_state ?? "last-known" }));
    const recentActions = (view.channels?.action?.history ?? []).slice(-5).map((item) => ({ attempt: item.player_text ?? item.attempted_behavior, result: item.presentation?.result ?? item.result, at: item.at ?? null }));
    const doctrine = doctrineRuntime.context();
    return {
      version: "yellow-beast-interpretation-context@v2",
      authority_contract: { doctrine: doctrine.source, doctrine_sha256: doctrine.sha256, doctrine_priority: doctrine.priority, order: ["canonical-world", "simulation", "institution", "observation", "presentation"], generation_role: "candidate-only", prohibitions: ["no hidden-state inference", "no canonical invention", "no internal identity disclosure"] },
      doctrine_runtime: doctrine,
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
  finishQ4Action(world, entry, verb, result) {
        if (["RETURN", "ABORT"].includes(verb) && entry.run.expedition?.mission_state?.return?.requested && entry.phase?.phase_id !== "RETURN") {
          const returning = phases.transition(entry.phase, "RETURN", { reason: verb.toLowerCase(), guard: true });
          if (returning.ok) { entry.phase = returning.phase; bootstrap.evaluateMissionState(entry.run, "RETURN"); }
        }
        if (entry.run.lifecycle === "completed" && entry.run.expedition?.mission && !entry.run.expedition.institutional_closure_ingested) {
          this.prepareQ4Return(world, entry);
          if (referenceExpedition.isReference(entry.run.scenario) && !entry.run.expedition.written_report) {
            const reportPhase = phases.transition(entry.phase, "REPORT", { reason:"evidence-custody-complete", guard:true });
            if (reportPhase.ok) entry.phase = reportPhase.phase;
            result.result = { ...(result.result ?? {}), public_reason:"Returned evidence entered A-Sync custody. Submit your written account before institutional review." };
          } else this.finalizeQ4Closure(world, entry);
        }
  }
  commandBusy(worldId) {
    return this.naturalTurnInflight.has(worldId) && this.naturalCommandContext.getStore() !== worldId;
  }
  async submitNatural(input = {}) {
    const { world_id, mode, text } = input;
    this.traceNaturalTurn("input-received", { request_id:input.request_id, world_id, mode, input_length:typeof text === "string" ? text.length : null });
    if (typeof text !== "string" || !text.trim() || text.length > 4000) return publicError("ACTION_TEXT_INVALID", "Enter an instruction of 1 to 4,000 characters.");
    if (this.recoveredWorlds.has(world_id)) return publicError("PERSISTENCE_RECOVERY_READ_ONLY", "Restore the recovered operation record before submitting actions.");
    const requestId = input.request_id ?? `desktop-natural-${crypto.randomUUID()}`;
    if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 160) return publicError("REQUEST_ID_INVALID", "The action reference is invalid. Submit the action again.");
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify([world_id, mode, text])).digest("hex");
    const active = this.naturalTurnInflight.get(world_id);
    if (active) {
      if (active.id === requestId && active.fingerprint === fingerprint) return active.promise;
      return publicError(active.id === requestId ? "REQUEST_ID_REUSED" : "SESSION_BUSY", active.id === requestId ? "That action reference belongs to a different instruction." : "The previous action is still being resolved. Wait for its result before submitting another action.");
    }
    const promise = Promise.resolve().then(() => this.naturalCommandContext.run(world_id, () => this.submitNaturalInternal({ ...input, request_id:requestId, input_fingerprint:fingerprint })));
    this.naturalTurnInflight.set(world_id, { id:requestId, fingerprint, promise });
    try { return await promise; } finally { this.naturalTurnInflight.delete(world_id); }
  }
  async submitNaturalInternal({ world_id, mode, text, request_id, input_fingerprint }) {
    try {
      if (!this.authorityRegistry.healthy) return publicError("AUTHORITY_UNAVAILABLE", "Authoritative interpretation sources are unavailable. Continue with structured controls while the installation is repaired.");
      const world = this.getWorld(world_id);
      const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null));
      if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue this session first.");
      const recorded = entry.run?.expedition?.natural_action_receipts?.find(receipt => receipt.id === request_id);
      if (recorded) {
        if (recorded.input_fingerprint !== input_fingerprint) return publicError("REQUEST_ID_REUSED", "That action reference belongs to a different instruction.");
        return { ok:true, result:{ turn_status:"RESOLVED", executed:false, duplicate:true, summary:recorded.public_reason ?? "This action has already been recorded." }, projection:this.projectionFor(world, mode, entry) };
      }
      if (entry.kind === "bootstrap" && mode === "field-researcher" && entry.phase?.phase_id === "REPORT") return this.submitReferenceWrittenReport({ world_id, text });
      if (entry.kind === "bootstrap" && mode === "field-researcher" && ["BRIEFING", "STAGING", "FACILITY_TRANSIT", "THRESHOLD", "STANDARD_RADIO_CHECK"].includes(entry.phase?.phase_id)) {
        const phaseId = entry.phase.phase_id;
        const inputClass = interpretiveDirector.classifyInput(text, phaseId, entry.run);

        if (inputClass.classification === "ON_SCRIPT" && inputClass.targetAction) {
          const radioChecked = q4Radio.ensure(entry.run.expedition).check_completed;
          if (phaseId === "STANDARD_RADIO_CHECK" && inputClass.targetAction === "CROSS" && !radioChecked) {
            const warning = "Standard dispatch requires a completed radio check before Threshold crossing.";
            const scene = { ...this.sceneFor(entry, mode, { scene_type: "observation", accepted: false, public_reason: warning }, world), narration: warning, narration_source: "DETERMINISTIC" };
            return { ok: true, result: { turn_status: "CLARIFICATION_REQUIRED", clarification_required: true, clarification_question: warning, executed: false, summary: warning, scene }, projection: this.projectionFor(world, mode, entry) };
          }
          const actResult = this.submitAction({ world_id, mode, action: inputClass.targetAction });
          if (actResult.ok) {
            const playerLoc = canonicalLedger.getPlayerLocation(entry.run);
            let authored = null;
            if (entry.phase.phase_id === "FIELD_OPERATION") {
              authored = interpretiveDirector.findAuthoredBeat("threshold_crossed", { location: "threshold-side-entry" }, entry.run);
            } else {
              authored = interpretiveDirector.findAuthoredBeat("location_entered", { location: playerLoc, phase: entry.phase.phase_id }, entry.run)
                ?? interpretiveDirector.findAuthoredBeat("phase_entered", { location: playerLoc, phase: entry.phase.phase_id }, entry.run);
            }
            const narration = authored ? authored.text : (actResult.result?.public_reason ?? "The expedition advances to the next operational phase.");
            const scene = { ...this.sceneFor(entry, mode, { scene_type: "delta", accepted: true, public_reason: narration }, world), narration, narration_source: authored ? authored.source : "DETERMINISTIC" };
            this.persistSession(world, mode, entry);
            return {
              ok: true,
              result: {
                turn_status: "RESOLVED",
                classification: "ON_SCRIPT",
                clarification_required: false,
                clarification_question: null,
                executed: true,
                summary: narration,
                scene,
                source: authored ? authored.source : "DETERMINISTIC"
              },
              projection: this.projectionFor(world, mode, entry)
            };
          }
        }

        if (phaseId === "STANDARD_RADIO_CHECK" && /radio\s*check/i.test(text)) {
          const radioRes = this.submitQ4Communication({ world_id, channel: "standard", text });
          if (radioRes.ok) {
            const summary = "Standard acknowledgment received for Radio check.";
            const scene = { ...this.sceneFor(entry, mode, { scene_type: "observation", accepted: true, public_reason: summary }, world), narration: summary, narration_source: "DETERMINISTIC" };
            this.persistSession(world, mode, entry);
            return {
              ok: true,
              result: {
                turn_status: "RESOLVED",
                classification: "ON_SCRIPT",
                clarification_required: false,
                clarification_question: null,
                executed: true,
                summary,
                scene,
                source: "DETERMINISTIC"
              },
              projection: this.projectionFor(world, mode, entry)
            };
          }
        }

        if (inputClass.classification === "MINOR_DEVIATION" && inputClass.targetAction === "QUESTION_PROCEDURAL") {
          const playerLoc = canonicalLedger.getPlayerLocation(entry.run);
          const locDesc = canonLexicon.getLocationDescriptor(playerLoc);
          let answer;
          if (/assignment|order|mission/i.test(text)) {
            answer = "Mission: Clear-Q4 Preliminary Layout and Condition Survey. Primary procedure: Verify established route through Utility Room to Open Passage survey line.";
          } else {
            answer = `Current location: ${locDesc.display_name}. Institutional context: ${locDesc.institutional_context}. Destination: ${locDesc.known_destination ?? "KV31 Outpost"}.`;
          }
          interpretiveDirector.emitPresentationEvent(entry.run, {
            type: "interpretation",
            speaker: null,
            channel: "LOCAL",
            source: "DETERMINISTIC",
            text: answer,
            timestamp: Date.now()
          });
          const scene = { ...this.sceneFor(entry, mode, { scene_type: "observation", accepted: true, public_reason: answer }, world), narration: answer, narration_source: "DETERMINISTIC" };
          return {
            ok: true,
            result: {
              turn_status: "RESOLVED",
              classification: "MINOR_DEVIATION",
              clarification_required: false,
              clarification_question: null,
              executed: false,
              summary: answer,
              scene,
              source: "DETERMINISTIC"
            },
            projection: this.projectionFor(world, mode, entry)
          };
        }

        if (inputClass.classification === "MAJOR_DEVIATION" && inputClass.targetAction === "DEVIATION_COMMAND") {
          const members = entry.run.expedition.team.members.filter((m) => m.personnel_id !== entry.run.session.startup.player.observer_id);
          const addressed = members.find((m) => new RegExp(`\\b${m.first_name}\\b`, "i").test(text));
          if (addressed && /wait|hold|stay/i.test(text)) {
            canonicalLedger.setCoworkerTask(entry.run, addressed.personnel_id, {
              task: "hold",
              target: canonicalLedger.getPlayerLocation(entry.run),
              status: "holding"
            });
            const ack = interpretiveDirector.getCoworkerAcknowledgement(addressed.first_name, "ACKNOWLEDGE_WAIT");
            interpretiveDirector.emitPresentationEvent(entry.run, {
              type: "dialogue",
              speaker: addressed.first_name,
              channel: "LOCAL",
              source: "DETERMINISTIC",
              text: ack.text,
              timestamp: Date.now()
            });
            this.persistSession(world, mode, entry);
            const reply = `${addressed.first_name}: "${ack.text}"`;
            const scene = { ...this.sceneFor(entry, mode, { scene_type: "observation", accepted: true, public_reason: reply }, world), narration: reply, narration_source: "DETERMINISTIC" };
            return {
              ok: true,
              result: {
                turn_status: "RESOLVED",
                classification: "MAJOR_DEVIATION",
                clarification_required: false,
                clarification_question: null,
                executed: true,
                summary: reply,
                scene,
                source: "DETERMINISTIC"
              },
              projection: this.projectionFor(world, mode, entry)
            };
          }
          if (/don't want|do not want|refuse/i.test(text) && /camera|instrument|equipment|stores/i.test(text)) {
            const reply = "Clear-Q4 operational protocol requires all assigned documentation equipment to be accounted for during deployment. Equipment custody remains assigned.";
            const scene = { ...this.sceneFor(entry, mode, { scene_type: "observation", accepted: false, public_reason: reply }, world), narration: reply, narration_source: "DETERMINISTIC" };
            return {
              ok: true,
              result: {
                turn_status: "RESOLVED",
                classification: "MAJOR_DEVIATION",
                clarification_required: false,
                clarification_question: null,
                executed: false,
                summary: reply,
                scene,
                source: "DETERMINISTIC"
              },
              projection: this.projectionFor(world, mode, entry)
            };
          }
        }
      }
      if (entry.kind === "bootstrap" && referenceExpedition.isReference(entry.run.scenario) && ["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id) && entry.run.spatial) {
        const requestId = request_id;
        const selected = this.livingTurnProvider ?? this.providerPool.createAutoProvider({ requestId, route: "submitNatural/living-turn", requireHostedInterpretation:this.settings().provider !== "offline" });
        const interpreter = typeof selected.interpretLiving === "function"
          ? { name:selected.name, interpret:(request) => selected.interpretLiving(request) }
          : selected;
        const presentationProvider = typeof selected.presentLiving === "function"
          ? { name:selected.name, present:(request) => selected.presentLiving(request) }
          : selected;
        this.recordInterpretationProvenance({ request_id:requestId, route:"submitNatural/living-turn", event:"provider-selected", input:"player-supplied", provider:selected.name, model:selected.model ?? "deterministic", provider_invoked:false, response_classification:(selected.name === "openai" || selected.name === "auto") ? "not-yet-observed" : "deterministic", canonical_resolution:"ai-interpreter-boundary -> Custodian -> live-scene-projection", observer_projection:"live-scene-projection@v1" });
        const beforeRun = clone(entry.run); const beforeWorld = clone(world); const beforePhase = clone(entry.phase);
        const living = await executeLivingTurn({ run:entry.run, player_text:text, interpreter, presentation_provider:presentationProvider, request_id:requestId, onResolved:({ resolution, interpretation }) => {
          this.traceNaturalTurn("canonical-action-resolved", { request_id:requestId, outcome:resolution.outcome, interval:entry.run.expedition.clock.interval });
          const verb = interpretation.sink.payload.action ?? interpretation.sink.payload.player_attempt?.action;
          this.recordQ4Action(entry, text, resolution, world, requestId, verb);
          this.finishQ4Action(world, entry, verb, resolution);
          entry.run.expedition.natural_action_receipts ??= [];
          entry.run.expedition.natural_action_receipts.push({ id:requestId, input_fingerprint, interval:entry.run.expedition.clock.interval, action:verb, outcome:resolution.outcome, public_reason:resolution.result?.public_reason ?? "The action is recorded." });
          try {
            this.persistSession(world, mode, entry);
            this.traceNaturalTurn("canonical-commit", { request_id:requestId, interval:entry.run.expedition.clock.interval });
          }
          catch (error) {
            for (const key of Object.keys(world)) delete world[key]; Object.assign(world,beforeWorld);
            for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run,beforeRun); entry.run._world=world; entry.phase=beforePhase;
            throw Object.assign(new Error("The action could not be committed to its operation record."), { code:"PERSISTENCE_COMMIT_FAILED", cause:error });
          }
        } });
        const language_assistance = summarizeLanguageAssistance(selected, living);
        this.traceNaturalTurn("turn-result", { request_id:requestId, status:living.status, interpretation_code:living.interpretation?.code ?? null, canonical_mutation:living.canonical_mutation, trace:living.trace, language_assistance });
        if (living.status === "interpretation_failed") return { ok:false, error:{ code:"PROVIDER_UNAVAILABLE", message:language_assistance.message, provider_failure:true }, result:{ executed:false, language_assistance } };
        if (living.status === "clarification") {
          const options = living.interpretation.options ?? [];
          const question = living.interpretation.question + (options.length ? ` Available: ${options.join("; ")}.` : "");
          const scene = { ...this.sceneFor(entry, mode, { scene_type:"observation", accepted:false, public_reason:question }, world), narration:question, narration_source:"deterministic-clarification" };
          return { ok:true, result:{ turn_status:"CLARIFICATION_REQUIRED", clarification_required:true, clarification_question:question, executed:false, summary:question, scene, language_assistance, living_turn:{ version:living.version, status:living.status, trace:living.trace } }, projection:this.projectionFor(world, mode, entry) };
        }
        if (living.status !== "resolved") return publicError(living.resolution?.error?.code ?? "LIVING_TURN_REJECTED", living.resolution?.result?.public_reason ?? "The interpreted attempt is no longer available from the current scene.");
        const scene = { ...this.sceneFor(entry, mode, { scene_type:"delta", accepted:true, public_reason:living.resolution.public_reason }, world), narration:living.presentation.scene_description, narration_source:living.presentation.source };
        return { ok:true, result:{ turn_status:"RESOLVED", clarification_required:false, clarification_question:null, executed:true, summary:scene.narration, scene, language_assistance, living_turn:{ version:living.version, status:living.status, validation:living.validation, trace:living.trace } }, projection:this.projectionFor(world, mode, entry) };
      }
      if (entry.kind === "bootstrap" && ["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id) && entry.run.spatial) {
        const members = entry.run.expedition.team.members.filter((member) => member.personnel_id !== entry.run.session.startup.player.observer_id);
        const namesWorker = members.some((member) => [member.first_name, member.last_name, member.display_name, member.role].filter(Boolean).some((name) => new RegExp(`\\b${String(name).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i").test(text)));
        const localPhrase = /\b(stay|hold|watch|wait|regroup|report|assist|help|give|carry|pass|transfer|did you hear)\b/i.test(text) || (/\btake\b/i.test(text) && !/\b(photo|photograph|picture)\b/i.test(text));
        if (namesWorker && localPhrase) return this.submitQ4LocalIntent({ world_id, text });
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
      const providerSetting = this.settings().provider ?? "offline";
      const isManual = providerSetting !== "auto" && providerSetting !== "offline";
      const key = isManual ? this.credentials.get(providerSetting) : null;
      if (isManual && !key) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Language assistance needs an access key. Your world is safe; you can continue offline.");
      const nonBootstrap = entry.kind !== "bootstrap"; const adapterRun = nonBootstrap ? { session: { startup: { player: { observer_id: mode } } }, profile_id: mode } : entry.run; const available = this.availableFor(world, mode, entry);
      const phaseBefore = entry.phase?.phase_id; const interpretationContext = nonBootstrap ? this.naturalContext(world, mode, entry) : this.q4InterpretationContext(world, entry); const requestId = `desktop-natural-${world_id}-${Date.now()}`;
      const provider = providerSetting === "offline" ? createMockProvider() : this.providerPool.createAutoProvider({ requestId, route: "submitNatural" });
      const contextHash = crypto.createHash("sha256").update(JSON.stringify(interpretationContext)).digest("hex");
      this.recordInterpretationProvenance({ request_id: requestId, route: "submitNatural", event:"provider-selected", input: "player-supplied", provider: provider.name, model: provider.model ?? "deterministic", provider_invoked:false, response_classification:providerSetting === "offline" ? "deterministic" : "not-yet-observed", doctrine: interpretationContext.authority_contract?.doctrine_sha256 ?? null, context_sha256: contextHash, context_sections: Object.keys(interpretationContext), canonical_resolution: "executePlayerTurn -> consequenceResolver", observer_projection: nonBootstrap ? "naturalContext" : "q4InterpretationContext" });
      const turn = await executePlayerTurn({ run: adapterRun, mode, provider, player_text: text, request_id: requestId, context: interpretationContext, consequenceResolver: entry.kind === "bootstrap" ? ({ plan }) => this.resolveQ4Attempt({ world_id, mode, entry, plan }) : ({ plan }) => resolveModeAttempt({ service: this, world_id, mode, plan, available }), sceneBuilder: entry.kind === "bootstrap" ? ({ natural: resolved }) => this.sceneFor(entry, mode, { scene_type: resolved.consequence?.result?.accepted ? "delta" : "observation", accepted: resolved.consequence?.result?.accepted, public_reason: resolved.consequence?.result?.observer_safe_summary }, world) : ({ natural: resolved }) => this.modeScene(world, mode, entry, resolved) });
      if (entry.kind === "bootstrap" && turn.save_required && phaseBefore === entry.phase?.phase_id) this.recordQ4Action(entry, text, { ok: true, result: { time_advanced: turn.consequence?.result?.time_advanced ?? 0, canonical_event_ids: turn.consequence?.result?.canonical_event_ids ?? [] } }, world);
      if (turn.save_required) this.persistSession(world, mode, entry);
      const scene = { ...turn.scene, narration: turn.narration.prose, narration_source: turn.narration.source };
      const hostedFailure = providerSetting !== "offline" && this.interpretationProvenance.some((record) => record.request_id === requestId && record.invocation_status === "failed");
      return { ok: true, result: { turn_status: turn.status, interpretation_error:turn.status === "INTERPRETATION_ERROR", provider_unavailable:hostedFailure, clarification_required: turn.status === "CLARIFICATION_REQUIRED", clarification_question: turn.clarification?.question ?? null, executed: turn.save_required, summary: scene.narration, scene }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`natural action failed: ${error.message}`); return error.code === "PERSISTENCE_COMMIT_FAILED" ? publicError(error.code, "The action could not be saved and was not committed. Check the operation record storage before retrying.") : publicError("PROVIDER_UNAVAILABLE", "Language assistance is unavailable. Continue using structured controls or retry this action reference."); }
  }
  shutdown() { for (const [key, entry] of this.sessions) { const [worldId, mode] = key.split(":"); if (this.recoveredWorlds.has(worldId)) continue; try { this.persistSession(this.getWorld(worldId), mode, entry); } catch (error) { this.log(`shutdown save failed: ${error.message}`); } } return { ok: true }; }
}

module.exports = { DesktopService, MODES, DEFAULT_SETTINGS };
