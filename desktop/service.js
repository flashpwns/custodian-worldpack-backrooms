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
const { LOCAL_PROVIDER_SPEC } = require("../tools/ai-local-model-provider");
const { ManagedInferenceAppliance } = require("../tools/managed-inference-appliance");
const { createDialogueRuntimeSupervisor } = require("../tools/dialogue-runtime-supervisor");
const { buildLocalDialoguePacket, buildObservationReportPacket, validateLocalDialogue } = require("../tools/ai-local-dialogue");
const { interpretUtterance: interpretDialogueUtterance, inferLocalRecipientType, resolveResponseOwners, stripNamedAddress, parseNamedAddress } = require("../tools/dialogue-interpretation");
const dialogueDiscourse = require("../tools/dialogue-discourse");
const dialogueFallback = require("../tools/dialogue-fallback");
const observerContextCompiler = require("../tools/observer-context-compiler");
const referenceExpedition = require("../tools/reference-expedition");
const cq4Day1Opener = require("../tools/cq4-day1-opener");
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
const presentationBus = require("../tools/presentation-bus");
const acousticDirector = require("../tools/acoustic-director");
const decisionScheduler = require("../tools/decision-scheduler");
const speechScheduler = require("../tools/speech-scheduler");
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
const { applicationTrack } = require("./menu-music");
const q4BetaReport = require("../tools/q4-beta-report");
const worldpackRegistry = require("../data/worldpacks/registry.json");
const doctrineRuntime = require("../tools/doctrine-runtime");
const { createRegistry: createAuthorityRegistry } = require("../tools/authority-registry");
const SAVE_SCHEMA_VERSION = "yellow-beast-session@7";
const PERSISTENCE_PAIR_VERSION = "yellow-beast-persistence-pair@v1";

const clone = (value) => structuredClone(value);
const currentClearQ4 = (payload) => payload?.version === "yellow-beast-save@v10" && (payload.lifecycle ?? "active") === "active" && payload.spatial_pack_id === "clear-q4";
const hasCurrentEnvironment = (payload) => payload?.spatial?.environment?.version === environment.VERSION;
const hasCurrentStandardOperator = (world) => world?.q4_standard_operator?.version === standardOperator.VERSION;
const MODES = Object.freeze(worldpackRegistry.programs.map((program) => Object.freeze({ ...program, label: program.program_name, playable: program.availability === "available" })));
const DEFAULT_SETTINGS = Object.freeze({ version: 8, input_mode: "natural", provider: "local", local_endpoint:LOCAL_PROVIDER_SPEC.defaultEndpoint, local_model:LOCAL_PROVIDER_SPEC.defaultModel, theme: "system", text_scale:"default", reduced_motion: false, reduced_sensory: false, audio_muted: false, audio_master: 0.35, audio_sfx: 0.35, audio_music: 0.25, audio_interface: 0.35, audio_radio: 0.35, audio_ambient: 0.25, guided_introductions: false, reopen_last_world: true, mode_onboarding: {}, visual_rendering: true, visual_adapter: "fallback", visual_quality: "documentary", automatic_evidence_rendering: true, retry_failed_renders: true, media_effect_intensity: "restrained", comfyui_endpoint: "http://127.0.0.1:8188", comfyui_workflow: "observer-safe-q4-evidence" });
// Non-Q4 language is deliberately a small phrase-to-existing-control adapter.
// It cannot invent a target or capability: recognised phrases only select an
// action already available in the active, observer-safe session.
function publicError(code, message) { return { ok: false, error: { code, message } }; }
// Bounded concurrency for wording already-authorized same-turn replies (see presentHostedLocalDialogue).
// 1 = serial. Chosen from measurement on the pinned runtime, not assumed.
const DIALOGUE_WORDING_CONCURRENCY = 1;
// Consecutive runtime restarts that end without a ready runtime before automatic recovery stops.
const MAX_UNRECOVERED_DIALOGUE_RESTARTS = 3;
/** Runs thunks with at most `limit` in flight; results keep the thunks' order. */
async function boundedAll(thunks, limit) {
  const results = new Array(thunks.length);
  let next = 0;
  const worker = async () => { while (next < thunks.length) { const i = next++; results[i] = await thunks[i](); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, thunks.length)) }, worker));
  return results;
}
// Canonical event anchors a temporal reference in dialogue may resolve against ("after the briefing",
// "before we crossed"). Only recorded events count; a missing anchor leaves the reference unresolved.
function dialogueTemporalAnchors(run) {
  const anchors = {};
  const briefing = run?.expedition?.day1_opener?.one_shot_events?.maxwell_opening_briefing;
  if (briefing?.consumed && Number.isFinite(Number(briefing.at_interval))) anchors.briefing = { interval: Number(briefing.at_interval), source: "day1_opener.one_shot_events.maxwell_opening_briefing" };
  const crossing = (run?.expedition?.facility_operations?.events ?? []).find((event) => event?.type === "THRESHOLD_CROSSING" && Number.isFinite(Number(event.at?.interval)));
  if (crossing) anchors.crossing = { interval: Number(crossing.at.interval), source: `facility_operations.${crossing.id}` };
  return anchors;
}
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
  constructor({ appDataPath = null, paths = null, logger = null, credentials = null, evidenceMediaProviders = {}, livingTurnProvider = null, localDialogueProvider = null, defaultQ4Scenario = "procedural-survey", developerMode = process.env.YELLOW_BEAST_DEVELOPER_MODE === "1", nowFn = null, notifyProjectionChanged = null, dialogueWordingConcurrency = DIALOGUE_WORDING_CONCURRENCY } = {}) {
    this.dialogueWordingConcurrency = Number.isInteger(dialogueWordingConcurrency) && dialogueWordingConcurrency > 0 ? dialogueWordingConcurrency : 1;
    // Pass 9C-2: the only main->renderer push in the app. Electron's IPC here
    // is otherwise invoke/response only (see preload.js), so an autonomous
    // report committed after a request has already returned would otherwise
    // sit unseen until some unrelated future request re-reads projection.
    // Narrow by design: carries only a world_id, never dialogue content --
    // the renderer re-reads through its existing getGameplayProjection path.
    this.notifyProjectionChanged = typeof notifyProjectionChanged === "function" ? notifyProjectionChanged : () => {};
    this.paths = paths ?? (appDataPath ? { root: appDataPath, worlds: path.join(appDataPath, "worlds"), saves: path.join(appDataPath, "saves"), logs: path.join(appDataPath, "logs"), media: path.join(appDataPath, "media"), config: path.join(appDataPath, "config.json") } : resolveAppPaths());
    this.now = typeof nowFn === "function" ? nowFn : () => Date.now();
    this.checkInHolds = new Map();
    this.paths.media ??= path.join(this.paths.root, "media");
    this.paths.exports ??= path.join(this.paths.root, "exports");
    this.metadataFile = path.join(this.paths.root, "desktop-worlds.json");
    this.settingsFile = path.join(this.paths.root, "desktop-settings.json");
    this.logger = logger ?? (() => {});
    this.credentials = credentials ?? new CredentialStore();
    this.developerMode = developerMode === true;
    this.sessions = new Map();
    this.naturalTurnInflight = new Map();
    this.communicationTurnInflight = new Map();
    this.naturalCommandContext = new AsyncLocalStorage();
    this.transactionContext = this.naturalCommandContext;
    this.recovery = new Map();
    this.recoveredWorlds = new Map();
    [this.paths.root, this.paths.worlds, this.paths.saves, this.paths.logs, this.paths.media, this.paths.exports].forEach(ensureDirectory);
    this.evidenceMedia = new evidenceMedia.EvidenceMediaRenderer({ media_root:this.paths.media, providers:evidenceMediaProviders });
    this.evidenceRenderInflight = new Map();
    this.interpretationProvenance = [];
    this.dialogueWordsmithTraces = [];
    this.authorityRegistry = createAuthorityRegistry();
    this.livingTurnProvider = livingTurnProvider;
    this.localDialogueProvider = localDialogueProvider;
    this.dialogueRestartFailures = 0;
    this.dialogueRestartBackoffMs = 2000;
    this.defaultQ4Scenario = cq4Day1Opener.isOpener(defaultQ4Scenario)
      ? "day1-opener"
      : (defaultQ4Scenario === "reference-expedition" ? "reference-expedition" : "procedural-survey");
    this.inferenceAppliance = new ManagedInferenceAppliance({
      appDataPath: this.paths.root,
      developerMode: this.developerMode,
      logger: (msg) => this.log(`[InferenceAppliance] ${msg}`),
      // A runtime that dies mid-session is respawned immediately (same single-flight path as a
      // supervisor-requested restart); dialogue meanwhile uses the same-plan deterministic fallback.
      onUnexpectedExit: () => this.requestDialogueRuntimeRestart()
    });
    this.providerPool = new ProviderPool({
      credentials: this.credentials,
      settingsGetter: () => this.settings(),
      applianceGetter: () => this.inferenceAppliance,
      onInvocation: (event) => this.recordProviderInvocation(event),
      onProvenance: (summary) => this.recordAttemptChain(summary)
    });
    // Non-blocking: the endpoint changes on every daemon respawn, so it is
    // read fresh from the appliance on every supervisor inspection/warmup
    // rather than captured once here. Does not call .start() -- this
    // constructor runs on every test/app start and must stay side-effect
    // light; callers kick off warmup explicitly via startDialogueRuntime().
    this.dialogueRuntime = createDialogueRuntimeSupervisor({
      endpointFn: () => this.inferenceAppliance.getStatus().endpoint,
      model: LOCAL_PROVIDER_SPEC.defaultModel,
      // DEGRADED/FAILED only ever *ask* for a respawn; process ownership
      // (spawn/kill) stays entirely inside the appliance. respawn() is the
      // appliance's own "stop, re-check integrity, restart daemon" entry point
      // (a full repair() whenever the installed model's record has drifted).
      onRestartRequested: () => this.requestDialogueRuntimeRestart()
    });
  }

  // One restart at a time; when the appliance has respawned the runtime the supervisor re-checks it, so
  // a runtime that died mid-session returns to model wording without restarting the application.
  // A DEGRADED supervisor over a daemon that still answers its health check is a request-level failure:
  // the daemon is kept (respawning it would only restart the outage) and only re-checked. Once the
  // supervisor confirms readiness, the pool's local cooldown -- earned against the previous daemon or
  // port -- is cleared so the next turn is worded by the model again.
  // A runtime that cannot come back (a broken install) is retried a bounded number of times with backoff,
  // then left to the deterministic fallback instead of re-verifying the model forever.
  requestDialogueRuntimeRestart({ state: supervisorState = null } = {}) {
    try {
      const state = this.inferenceAppliance?.state;
      if ((state === "READY" || state === "REPAIR_REQUIRED") && !this.dialogueRepairInFlight && !this.shuttingDown && this.dialogueRestartFailures < MAX_UNRECOVERED_DIALOGUE_RESTARTS) {
        this.dialogueRepairInFlight = (async () => {
          const healthy = state === "READY" && supervisorState !== "failed" && (await this.inferenceAppliance.healthcheck().catch(() => null))?.ok === true;
          if (!healthy && !this.shuttingDown) await this.inferenceAppliance.respawn().catch(() => null);
          let status = null;
          try { status = await this.dialogueRuntime?.retry(); } catch {}
          return status;
        })().then((status) => {
          this.dialogueRepairInFlight = null;
          if (status?.ready) {
            this.dialogueRestartFailures = 0;
            this.providerPool?.resetHealth("local");
            return;
          }
          this.dialogueRestartFailures += 1;
          if (this.dialogueRestartFailures < MAX_UNRECOVERED_DIALOGUE_RESTARTS && !this.shuttingDown) {
            const timer = setTimeout(() => this.requestDialogueRuntimeRestart({ state: "failed" }), this.dialogueRestartBackoffMs * this.dialogueRestartFailures);
            timer.unref?.();
          }
        });
      }
    } catch {}
  }

  // Kicks off dialogue runtime warmup without blocking startup. Intended to
  // be called once from main.js after the window/service are constructed so
  // warmup overlaps the title/cinematic sequence instead of gating it.
  startDialogueRuntime() {
    // The player never manages the runtime: when the application ships (or the dev tree holds) the pinned
    // runtime and model, a fresh profile installs them silently before the supervisor warms the daemon.
    const ready = (async () => {
      try {
        const appliance = this.inferenceAppliance;
        if (appliance?.state === "NOT_INSTALLED" && appliance.hasBundledAssets()) await appliance.install();
      } catch (error) { this.log(`local dialogue runtime install failed: ${error.message}`); }
      try { await this.dialogueRuntime?.start(); } catch {}
    })();
    ready.catch(() => {});
    return ready;
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
  settings() {
    const stored = readJson(this.settingsFile, DEFAULT_SETTINGS);
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    // Settings schema v8: local_endpoint/local_model no longer control the
    // production local runtime (the managed inference appliance owns the
    // real endpoint/model). Discard any pre-v8 stored override so an old
    // save cannot silently point at a stale manual address.
    if ((stored.version ?? 0) < 8) {
      merged.local_endpoint = DEFAULT_SETTINGS.local_endpoint;
      merged.local_model = DEFAULT_SETTINGS.local_model;
    }
    merged.version = DEFAULT_SETTINGS.version;
    return merged;
  }
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
  worldInfo(world, metadata = {}) {
    const identity = world.q4_operations?.controlled_player;
    const person = identity ? history.character(world, identity) : null;
    const isFiled = Boolean(person && world.q4_operations?.personnel_confirmation?.completed);
    const personnelName = isFiled ? (person.display_name || [person.first_name, person.last_name].filter(Boolean).join(" ")) : null;
    const name = personnelName || metadata.name || world.world_id;
    return { id: world.world_id, name, has_filed_personnel: isFiled, version: world.version, created_at: metadata.created_at ?? null, last_played_at: metadata.last_played_at ?? null, last_mode: metadata.last_mode ?? null, status: outcomes.isRetired(world) ? "retired" : "ready" };
  }

  getAppInfo() { const data = this.metadata(); const build = buildInfo.read(); return { ok: true, app: { name: "Yellow Beast", version: packageVersion, alpha: true, build, menu_music: applicationTrack, first_run_complete: Boolean(data.first_run_complete), data_path: this.paths.root, developer_mode:this.developerMode } }; }
  getInterpretationProvenance({ limit = 20 } = {}) { if (!this.developerMode) return publicError("DEVELOPER_DISABLED", "Developer tooling is disabled."); return { ok: true, records: clone(this.interpretationProvenance.slice(-Math.max(1, Math.min(100, Number(limit) || 20)))) }; }
  recordInterpretationProvenance(record) { const offline = record.provider === "deterministic-mock" || record.provider === "deterministic-living-provider"; this.interpretationProvenance.push({ ...record, execution_mode: offline ? "offline" : (record.provider ?? "unknown"), provider_invoked: record.provider_invoked === true, response_classification: record.response_classification ?? (offline ? "deterministic" : "not-yet-observed"), authority_registry: this.authorityRegistry?.version ?? null, authority_context_order: ["simulation-doctrine", "worldpack-and-domain-authority", "canonical-current-state", "observer-safe-projection", "persisted-history", "player-submission", "response-contract"], authority_sources: this.authorityRegistry?.sourceMetadata?.() ?? [], recorded_at: new Date().toISOString() }); if (this.interpretationProvenance.length > 100) this.interpretationProvenance.shift(); }
  recordDialogueWordsmithTrace(record) { if (!this.developerMode) return; this.dialogueWordsmithTraces.push(redactDiagnostic(record)); if (this.dialogueWordsmithTraces.length > 50) this.dialogueWordsmithTraces.shift(); }
  getDialogueWordsmithTrace({ limit = 20 } = {}) { if (!this.developerMode) return publicError("DEVELOPER_DISABLED", "Developer tooling is disabled."); return { ok:true, developer_only:true, traces:clone(this.dialogueWordsmithTraces.slice(-Math.max(1, Math.min(50, Number(limit) || 20)))) }; }
  recordProviderInvocation({ request_id, route, ...event }) {
    this.recordInterpretationProvenance({ request_id, route, event:"provider-invocation", ...event, provider_invoked:true, invocation_status:event.status, response_classification:event.status === "completed" ? "model-response-parsed" : event.status === "failed" ? "provider-failure" : "provider-request-started" });
    this.traceNaturalTurn("provider-invocation", { request_id, route, ...event });
  }
  traceNaturalTurn(stage, detail = {}) {
    if (process.env.YELLOW_BEAST_TURN_TRACE !== "1") return;
    // Callers supply bounded metadata only: never credentials, raw prompts, or saves.
    try { this.log(JSON.stringify({ diagnostic:"natural-turn", stage, ...detail })); } catch {}
  }
  getDeveloperSnapshot({ world_id, mode = null } = {}) { if (!this.developerMode) return publicError("DEVELOPER_DISABLED", "Developer tooling is disabled."); try { const world = this.getWorld(world_id); const entry = mode ? (this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null))) : null; const provider = this.getProviderStatus().provider; const run = entry?.kind === "bootstrap" ? entry.run : null; const simulationTruth = run ? { developer_only: true, authoritative_clock: structuredClone(run.expedition.clock), event_queue: structuredClone(run.expedition.operational?.events ?? []), mission_state: structuredClone(run.expedition.mission_state), teammate_locations: structuredClone(run.spatial?.personnel_locations ?? {}), teammate_decisions: structuredClone(run.expedition.team_runtime?.decision_history ?? run.expedition.operational?.decision_history ?? []), hazard_state: structuredClone(run.expedition.hazards ?? {}), phenomenon_state:phenomenonEcology.diagnostics(world,{developer:true}), item_custody: structuredClone(run.expedition.logistics?.items ?? {}), container_contents: structuredClone(run.expedition.logistics?.containers ?? {}), institutional_knowledge: structuredClone(world.institutional_response?.confirmed_knowledge ?? []), standard_response_queue: structuredClone(world.institutional_response?.pending_decisions ?? []), observer_safe_projection: q4.presentation(run, entry.phase, null, world) } : null; return { ok:true, snapshot:developerInspection.snapshot(world), active:{ mode, phase:entry?.phase ?? null, session_kind:entry?.kind ?? null, simulation_truth:simulationTruth }, provider:{ selected:provider.selected, offline:provider.offline, configured:provider.openai.configured, status:provider.offline ? "offline" : provider.openai.status }, doctrine: doctrineRuntime.read(), interpretation_provenance: clone(this.interpretationProvenance), dialogue_wordsmith_trace:clone(this.dialogueWordsmithTraces), provider_safe_context:run ? developerInspection.providerSafeContext(run) : null, recent_history:developerInspection.recentHistory(world) }; } catch { return publicError("DEVELOPER_SNAPSHOT_UNAVAILABLE", "The selected world could not be inspected."); } }
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
      const world = history.createWorld({ seed: actualSeed });
      cq4Day1Opener.ensureWorldOutpostGeography(world);
      const starterPersonnel = q4Personnel.initializeStarterPersonnel(world, { seed: actualSeed, staffing_rules: cq4Day1Opener.staffingRules() });
      if (!starterPersonnel.ok) throw Object.assign(new Error("starter personnel unavailable"), { code: starterPersonnel.code });
      const data = this.metadata();
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
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation."); try { const world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); const identity = world.q4_operations?.controlled_player; const person = identity ? history.character(world, identity) : null; if (!person) return publicError("PERSONNEL_CREATION_REQUIRED", "Create your ASYNC personnel record before confirming it."); world.q4_operations.personnel_confirmation = { completed: true, personnel_id: identity, confirmed_at: world.q4_operations.personnel_confirmation?.confirmed_at ?? new Date().toISOString() }; this.saveCanonical(world); const data = this.metadata(); if (data.worlds[world_id]) { const displayName = person.display_name || [person.first_name, person.last_name].filter(Boolean).join(" "); if (displayName) { data.worlds[world_id].name = displayName; this.writeMetadata(data); } } return { ok: true, player: q4Personnel.safePerson(person) }; } catch { return publicError("PERSONNEL_CONFIRMATION_FAILED", "The personnel record could not be confirmed safely."); } }
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
  updateSettings({ settings }) {
    if (!settings || typeof settings !== "object") return publicError("SETTINGS_INVALID", "Settings were not understood.");
    const next = { ...this.settings() };
    if (settings.input_mode && !["structured", "natural"].includes(settings.input_mode)) return publicError("SETTINGS_INVALID", "Choose a supported input mode.");
    if (settings.provider && !["auto", "offline", "local", "openai", "groq", "gemini", "openrouter"].includes(settings.provider)) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Choose a supported language provider.");
    if (settings.provider && !["auto", "offline", "local"].includes(settings.provider) && settings.provider !== next.provider && !this.credentials.configured(settings.provider)) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Add an access key first, or continue offline.");
    if (settings.theme && !["system", "light", "dark", "high-contrast"].includes(settings.theme)) return publicError("SETTINGS_INVALID", "Choose a supported appearance.");
    if (settings.text_scale && !["small", "default", "large", "extra-large"].includes(settings.text_scale)) return publicError("SETTINGS_INVALID", "Choose a supported text size.");
    if (settings.reduced_motion !== undefined && typeof settings.reduced_motion !== "boolean") return publicError("SETTINGS_INVALID", "Reduced motion must be on or off.");
    if (settings.reduced_sensory !== undefined && typeof settings.reduced_sensory !== "boolean") return publicError("SETTINGS_INVALID", "Reduced sensory must be on or off.");
    if (settings.audio_muted !== undefined && typeof settings.audio_muted !== "boolean") return publicError("SETTINGS_INVALID", "Audio mute must be on or off.");
    for (const key of ["audio_master", "audio_sfx", "audio_music", "audio_interface", "audio_radio", "audio_ambient"]) if (settings[key] !== undefined && (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 1)) return publicError("SETTINGS_INVALID", `${key} must be between 0 and 1.`);
    if (settings.guided_introductions !== undefined && typeof settings.guided_introductions !== "boolean") return publicError("SETTINGS_INVALID", "Guided introductions must be on or off.");
    if (settings.visual_adapter && !["fallback", "comfyui", "hosted"].includes(settings.visual_adapter)) return publicError("SETTINGS_INVALID", "Choose a supported visual renderer.");
    if (settings.visual_quality && !["documentary", "detailed"].includes(settings.visual_quality)) return publicError("SETTINGS_INVALID", "Choose a supported visual quality.");
    if (settings.media_effect_intensity && !["restrained", "reduced"].includes(settings.media_effect_intensity)) return publicError("SETTINGS_INVALID", "Choose a supported media effect intensity.");
    for (const key of ["visual_rendering", "automatic_evidence_rendering", "retry_failed_renders"]) if (settings[key] !== undefined && typeof settings[key] !== "boolean") return publicError("SETTINGS_INVALID", `${key} must be on or off.`);
    for (const id of Object.keys(PROVIDER_SPECS)) {
      const key = `${id}_model`;
      if (Object.hasOwn(settings, key)) {
        if (typeof settings[key] !== "string" || !settings[key].trim() || settings[key].length > 120) return publicError("MODEL_INVALID", "Enter a model name up to 120 characters.");
        if (settings[key] !== next[key]) this.providerPool.resetHealth(id);
      }
    }
    // local_endpoint / local_model no longer control the production local
    // runtime -- the managed inference appliance owns the real endpoint and
    // model. Accept and silently ignore these keys (older clients/saved
    // settings may still send them) rather than validating or persisting
    // them.
    delete settings.local_endpoint;
    delete settings.local_model;
    Object.assign(next, settings);
    delete next.api_key;
    writeJson(this.settingsFile, next);
    return { ok: true, settings: next };
  }
  getProviderStatus() {
    const selected = this.settings().provider ?? "offline";
    const configured = this.credentials.configured("openai");
    const settings = this.settings();
    const media = this.evidenceMedia.status(settings);
    const pool = this.providerPool;
    const localHealth = pool.getHealth("local");
    const localStatus = localHealth.last_success
      ? "ready"
      : localHealth.last_failure_class ? "unavailable" : "not-tested";
    const applianceStatus = this.inferenceAppliance.getStatus();
    return { ok:true, provider:{
      selected,
      entries:this.providerEntries(),
      offline:selected === "offline" || (selected === "local" && !applianceStatus.is_ready),
      local:{ configured:true, status:selected === "local" ? localStatus : "inactive", model:applianceStatus.model, endpoint:applianceStatus.endpoint },
      openai:{ configured, status:selected === "openai" ? (configured ? "ready" : "configuration-required") : "inactive" },
      groq:{ configured:this.credentials.configured("groq"), status:selected === "groq" ? (this.credentials.configured("groq") ? "ready" : "configuration-required") : "inactive" },
      gemini:{ configured:this.credentials.configured("gemini"), status:selected === "gemini" ? (this.credentials.configured("gemini") ? "ready" : "configuration-required") : "inactive" },
      openrouter:{ configured:this.credentials.configured("openrouter"), status:selected === "openrouter" ? (this.credentials.configured("openrouter") ? "ready" : "configuration-required") : "inactive" },
      auto:{ active:selected === "auto", eligible:pool ? pool.getCandidates({ preferredProvider:"auto" }) : [], health:pool ? Object.fromEntries(["groq", "gemini", "openrouter", "openai"].map((id) => [id, pool.getHealth(id)])) : {} },
      local_provider:{ supported:true, adapter:settings.visual_adapter, endpoint:settings.comfyui_endpoint, status:media.local.selected ? (media.local.available ? "ready" : "unavailable") : "inactive" },
      evidence_media:media
    } };
  }
  async renderEvidence({ world_id, evidence_id, retry = false } = {}) { const key = `${world_id}:${evidence_id}:${retry ? "retry" : "render"}`; if (this.evidenceRenderInflight.has(key)) return this.evidenceRenderInflight.get(key); const task = this.renderEvidenceNow({ world_id, evidence_id, retry }).finally(() => this.evidenceRenderInflight.delete(key)); this.evidenceRenderInflight.set(key, task); return task; }
  async renderEvidenceNow({ world_id, evidence_id, retry = false } = {}) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation."); try { const world = this.getWorld(world_id); const record = evidenceAuthority.archive(world, { observer:"player" }).records.find((item) => item.id === evidence_id); if (!record) return publicError("EVIDENCE_UNAVAILABLE", "That evidence record is not available to this observer."); const before = clone(record); const result = await this.evidenceMedia.render({ world_id:world.world_id, record, settings:this.settings(), retry, onPresentation:(presentation) => evidenceAuthority.setPresentation(world, evidence_id, presentation) }); this.saveCanonical(world); const after = evidenceAuthority.archive(world, { observer:"player" }).records.find((item) => item.id === evidence_id); const canonicalUnchanged = JSON.stringify({ ...before, render_status:undefined, render_presentation:undefined }) === JSON.stringify({ ...after, render_status:undefined, render_presentation:undefined }); if (!canonicalUnchanged) throw new Error("evidence truth changed during media rendering"); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null)); return { ok:true, result:{ success:result.ok, code:result.code ?? null, presentation:result.presentation ?? null, fallback:result.fallback ?? null }, projection:entry ? this.projectionFor(world, "field-researcher", entry) : null }; } catch (error) { this.log(`evidence rendering failed: ${error.message}`); return publicError("EVIDENCE_RENDER_FAILED", "The evidence record remains available; visual rendering could not be completed."); } }
  providerEntries() {
    const localHealth = this.providerPool.getHealth("local");
    const local = {
      id:"local",
      kind:"local",
      label:LOCAL_PROVIDER_SPEC.displayName,
      model:this.providerPool.getModel("local"),
      default_model:LOCAL_PROVIDER_SPEC.defaultModel,
      endpoint:this.inferenceAppliance.getStatus().endpoint,
      configured:true,
      status:localHealth.last_failure_class ? failureReason([{ attempts:[{ failure_class:localHealth.last_failure_class }] }]) : localHealth.last_success ? "Structured response received from this device" : "Configured; connection not tested",
      last_success:localHealth.last_success,
      last_failure:localHealth.last_failure_class,
      cooldown_until:localHealth.cooldown_until
    };
    const hosted = ["groq", "gemini", "openrouter", "openai"].map(id => {
      const info = this.credentials.describe?.(id) ?? { configured:this.credentials.configured(id) };
      const health = this.providerPool.getHealth(id);
      return { id, label:PROVIDER_SPECS[id].displayName, model:this.providerPool.getModel(id), default_model:PROVIDER_SPECS[id].defaultModel,
        ...info, status:!info.configured ? "No usable key" : health.last_failure_class ? failureReason([{ attempts:[{ failure_class:health.last_failure_class }] }]) : health.last_success ? "Response received this session" : "Stored; connection not tested",
        last_success:health.last_success, last_failure:health.last_failure_class, cooldown_until:health.cooldown_until };
    });
    return [local, ...hosted];
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
    if (target !== "auto" && target !== "local" && !Object.hasOwn(PROVIDER_SPECS,target)) return publicError("PROVIDER_INVALID", "Choose a supported provider.");
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
        const displayName = result.selected_provider === "local" ? LOCAL_PROVIDER_SPEC.displayName : PROVIDER_SPECS[result.selected_provider].displayName;
        return { ok:true, status:"response-received", selected_provider:result.selected_provider, message:`${displayName} returned a valid structured response. Expedition gameplay is tested separately.` };
      } catch { return { ok:false, error:{ code:"PROVIDER_UNAVAILABLE", message:failureReason(executions), provider_failure:true } }; }
    })();
    this.providerTests.set(provider,task);
    try { return await task; } finally { this.providerTests.delete(provider); }
  }
  getInferenceApplianceStatus() {
    return { ok: true, appliance: this.inferenceAppliance.getStatus() };
  }
  async installInferenceAppliance(options = {}) {
    return await this.inferenceAppliance.install(options);
  }
  cancelInferenceApplianceInstall() {
    return { ok: true, cancelled: this.inferenceAppliance.cancelInstall() };
  }
  async repairInferenceAppliance() {
    return await this.inferenceAppliance.repair();
  }
  async removeInferenceAppliance() {
    return await this.inferenceAppliance.remove();
  }
  renameWorld({ world_id, name }) { if (!friendlyName(name)) return publicError("WORLD_NAME_INVALID", "Choose a world name between 1 and 80 characters."); const data = this.metadata(); if (!data.worlds[world_id]) return publicError("WORLD_NOT_FOUND", "This world no longer exists."); try { const world = this.getWorld(world_id); const identity = world.q4_operations?.controlled_player; const person = identity ? history.character(world, identity) : null; if (person && world.q4_operations?.personnel_confirmation?.completed) return publicError("PERSONNEL_RECORD_LOCKED", "This field file is registered to permanent personnel and cannot be renamed."); } catch {} data.worlds[world_id].name = name.trim(); this.writeMetadata(data); return { ok: true, world: this.loadWorld({ world_id }).world }; }
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
  getDiagnostics() { const status = this.getProviderStatus().provider; const hosted = this.interpretationProvenance.filter((record) => (record.provider_invoked || record.invocation_status) && record.provider !== "offline" && record.provider !== "deterministic-mock").at(-1); const activeProvider = status.selected; const isOffline = status.offline || activeProvider === "offline"; const providerStatus = isOffline ? "offline" : (status[activeProvider]?.status ?? (activeProvider === "auto" ? "ready" : "inactive")); const anyConfigured = Boolean(status.openai?.configured || status.groq?.configured || status.gemini?.configured || status.openrouter?.configured); return { ok: true, diagnostics: { app_version: packageVersion, platform: process.platform, provider: activeProvider, provider_status: providerStatus, local_ai:{ selected:activeProvider === "local", endpoint:status.local?.endpoint, model:status.local?.model, status:status.local?.status }, hosted_ai:hosted ? { provider:hosted.provider, request_id:hosted.request_id, request_kind:hosted.request_kind, invocation_status:hosted.invocation_status, hosted_request:hosted.hosted_request === true, response_received:hosted.response_received === true, response_parsed:hosted.response_parsed === true, model:hosted.model, duration_ms:hosted.duration_ms, error_type:hosted.error_type ?? null, error_status:hosted.error_status ?? null, error_code:hosted.error_code ?? null, error_param:hosted.error_param ?? null } : { invocation_status:"not-observed", hosted_request:false, response_received:false, response_parsed:false }, evidence_media:{ pipeline_version:evidenceMedia.PIPELINE_VERSION, provider_mode:status.evidence_media.selected, provider_available:status.evidence_media.available, fallback:status.evidence_media.fallback }, environment:{ version:environment.VERSION, config_version:environment.CONFIG_VERSION, authority:"canonical-spatial-snapshot" }, save_directory: "managed application data", credentials_configured: anyConfigured, save_schema_version: SAVE_SCHEMA_VERSION, telemetry: "disabled", offline_gameplay: true } }; }
  sanitizedLogTail() { const file = path.join(this.paths.logs, "desktop.log"); try { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-40).map((line) => redactDiagnostic(line)); } catch { return []; } }
  exportTesterReport({ world_id, mode = "field-researcher", note = null } = {}) { try { const world = this.getWorld(world_id); const loaded = this.loadSession(world, mode); const entry = this.session(world_id, mode) ?? loaded.entry ?? null; const projection = entry ? this.projectionFor(world, mode, entry) : null; const provider = this.getProviderStatus().provider; const active = provider.selected; const render_diagnostics = evidenceAuthority.archive(world, { observer:"player" }).records.map((record) => ({ evidence_id:record.id, request_id:record.render_presentation?.request_id ?? null, status:record.render_status, last_error:record.render_presentation?.last_error ?? null, artifact_reference:record.render_presentation?.artifact?.relative_path ?? null, seed:record.render_presentation?.seed ?? null, model:record.render_presentation?.provider_model ?? null, pipeline_version:record.render_presentation?.pipeline_version ?? null })); const environment_diagnostics = environment.diagnostics(world.q4_geography?.environment, entry?.run?.spatial?.player_location ?? null); const phenomenon_diagnostics=phenomenonEcology.diagnostics(world); const recent_public_events=developerInspection.recentHistory(world).filter((item)=>!String(item.type).startsWith("q4.phenomenon.")); const input = { world, session: projection, provider: { selected: provider.selected, offline: provider.offline, configured: Boolean(provider.openai?.configured || provider.groq?.configured || provider.gemini?.configured || provider.openrouter?.configured), status: provider.offline ? "offline" : (provider[active]?.status ?? (active === "auto" ? "ready" : "inactive")), evidence_media:provider.evidence_media }, interpretation_provenance: this.interpretationProvenance, doctrine: { source: doctrineRuntime.SOURCE, sha256: doctrineRuntime.read().sha256, priority: "constitutional" }, render_diagnostics, environment_diagnostics, phenomenon_diagnostics, note, save_schema_version: SAVE_SCHEMA_VERSION, recent_public_events, logs: this.sanitizedLogTail(), recovery: { world: this.recoveryStatus(world_id, "world"), session: this.recoveryStatus(world_id, mode) } }; const safeInput = redactDiagnostic(input); const report = q4BetaReport.report(safeInput); const file = q4BetaReport.writeReport(this.paths.logs, safeInput); return { ok: true, file, report }; } catch { return publicError("TESTER_REPORT_FAILED", "The diagnostic record could not be exported safely."); } }
  serializeSession(world, mode, entry) { const phase = entry.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (entry.kind === "bootstrap") return { version: 7, schema: SAVE_SCHEMA_VERSION, mode, kind: entry.kind, legacy_flow: entry.legacy_flow === true, phase, payload: bootstrap.saveRun(entry.run) }; if (entry.kind === "lost") return { version: 7, schema: SAVE_SCHEMA_VERSION, mode, kind: entry.kind, phase, payload: clone(entry.run) }; return { version: 7, schema: SAVE_SCHEMA_VERSION, mode, kind: entry.kind, phase, payload: clone(entry) }; }
  validateSessionSave(saved, mode) { if (!saved || typeof saved !== "object") return "SESSION_SAVE_DAMAGED"; if (saved.mode !== mode) return "SESSION_MODE_INVALID"; if (![1, 2, 3, 4, 5, 6, 7].includes(saved.version ?? 1)) return "SESSION_VERSION_UNSUPPORTED"; if (saved.version === 7 && saved.schema !== SAVE_SCHEMA_VERSION) return "SESSION_SCHEMA_UNSUPPORTED"; if (!["bootstrap", "lost", "nullzone", "beck"].includes(saved.kind)) return "SESSION_SAVE_DAMAGED"; if (saved.phase?.mode_id && saved.phase.mode_id !== mode) return "SESSION_SAVE_DAMAGED"; if (saved.kind === "bootstrap" && currentClearQ4(saved.payload) && (!hasCurrentEnvironment(saved.payload) || !bootstrap.resumeRun(saved.payload).ok)) return "SESSION_SAVE_DAMAGED"; try { if (saved.phase?.phase_id) phases.validate(mode, saved.phase.phase_id); } catch { return "SESSION_SAVE_DAMAGED"; } return null; }
  restoreSession(world, mode, saved, { allowUnmarked = true } = {}) { if (this.validateSessionSave(saved, mode) || !persistencePairMatches(world, saved, { mode, allowUnmarked })) return null; const phase = saved.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (saved.kind === "bootstrap") { const current = saved.payload?.version === "yellow-beast-save@v10"; if (currentClearQ4(saved.payload) && !hasCurrentStandardOperator(world)) return null; const hadSpatialState = Boolean(saved.payload?.spatial); const hadRadioState = Boolean(saved.payload?.expedition?.radio); const hadOperationalState = Boolean(saved.payload?.expedition?.operational); const restored = bootstrap.resumeRun(saved.payload, { world, spatial_worldpack: mode === "field-researcher" ? "clear-q4" : null, phase: phase.phase_id }); if (!restored.ok) return null; if (!current) { bootstrap.ensureSpatial(restored.run, phase.phase_id); if (!hadSpatialState) { if (["FIELD_OPERATION", "RETURN", "DEBRIEF"].includes(phase.phase_id)) bootstrap.enterSpatialField(restored.run); else bootstrap.setSpatialPhase(restored.run, phase.phase_id); } if (!hadRadioState && ["FIELD_OPERATION", "RETURN", "DEBRIEF"].includes(phase.phase_id)) q4Radio.completeCheck(restored.run.expedition); if (!hadOperationalState && restored.run.expedition?.clock?.check_in_due_at != null && !restored.run.expedition.communications?.check_ins?.length) q4Time.schedule(restored.run.expedition, Math.max(1, restored.run.expedition.clock.check_in_due_at - restored.run.expedition.clock.interval)); bootstrap.evaluateMissionState(restored.run, phase.phase_id); } return { kind: "bootstrap", run: restored.run, legacy_flow: saved.legacy_flow === true || phase.legacy_flow === true, restored_from_legacy:!current, phase }; } if (saved.kind === "lost") return { kind: "lost", run: saved.payload, phase }; if (saved.kind === "nullzone") return { kind: "nullzone", run_id: saved.payload.run_id, phase }; if (saved.kind === "beck") return { kind: "beck", run_id: saved.payload.run_id, phase }; return null; }
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
    if (entry.run.expedition?.day1_opener?.catastrophic_ending) {
      world.q4_operations ??= {};
      world.q4_operations.terminal_outcome ??= {
        run_id: entry.run.run_id,
        outcome: "catastrophic-failure",
        reason: "Post-1:00 PM operational cutoff exceeded Complex-side. Trapped personnel.",
        asset_id: entry.run.expedition.day1_opener.catastrophic_ending.asset_id ?? "ending.catastrophic.newspaper",
        at: new Date().toISOString()
      };
    }
  }
  adoptPersistencePair(world, entry, committed) {
    for (const key of Object.keys(world)) delete world[key]; Object.assign(world, committed.world);
    if (entry.kind !== "bootstrap" || committed.entry?.kind !== "bootstrap") return;
    const source = committed.entry.run; const target = entry.run;
    const environmentIds = new Map((source.spatial?.environment?.history ?? []).map((change) => [change.id, change.world_history_id])); for (const change of target.spatial?.environment?.history ?? []) if (environmentIds.has(change.id)) change.world_history_id = environmentIds.get(change.id);
    const messageRecords = new Map((source.expedition?.messages ?? []).map((message) => [message.id, message.institutional_recorded])); for (const message of target.expedition?.messages ?? []) if (messageRecords.get(message.id)) message.institutional_recorded = messageRecords.get(message.id);
    target.survey_frontier = clone(source.survey_frontier); target.observation_state = clone(source.observation_state); q4Equipment.absorbCompatibility(target.expedition); if (target.expedition.logistics) logisticsRuntime.attach(target.expedition); missionRuntime.attachCompatibilityView(target.expedition); target._world = world;
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
  startSession({ world_id, mode, seed = null, require_personnel = false, scenario = null, force = false }) {
    if (!force && this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try { const world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); const descriptor = this.getMode(mode); if (!descriptor) return publicError("MODE_INVALID", "Choose one of the available roles."); let entry;
      if (mode === "field-researcher") {
        if (require_personnel && !world.q4_operations?.controlled_player) return publicError("PERSONNEL_CREATION_REQUIRED", "Create your ASYNC personnel record before receiving an assignment.");
        const hasCompletedOpener = Object.values(world.runs ?? {}).some(r => cq4Day1Opener.isOpener(r.scenario) && r.status === "completed") ||
                                   Object.values(world.q4_missions ?? {}).some(m => m.id?.startsWith("CQ4-DAY1") && m.status === "completed");
        const defaultOpener = cq4Day1Opener.isOpener(this.defaultQ4Scenario) && !hasCompletedOpener;
        const requestedScenario = cq4Day1Opener.isOpener(scenario) || (scenario == null && defaultOpener)
          ? "day1-opener"
          : (scenario === "reference-expedition" || (scenario == null && this.defaultQ4Scenario === "reference-expedition") ? "reference-expedition" : "procedural-survey");
        const runSeed = seed ?? world.seed ?? "desktop";
        const started = bootstrap.startRun({ profile: mode, seed: runSeed, scenario: requestedScenario, world, spatial_worldpack: "clear-q4" });
        if (!started.ok) return publicError("SESSION_START_FAILED", "The field session could not start.");
        standardOperator.ensure(world, started.run.run_id);
        entry = { kind: "bootstrap", run: started.run, legacy_flow: false, phase: phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }) };
        bootstrap.setSpatialPhase(entry.run, entry.phase.phase_id);
      }
      else if (mode === "lost") entry = { kind: "lost", run: lost.start(world, seed), phase: phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }) };
      else { const run_id = history.beginRun(world, { profile: mode, scenario: mode === "async-command" ? "becks-desk-operations" : "nullzone-exposure", seed }); if (mode === "local-anomaly") { const prepared = nullzone.prepare(world, run_id, ["field-light", "recording-device", "evidence-container"]); if (!prepared.ok || !nullzone.enter(world, run_id).ok) return publicError("SESSION_START_FAILED", "The civilian excursion could not start."); entry = { kind: "nullzone", run_id }; } else entry = { kind: "beck", run_id }; }
      entry.phase ??= phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); if (entry.kind === "bootstrap") entry.phase.legacy_flow = entry.legacy_flow === true; this.persistSession(world, mode, entry); return { ok: true, session: { world_id, mode, resumable: true }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) { this.log(`session start failed: ${error.message}`); return publicError("SESSION_START_FAILED", "This session could not start safely."); }
  }
  resumeSession({ world_id, mode, force = false }) {
    if (!force && this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
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
    const isOpener = cq4Day1Opener.isOpener(entry.run?.scenario);
    if (isOpener && phaseId === "BRIEFING") {
      const isBroadcastStandby = view.facility_broadcast?.status === "standby" || (!view.facility_broadcast?.visible && !view.facility_broadcast?.completed);
      const isBroadcastInProgress = Boolean(view.facility_broadcast?.status === "in-progress" && view.facility_broadcast?.visible);
      const isBriefingConcluded = view.beat === "LOCAL_INTRODUCTIONS" || view.personnel_briefing?.status === "concluded";
      const narration = isBroadcastStandby
        ? "Terminal operational in ASYNC briefing room. Standing by for facility transmission."
        : isBroadcastInProgress
        ? "Facility broadcast in progress."
        : isBriefingConcluded
        ? "Dr. Maxwell has concluded the assignment briefing. Get acquainted with your team, then proceed to Equipment Staging."
        : "Facility broadcast concluded. Standing by for assignment briefing.";
      const prompt = isBroadcastStandby
        ? "Standing by for facility transmission."
        : isBroadcastInProgress
        ? "Await conclusion of briefing broadcast before proceeding."
        : isBriefingConcluded
        ? "Get acquainted with your team, then proceed to Equipment Staging."
        : "Standing by for assignment briefing.";
      const facts = [
        ["location", "location", "the ASYNC briefing room"],
        ["status", "status", narration]
      ].map(([id, category, text]) => ({ id, category, text, required: true }));
      const scene = { version: "yellow-beast-scene@v1", scene_id: `briefing-${entry.run.run_id ?? entry.run.session.id}`, world_ref: entry.run.world_id ?? null, session_ref: entry.run.session.id, turn_ref: "briefing", observer_ref: entry.run.session.startup.player.observer_id, mode, profile: "clear-q4", scene_type: "briefing", significance: "Operational notice", location: "ASYNC briefing room", safe_facts: facts, immediate_changes: [], visible_actors: [], communications: [], sensory_facts: [], inventory: [], object_state_changes: [], unresolved_facts: [], continuing_conditions: [], context: [], interaction_prompt: prompt, provenance: { source: "observer-safe-q4-briefing", input: null } };
      scene.narration = narration;
      scene.narration_source = "fallback";
      return scene;
    }
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
  // Closes the omniscience leak Pass 9A found: consumePending() drained
  // unfiltered, so any autonomous LOCAL dialogue event would reach the
  // renderer regardless of who could actually hear it. Only LOCAL dialogue
  // events that explicitly carry listeners[] are gated; events with no
  // listeners[] recorded (non-dialogue types, and pre-existing authored
  // narration that never populated it, e.g. the Maxwell briefing beats) pass
  // through unchanged.
  filterAutonomousDialogueForPlayer(events, run) {
    const playerId = run?.session?.startup?.player?.observer_id ?? null;
    return events.filter((event) => {
      if (event.type !== presentationBus.EVENT_TYPES.DIALOGUE) return true;
      if (String(event.channel ?? "").toUpperCase() !== "LOCAL") return true;
      if (!Array.isArray(event.listeners) || event.listeners.length === 0) return true;
      return !playerId || event.listeners.includes(playerId);
    });
  }
  projectionFor(worldOrId, mode, entryParam = null) {
    const world = typeof worldOrId === "string" ? this.getWorld(worldOrId) : worldOrId;
    const worldId = world?.world_id ?? world?.id ?? (typeof worldOrId === "string" ? worldOrId : null);
    const entry = entryParam ?? this.session(worldId, mode) ?? (world ? this.restoreSession(world, mode, readJson(this.sessionFile(worldId, mode), null)) : null);
    const descriptor = this.getMode(mode);
    const runId = entry?.run_id ?? entry?.run?.run_id ?? null;
    let surface;
    if (entry.kind === "bootstrap") surface = bootstrap.status(entry.run); else if (entry.kind === "lost") surface = lost.projection(entry.run); else if (entry.kind === "nullzone") surface = { ...nullzone.projection(world), local_observation: nullzone.observeRegion(world) }; else surface = desk.projection(world);
    const phase = entry.phase ?? phases.createPhase({ mode, guided: this.settings().guided_introductions !== false }); const unfinished = consequenceEchoes.unfinishedBusiness(world, mode, { run_id: runId });
    const spatialDef = entry.run?.spatial_pack_id ? bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id) : {};
    const acousticScene = entry.run ? acousticDirector.evaluateAcousticScene(entry.run, spatialDef, world, phase.phase_id) : null;
    const pendingPresentationEvents = entry.run ? this.filterAutonomousDialogueForPlayer(presentationBus.consumePending(entry.run), entry.run) : [];
    const baseProjection = this.decorateEvidenceMedia({ version: "yellow-beast-desktop-projection@v1", world: this.worldInfo(world, this.metadata().worlds[world.world_id] ?? {}), mode: clone(descriptor), scenario: entry.run?.scenario ?? null, gameplay: gameplay.projection(world, { mode: descriptor.gameplay_mode, run_id: runId }), institution: mode === "async-command" ? desk.projection(world) : null, consequence_echoes: consequenceEchoes.observerView(world, mode, { run_id: runId }), unfinished_business: unfinished, surface: clone(surface), phase: clone(phase), q4: entry.kind === "bootstrap" ? q4.presentation(entry.run, phase, unfinished, world) : null, beck: entry.kind === "beck" ? beckExperience.presentation(world, surface, phase, unfinished) : null, nullzone: entry.kind === "nullzone" ? nullzoneExperience.presentation(world, phase, unfinished) : null, lost: entry.kind === "lost" ? lostExperience.presentation(surface, phase, unfinished) : null, scene: this.sceneFor(entry, mode, {}, world), available_actions: this.availableFor(world, mode, entry), acoustic_scene: acousticScene, presentation_events: pendingPresentationEvents, settings: this.settings() }, world);
    if (entry.kind === "bootstrap" && cq4Day1Opener.isOpener(entry.run?.scenario)) {
      const opener = entry.run?.expedition?.day1_opener;
      if (opener?.catastrophic_ending) {
        baseProjection.catastrophic_ending = clone(opener.catastrophic_ending);
        baseProjection.demo_termination = {
          status_text: "NO FURTHER ASSIGNMENTS AVAILABLE",
          catastrophic: true,
          asset_id: opener.catastrophic_ending.asset_id,
          headline: opener.catastrophic_ending.headline,
          date: opener.catastrophic_ending.date
        };
      } else if (phase.phase_id === "DEBRIEF" || entry.run.lifecycle === "completed") {
        const expedition = entry.run?.expedition ?? {};
        const writtenReport = expedition.written_report ?? Object.values(world.q4_reviews ?? {})[0]?.written_report ?? null;
        const institutionalAssessment = expedition.institutional_assessment ?? Object.values(world.q4_reviews ?? {})[0]?.institutional_findings?.reference_assessment ?? {
          status: "COMMITTED",
          confidence: "high",
          summary: "Observer account filed under Protocol KV31-C. Cross-referenced against central evidence intake.",
          basis: {
            written_report_id: writtenReport?.report_id ?? "WR-CQ4-DAY1",
            evidence_ids: ["EVD-DUFFLE-01", "EVD-SURVEY-NOTE-01"],
            prior_record_ids: ["ARCH-KV31-91"]
          }
        };

        const teamMembers = expedition.team?.members ?? [];
        const playerId = entry.run?.session?.startup?.player?.observer_id;
        const personnelRoster = teamMembers.map((member) => {
          const char = world.characters?.[member.identity] ?? {};
          const isPlayer = member.identity === playerId || member.controlled;
          const assignedEquip = Object.entries(expedition.equipment ?? {})
            .filter(([_, item]) => item.holder === member.identity || (isPlayer && (item.holder === "You" || item.holder === member.identity)))
            .map(([id, item]) => ({ id, label: item.label, state: item.state }));
          return {
            identity: member.identity,
            display_name: member.display_name ?? char.display_name ?? member.identity,
            role: member.role ?? char.role ?? (isPlayer ? "Team Lead" : "Assigned Personnel"),
            clearance: member.clearance ?? char.clearance ?? (isPlayer ? "Level 1 / Field Lead" : "Level 1 / Technical"),
            condition: member.condition ?? char.condition ?? "Nominal",
            assigned_equipment: assignedEquip,
            personality_archetype: member.archetype ?? char.identity_substrate?.behavioral_disposition ?? "Standard ASync Staff",
            identity_substrate: char.identity_substrate ? { ...char.identity_substrate } : null
          };
        });

        const evidenceVault = [
          {
            id: "EVD-DUFFLE-01",
            type: "Logistics Container",
            label: "Startup Prerequisite Materials Duffle",
            custody_status: "Central Intake Vault Custody",
            custodian: "ASync Archive Division",
            vault_location: "Central Intake Vault / Sector B1 Vault 4",
            receipt_timestamp: "1991-07-17 12:45:00",
            notes: "Heavy nylon logistics duffle containing Outpost A startup prerequisites (delivered and verified at Outpost A, surrendered to vault custody)."
          },
          {
            id: "EVD-SURVEY-NOTE-01",
            type: "Operational Record",
            label: "Layout Notes & Field Route Record",
            custody_status: "Central Intake Vault Custody",
            custodian: "ASync Archive Division",
            vault_location: "Central Intake Vault / Sector B1 Vault 4",
            receipt_timestamp: "1991-07-17 12:46:12",
            notes: "Drafted layout record and corridor annotations for Bermuda Branch traversal."
          },
          {
            id: "EVD-SPECTRO-01",
            type: "Measurement Data Plate",
            label: "Mass Spectrometer Calibration & Atmosphere Readings",
            custody_status: "Central Intake Vault Custody",
            custodian: "ASync Archive Division",
            vault_location: "Central Intake Vault / Sector B1 Vault 4",
            receipt_timestamp: "1991-07-17 12:48:30",
            notes: "Telemetry log and mass spectrometer atmospheric calibration readings taken in KV31 and Bermuda branch."
          }
        ];

        const photosTaken = expedition.day1_opener?.photographs_taken ?? expedition.photographs_taken ?? 6;
        const photographsData = {
          total_capacity: 24,
          exposures_used: photosTaken,
          exposures_remaining: 24 - photosTaken,
          frames: [
            { frame: 1, subject: "Assembly Briefing Room B1-4", location: "Briefing Room", timestamp: "10:04 AM", description: "Expedition personnel seated during Dr. Kirk Maxwell briefing presentation." },
            { frame: 2, subject: "Equipment Staging Department Manifest", location: "Equipment Staging Department", timestamp: "10:22 AM", description: "Inspection of equipment issue manifest and prefield logistics kits." },
            { frame: 3, subject: "Threshold Approach Magnetization Warning Sign", location: "Threshold Approach", timestamp: "10:35 AM", description: "Warning placard on double blast door indicating high magnetic field hazard." },
            { frame: 4, subject: "Threshold Chamber Aperture", location: "Threshold Chamber", timestamp: "10:48 AM", description: "Direct view of the open KV31 Threshold aperture and magnetic interlock ring." },
            { frame: 5, subject: "Bermuda Branch Neon Guidance Tape", location: "Utility Room", timestamp: "11:12 AM", description: "High-visibility green guidance line leading into Bermuda branch access corridor." },
            { frame: 6, subject: "Outpost A Forward Assembly", location: "Outpost A", timestamp: "11:45 AM", description: "Folding table setup and stenciled placard ASYNC OUTPOST A // BERMUDA BRANCH." }
          ].slice(0, photosTaken)
        };

        const mapData = {
          facility_schematic: {
            title: "ASYNC RESEARCH FACILITY · SECTOR B1",
            sector: "Sector B1 Lower Operational Sub-level",
            nodes: [
              { id: "maintenance-wing", name: "Maintenance Wing", desc: "Mechanical utility and interlock power routing" },
              { id: "briefing-room", name: "Briefing Room", desc: "Assignment briefing and team orientation" },
              { id: "equipment-staging", name: "Equipment Staging Department / ESD", desc: "Manifest inspection and equipment issue" },
              { id: "kv31-control", name: "KV31 Control Room", desc: "Threshold monitoring and observation station" },
              { id: "threshold-chamber", name: "Threshold Chamber", desc: "Electromagnetic aperture and interlock gates" }
            ]
          },
          bermuda_branch_route: {
            branch: "Bermuda Branch",
            classification: "Controlled Exploratory Route",
            traversed_nodes: [
              { id: "threshold-side-entry", name: "Outpost KV31", desc: "Protected ASync workplace beyond Threshold" },
              { id: "utility-room", name: "Utility Room", desc: "Initial aperture room with neon guidance tape origin" },
              { id: "corridor", name: "Bermuda Access Corridor", desc: "Transitional hallway leading into Outpost A" },
              { id: "outpost-a", name: "Outpost A", desc: "Forward operational staging point with folding tables and radio" }
            ],
            inspections: {
              "outpost-a": {
                label: "Outpost A Node Inspection",
                placard: "ASYNC OUTPOST A // BERMUDA BRANCH",
                furniture: "Two folding tables, unpacked logistics containers",
                equipment: "Stationary field radio, startup prerequisite materials delivered",
                coordinates: { x: 580, y: 195 }
              },
              "threshold-side-entry": {
                label: "Outpost KV31 Node Inspection",
                hazard_signage: "WARNING / HIGH MAGNETIC FIELD / AUTHORIZED PERSONNEL ONLY",
                aperture: "Interlocking blast door and observation window to Standard",
                status: "Operational return portal confirmed and secured"
              }
            }
          }
        };

        const institutionalRecordsData = {
          intake_ledger: {
            batch_id: "REC-1991-0717-KV31-CQ4",
            intake_operator: "Records Custodian / Intake Division B",
            timestamp: "1991-07-17 12:52:10",
            protocol: "Protocol KV31-C Section 9.2",
            status: "CLOSED / COMMITTED"
          },
          confirmed_knowledge: [
            "Outpost A startup prerequisite materials successfully staged and verified.",
            "Bermuda branch guidance tape integrity verified intact from KV31 to Outpost A.",
            "Threshold operational window confirmed stable during authorized traversal window.",
            "No catastrophic magnetic interlock disruption recorded during excursion."
          ],
          end_of_shift_status: {
            shift_status: "END OF SHIFT",
            date: "JULY 17, 1991",
            record_status: "EXPEDITION RECORD COMMITTED",
            assignment_status: "NO FURTHER ASSIGNMENT ISSUED",
            records_status: "AEOT RECORDS REMAIN AVAILABLE"
          }
        };

        baseProjection.aeot_inspection = {
          active: true,
          status: "inspectable",
          day_one_completed: true,
          date: "JULY 17, 1991",
          shift_status: "END OF SHIFT",
          assignment_status: "NO FURTHER ASSIGNMENT ISSUED",
          records_status: "AEOT RECORDS REMAIN AVAILABLE",
          report_committed: Boolean(writtenReport),
          available_views: ["report", "personnel", "evidence", "photographs", "map", "institutional_records"],
          views: {
            report: {
              written_report: writtenReport,
              institutional_assessment: institutionalAssessment,
              export_available: true
            },
            personnel: {
              roster: personnelRoster
            },
            evidence: {
              vault_location: "Central Intake Vault / Sector B1 Vault 4",
              items: evidenceVault
            },
            photographs: photographsData,
            map: mapData,
            institutional_records: institutionalRecordsData
          }
        };
        baseProjection.end_of_shift_notice = {
          title: "END OF SHIFT",
          date: "JULY 17, 1991",
          record_status: "EXPEDITION RECORD COMMITTED",
          assignment_status: "NO FURTHER ASSIGNMENT ISSUED",
          records_status: "AEOT RECORDS REMAIN AVAILABLE",
          prose: "END OF SHIFT\nJULY 17, 1991\nEXPEDITION RECORD COMMITTED\nNO FURTHER ASSIGNMENT ISSUED\nAEOT RECORDS REMAIN AVAILABLE"
        };
      }
    }
    return baseProjection;
  }
  getGameplayProjection({ world_id, mode }) { try { const world = this.getWorld(world_id); const entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue a session first."); return { ok: true, projection: this.projectionFor(world, mode, entry) }; } catch { return publicError("PROJECTION_UNAVAILABLE", "Gameplay state is not available."); } }
  getRetiredWorldArchive({ world_id }) { try { const world = this.getWorld(world_id); if (!outcomes.isRetired(world)) return publicError("WORLD_ACTIVE", "This world is still an active simulation."); return { ok:true, archive:outcomes.archive(world), reviews:clone(world.q4_reviews ?? {}), evidence:evidenceAuthority.archive(world,{observer:"player"}) }; } catch { return publicError("ARCHIVE_UNAVAILABLE", "The historical record could not be opened safely."); } }
  getInstitutionProjection({ world_id }) { try { const world = this.getWorld(world_id); return { ok: true, projection: { management: desk.projection(world), standard: institutionalRuntime.project(world, bootstrap.institutionalDefinitionFor("clear-q4")) } }; } catch { return publicError("INSTITUTION_UNAVAILABLE", "Institution state is not available."); } }

  q4LogisticsContext(entry, world) { const player = entry.run.session.startup.player.observer_id; const team = entry.run.expedition.team?.members ?? []; const names = Object.fromEntries(team.map((member) => [member.personnel_id ?? member.id, member.display_name])); const institution = institutionalRuntime.ensure(world, bootstrap.institutionalDefinitionFor(entry.run.spatial_pack_id)); return { player, actor: player, team, names, spatial: entry.run.spatial, location: entry.run.spatial?.player_location, at: entry.run.expedition.clock?.interval ?? 0, phase: entry.phase?.phase_id, restrictions: institution.restrictions?.equipment ?? [], scenario: entry.run.scenario, hard_capacity_per_person: cq4Day1Opener.isOpener(entry.run.scenario) ? 2 : undefined }; }
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
    let entry = null; let world = null; let beforeRun = null; let beforeWorld = null; let beforePhase = null;
    try {
      world = this.getWorld(world_id);
      entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      const isOpener = cq4Day1Opener.isOpener(entry.run.scenario);
      if (!entry || entry.kind !== "bootstrap" || (!referenceExpedition.isReference(entry.run.scenario) && !isOpener) || entry.phase?.phase_id !== "REPORT") return publicError("REFERENCE_REPORT_UNAVAILABLE", "A written expedition report is not available from the current phase.");
      beforeRun = clone(entry.run); beforeWorld = clone(world); beforePhase = clone(entry.phase);
      const written = isOpener
        ? cq4Day1Opener.writeReport(entry.run, { author:entry.run.session.startup.player.observer_id, text, at:entry.run.expedition.clock?.interval ?? 0 })
        : referenceExpedition.writeReport(entry.run, { author:entry.run.session.startup.player.observer_id, text, at:entry.run.expedition.clock?.interval ?? 0 });
      if (!written.ok) {
        const msg = (written.code === "REFERENCE_REPORT_EMPTY" || written.code === "OPENER_REPORT_EMPTY")
          ? "Enter the account you intend to submit to ASync."
          : (written.code === "REFERENCE_REPORT_TOO_LONG" || written.code === "OPENER_REPORT_TOO_LONG")
            ? "The written report exceeds the 4,000-character field limit."
            : "The written report could not be accepted.";
        return publicError(written.code, msg);
      }
      const report = entry.run.expedition.written_report;
      const records = evidenceAuthority.archive(world, { observer:"standard" }).records.filter((record) => record.operation_id === report.mission_id);
      report.available_evidence_ids = records.map((record) => record.id);
      if (isOpener) {
        report.institutional_assessment = cq4Day1Opener.assessInstitutionalRecord({ report, run: entry.run, evidence_records: records });
      } else {
        const prior = entry.run.expedition.mission.prior_history.find((item) => item.id === referenceExpedition.definition.prior_record.id);
        report.institutional_assessment = referenceExpedition.assessInstitutionalRecord({ report, prior_record:prior, evidence_records:records });
      }
      const institutionDefinition = bootstrap.institutionalDefinitionFor(entry.run.spatial_pack_id);
      if (records.length) institutionalRuntime.ingest(world, null, institutionDefinition, { type:"evidence-report", state:"confirmed", quality:"recorded", summary:`${records.length} returned evidence record${records.length === 1 ? "" : "s"} entered Evidence Intake custody.`, facts:records.map((record) => ({ kind:"returned-evidence", id:record.id })), provenance:{ kind:"returned-evidence", id:`${report.id}:evidence-intake`, report_id:report.id } });
      const assessment = report.institutional_assessment;
      institutionalRuntime.ingest(world, null, institutionDefinition, { type:assessment.status === "no-spatial-discrepancy-entered" ? "normal-report" : "contradictory-report", state:"confirmed", quality:assessment.basis.evidence_ids.length ? "recorded" : "claim", summary:report.text, facts:[{ kind:"written-report-claim", id:report.id }, ...(assessment.status === "no-spatial-discrepancy-entered" ? [] : [{ kind:"spatial-discrepancy-assessment", id:assessment.status }])], provenance:{ kind:"written-report", id:report.id, author:report.author } });
      history.event(world, entry.run.run_id, "q4.written-report.submitted", { report_id:report.id, mission_id:report.mission_id, author:report.author, available_evidence_ids:[...report.available_evidence_ids], assessment_status:assessment.status }, "q4-canonical-continuity");
      const review = this.finalizeQ4Closure(world, entry);
      try {
        this.persistSession(world, "field-researcher", entry);
      } catch (persistError) {
        for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
        for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      const scene = this.sceneFor(entry, "field-researcher", { scene_type:"delta", accepted:true, public_reason:assessment.summary }, world);
      return { ok:true, result:{ turn_status:"REPORT_SUBMITTED", executed:true, report_id:report.id, institutional_assessment:clone(assessment), summary:assessment.summary, scene }, projection:this.projectionFor(world, "field-researcher", entry), review };
    } catch (error) {
      if (entry?.run && beforeRun) {
        for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
        for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
      }
      this.log(`reference report failed: ${error.message}`);
      if (error.code === "PERSISTENCE_COMMIT_FAILED" || error.code?.includes("PERSISTENCE")) {
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return publicError(error.code ?? "REPORT_SUBMISSION_FAILED", error.message ?? "The report could not be submitted.");
    }
  }
  exportReportPdf({ world_id, destination = null }) {
    if (!world_id) return publicError("WORLD_ID_REQUIRED", "Specify a world to export the report for.");
    try {
      const world = this.getWorld(world_id);
      if (!world) return publicError("WORLD_NOT_FOUND", "The requested world could not be found.");
      const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      const report = entry?.run?.expedition?.written_report ?? Object.values(world.q4_reviews ?? {})[0]?.written_report;
      if (!report) return publicError("REPORT_NOT_FOUND", "No committed report is available to export.");

      const reportPdf = require("../tools/report-pdf");
      const sanitizedMissionId = String(report.mission_id ?? "CQ4-DAY1").replace(/[^a-zA-Z0-9_-]/g, "_");
      const defaultFileName = `ASYNC-EXPEDITION-REPORT-${sanitizedMissionId}-${world_id.slice(0, 8)}.pdf`;
      const exportsDir = this.paths.exports ?? path.join(this.paths.root, "exports");
      ensureDirectory(exportsDir);
      const targetPath = destination || path.join(exportsDir, defaultFileName);

      const result = reportPdf.writeReportPdf({
        report,
        expedition: entry?.run?.expedition ?? {},
        world_id,
        run_id: entry?.run?.run_id ?? report.run_id ?? null,
        world
      }, targetPath);

      return {
        ok: true,
        destination: result.destination,
        byte_length: result.byte_length
      };
    } catch (error) {
      this.log(`exportReportPdf failed: ${error.message}`);
      return publicError("EXPORT_FAILED", `The report could not be exported to PDF: ${error.message}`);
    }
  }
  submitQ4Logistics({ world_id, action, item_id = null, container_id = null, target_holder = null, target_container = null, source_item_id = null, quantity = 1, actor = null }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (outcomes.isRetired(this.getWorld(world_id))) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
    let entry = null; let world = null; let beforeRun = null; let beforeWorld = null; let beforePhase = null;
    try {
      world = this.getWorld(world_id);
      entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before managing equipment.");
      beforeRun = clone(entry.run);
      beforeWorld = clone(world);
      beforePhase = clone(entry.phase);
      const context = this.q4LogisticsContext(entry, world);
      const definition = bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id);
      const resolveHolder = (value) => {
        if (!value) return null;
        if (value === "You") return context.actor;
        const member = context.team.find((candidate) => [candidate.personnel_id, candidate.id, candidate.display_name].includes(value));
        return member?.personnel_id ?? member?.id ?? value;
      };
      const request = { action, item_id, container_id, actor: actor ?? context.actor, target_holder: resolveHolder(target_holder), target_container, source_item_id, quantity };
      const result = container_id ? logisticsRuntime.transactContainer(entry.run.expedition, definition, request, context) : logisticsRuntime.transact(entry.run.expedition, definition, request, context);
      if (!result.ok) return publicError(result.code, result.public_reason);
      logisticsRuntime.syncSpatial(entry.run.expedition, entry.run.spatial);
      spatialRuntime.syncEquipment(entry.run.spatial, entry.run.expedition);
      const authoredCost = bootstrap.dynamicsDefinitionFor(entry.run.spatial_pack_id).action_costs[String(action).toUpperCase()] ?? (/^INSPECT|^VERIFY/.test(String(action).toUpperCase()) ? 0 : 1);
      const cycle = bootstrap.resolveOperationalCycle(entry.run, String(action).toUpperCase(), authoredCost, "logistics-transaction");
      if (cq4Day1Opener.isOpener(entry.run.scenario)) {
        const duration = cq4Day1Opener.getActionDuration(String(action).toUpperCase(), { item_id, target_holder, container_id });
        cq4Day1Opener.advanceSimulationTime(entry.run, duration);
      }
      expeditionEvent(entry.run.expedition, "logistics.transaction.committed", { transaction_id: result.transaction.id, action: result.transaction.action, item_id: result.transaction.item_id ?? null, container_id: result.transaction.container_id ?? null });
      try {
        this.persistSession(world, "field-researcher", entry);
      } catch (persistError) {
        for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
        for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
        this.log(`Q4 logistics persistence failed: ${persistError.message}`);
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return { ok: true, result: { outcome: "succeeded", public_reason: result.public_reason, transaction: { action: result.transaction.action, summary: result.transaction.summary, at: result.transaction.at }, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) {
      if (entry?.run && beforeRun) {
        for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
        for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
      }
      this.log(`Q4 logistics failed: ${error.message}`);
      if (error.code === "PERSISTENCE_COMMIT_FAILED" || error.code?.includes("PERSISTENCE")) {
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return publicError("LOGISTICS_RUNTIME_ERROR", "The logistics transaction could not be committed safely.");
    }
  }
  availableFor(world, mode, entry) {
    if (outcomes.isRetired(world)) return [];
    if (entry.kind === "bootstrap") {
      if (entry.phase?.phase_id === "REPORT") return [];
      const legacyFlow = entry.legacy_flow === true || entry.phase?.legacy_flow === true;
      const isOpenerRun = cq4Day1Opener.isOpener(entry.run?.scenario);
      const beat = entry.run?.expedition?.day1_opener?.beat;
      const briefingStatus = entry.run?.expedition?.day1_opener?.personnel_briefing?.status ?? "pending";
      const briefingGated = entry.phase?.phase_id === "BRIEFING" && isOpenerRun && (!cq4Day1Opener.isBroadcastCompleted(entry.run) || beat === cq4Day1Opener.BEATS.PERSONNEL_BRIEFING);
      const briefingAction = briefingGated ? (briefingStatus === "active" ? "CONCLUDE_BRIEFING" : (briefingStatus === "pending" ? "ATTEND_BRIEFING" : null)) : "READY";
      const phaseActions = legacyFlow
        ? { BRIEFING: briefingAction, STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "CROSS", STANDARD_RADIO_CHECK: q4Radio.read(entry.run.expedition).check_completed ? "BEGIN_FIELD_OPERATION" : null }
        : { BRIEFING: briefingAction, STAGING: "PROCEED", FACILITY_TRANSIT: "APPROACH", THRESHOLD: "READY", STANDARD_RADIO_CHECK: q4Radio.read(entry.run.expedition).check_completed ? "CROSS" : null };
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
        if (briefingGated && ["RETURN", "ABORT"].includes(type)) return false;
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
      if (entry.run.lifecycle === "completed" && entry.phase?.phase_id === "DEBRIEF") {
        if (cq4Day1Opener.isOpener(entry.run.scenario)) return [];
        return [{ type: "ADVANCE_OPERATIONS", target_required: false, targets: [] }];
      }
      return phaseActions[entry.phase?.phase_id] ? [{ type: phaseActions[entry.phase.phase_id], target_required: false, targets: [] }, ...actions] : actions;
    }
    if (entry.kind === "lost") { const view = lost.projection(entry.run); return [{ type: "MOVE", target_required: true, targets: view.surroundings.exits.map(({ alias }) => ({ ref: alias, label: alias })) }, { type: "DROP", target_required: true, targets: view.status.carried.map((item) => ({ ref: item, label: item })) }, { type: "RETURN", target_required: false, targets: [] }, { type: "STRAND", target_required: false, targets: [] }]; }
    if (entry.kind === "nullzone") return [{ type: "EXPAND", target_required: false, targets: [] }, { type: "DISCOVER", target_required: false, targets: [] }, { type: "RETURN", target_required: false, targets: [] }];
    return [{ type: "REVIEW_REPORT", target_required: false, targets: [] }, { type: "ADVANCE", target_required: false, targets: [] }];
  }
  getAvailableActions({ world_id, mode }) { const current = this.getGameplayProjection({ world_id, mode }); return current.ok ? { ok: true, actions: current.projection.available_actions } : current; }
  startBriefingBroadcast({ world_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id);
      if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
      const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 first.");
      const transition = cq4Day1Opener.startBroadcast(entry.run);
      this.persistSession(world, "field-researcher", entry);
      return {
        ok: true,
        result: { outcome: "broadcast-completed", beat: transition.beat },
        projection: this.projectionFor(world, "field-researcher", entry)
      };
    } catch (error) {
      this.log(`startBriefingBroadcast error: ${error.message}`);
      return publicError("BROADCAST_START_FAILED", "Failed to start briefing broadcast.");
    }
  }
  completeBriefingBroadcast({ world_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id);
      if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
      const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 first.");
      const transition = cq4Day1Opener.completeBroadcast(entry.run);
      this.persistSession(world, "field-researcher", entry);
      return {
        ok: true,
        result: { outcome: "broadcast-completed", beat: transition.beat },
        projection: this.projectionFor(world, "field-researcher", entry)
      };
    } catch (error) {
      this.log(`completeBriefingBroadcast error: ${error.message}`);
      return publicError("BROADCAST_COMPLETION_FAILED", "Failed to transition briefing broadcast.");
    }
  }
  startPersonnelBriefing({ world_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id);
      if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
      const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 first.");
      const transition = cq4Day1Opener.startPersonnelBriefing(entry.run);
      this.persistSession(world, "field-researcher", entry);
      return {
        ok: true,
        result: { outcome: "briefing-started", status: transition.status, beat: transition.beat },
        projection: this.projectionFor(world, "field-researcher", entry)
      };
    } catch (error) {
      this.log(`startPersonnelBriefing error: ${error.message}`);
      return publicError("BRIEFING_START_FAILED", "Failed to start personnel briefing.");
    }
  }
  interactPersonnelBriefing({ world_id, text = "" }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id);
      if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
      const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 first.");
      const transition = cq4Day1Opener.interactPersonnelBriefing(entry.run, text);
      this.persistSession(world, "field-researcher", entry);
      return {
        ok: true,
        result: { outcome: "briefing-interacted", reply: transition.reply ?? null, status: transition.status, beat: transition.beat },
        projection: this.projectionFor(world, "field-researcher", entry)
      };
    } catch (error) {
      this.log(`interactPersonnelBriefing error: ${error.message}`);
      return publicError("BRIEFING_INTERACTION_FAILED", "Failed to process briefing interaction.");
    }
  }
  concludePersonnelBriefing({ world_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id);
      if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
      const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 first.");
      const transition = cq4Day1Opener.concludePersonnelBriefing(entry.run);
      this.persistSession(world, "field-researcher", entry);
      return {
        ok: true,
        result: { outcome: "briefing-concluded", status: transition.status, beat: transition.beat },
        projection: this.projectionFor(world, "field-researcher", entry)
      };
    } catch (error) {
      this.log(`concludePersonnelBriefing error: ${error.message}`);
      return publicError("BRIEFING_CONCLUDE_FAILED", "Failed to conclude personnel briefing.");
    }
  }
  advanceQ4Operations({ world_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap" || entry.run.lifecycle !== "completed" || entry.phase?.phase_id !== "DEBRIEF") return publicError("REVIEW_REQUIRED", "Complete the current review before advancing operations.");
      if (cq4Day1Opener.isOpener(entry.run?.scenario)) return publicError("NO_FURTHER_ASSIGNMENTS", "NO FURTHER ASSIGNMENTS AVAILABLE");
      const processed = q4Career.process(world, bootstrap.institutionalDefinitionFor(entry.run.spatial_pack_id), entry.run, q4Continuity.review(world, entry.run.expedition?.mission?.id));
      const seed = q4Continuity.nextSeed(world, entry.run.expedition?.mission?.id ?? entry.run.expedition?.id); const current = world.q4_operations?.controlled_player;
      if (history.character(world, current)?.status === "dead") return publicError("WORLD_RETIRED", "Controlled personnel death retires this world; begin a new career in a new world.");
      const started = bootstrap.startRun({ profile: "field-researcher", seed, scenario: "procedural-survey", world, player_identity: current, spatial_worldpack: "clear-q4" });
      if (!started.ok) return publicError("NEXT_EXPEDITION_UNAVAILABLE", "The next assignment could not be prepared safely.");
      const next = { kind: "bootstrap", run: started.run, phase: phases.createPhase({ mode: "field-researcher", guided: this.settings().guided_introductions !== false }) }; this.persistSession(world, "field-researcher", next); return { ok: true, result: { outcome: "operations-advanced", public_reason: processed.idempotent ? "The recorded institutional cycle was already complete; the next assignment remains unchanged." : "Institutional processing completed; the next Clear-Q4 assignment is available.", career_cycle: processed.cycle }, projection: this.projectionFor(world, "field-researcher", next) };
    } catch {
      return publicError("NEXT_EXPEDITION_UNAVAILABLE", "The next assignment could not be prepared safely.");
    }
  }
  triggerCatastrophicEnding({ world_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    try {
      const world = this.getWorld(world_id);
      if (!world || outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
      const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 first.");
      const result = cq4Day1Opener.triggerCatastrophicEnding(world, entry);
      this.persistSession(world, "field-researcher", entry);
      return {
        ok: true,
        result: result.result,
        projection: this.projectionFor(world, "field-researcher", entry)
      };
    } catch (error) {
      this.log(`triggerCatastrophicEnding failed: ${error.message}`);
      return publicError("CATASTROPHIC_TRIGGER_FAILED", "The catastrophic failure sequence could not be triggered safely.");
    }
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
    let entry = null; let world = null; let beforeRun = null; let beforeWorld = null; let beforePhase = null;
    try {
      world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before issuing a LOCAL order.");
      if (!["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id)) return publicError("LOCAL_PHASE_INVALID", "Nearby field orders are available only during an active field operation or return.");
      beforeRun = clone(entry.run); beforeWorld = clone(world); beforePhase = clone(entry.phase);
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
      result.scene = this.sceneFor(entry, "field-researcher", { action:"LOCAL_ORDER", scene_type:"delta", accepted:true, public_reason:result.public_reason }, world); expedition.local_intent_requests.push({ id: requestId, result: clone(result) });
      // Advance deterministic actor decision scheduler before persistence
      const spatialDefLocal = bootstrap.spatialDefinitionFor(run.spatial_pack_id);
      try { decisionScheduler.scheduleDecisions(run, spatialDefLocal, world); } catch (schedulerError) { this.log(`decision scheduler non-fatal: ${schedulerError.message}`); }
      try { this.processAutonomousSpeech(world.world_id, run.run_id); } catch (speechSchedulerError) { this.log(`speech scheduler non-fatal: ${speechSchedulerError.message}`); }
      try {
        this.persistSession(world, "field-researcher", entry);
      } catch (persistError) {
        for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
        for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
        this.log(`LOCAL intent persistence failed: ${persistError.message}`);
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return { ok: true, result, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) {
      if (entry?.run && beforeRun) {
        for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
        for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
      }
      this.log(`LOCAL intent failed: ${error.message}`);
      if (error.code === "PERSISTENCE_COMMIT_FAILED" || error.code?.includes("PERSISTENCE")) {
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return publicError("LOCAL_INTENT_RUNTIME_ERROR", "The nearby-worker request could not be resolved safely.");
    }
  }
  submitQ4Communication(input = {}) {
    const { world_id, channel, text, target = null } = input;
    if (this.recoveredWorlds.has(world_id)) return publicError("PERSISTENCE_RECOVERY_READ_ONLY", "Restore the recovered operation record before communicating.");
    const requestId = input.request_id ?? input.submission_id ?? `desktop-comms-${crypto.randomUUID()}`;
    const cleanText = typeof text === "string" ? text.trim() : "";
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify([world_id, channel, target ?? null, cleanText, ...(input.spatial_selection ? [input.spatial_selection] : [])])).digest("hex");

    if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 160) {
      return publicError("REQUEST_ID_INVALID", "The communication reference is invalid. Submit the message again.");
    }
    const active = this.communicationTurnInflight.get(world_id);
    if (active) {
      if (active.id === requestId && active.fingerprint === fingerprint) return active.promise;
      return publicError(active.id === requestId ? "REQUEST_ID_REUSED" : "SESSION_BUSY", active.id === requestId ? "That communication reference belongs to a different message." : "The previous communication is still being resolved. Wait for its result before submitting another message.");
    }
    if (this.commandBusy(world_id)) {
      return publicError("SESSION_BUSY", "The previous action is still being resolved. Wait for its result before submitting another message.");
    }

    const canonical = this.transactionContext.run(world_id, () =>
      this.submitQ4CommunicationCanonical({ ...input, request_id: requestId, input_fingerprint: fingerprint })
    );
    const providerSetting = this.settings().provider;
    const configured = ["openai", "auto", "local", "groq", "gemini", "openrouter"].includes(providerSetting);
    const dialogueContexts = canonical?._local_dialogue_contexts ?? (canonical?._local_dialogue_context ? [canonical._local_dialogue_context] : []);
    if (input.channel !== "local" || !canonical?.ok || dialogueContexts.length === 0 || (!configured && !this.localDialogueProvider && !dialogueContexts.some((context) => context.resuming))) return canonical;

    const promise = Promise.resolve().then(async () => {
      try {
        return await this.transactionContext.run(world_id, async () => {
          return await this.presentHostedLocalDialogue(input, canonical, { configured, requestId });
        });
      } finally {
        this.communicationTurnInflight.delete(world_id);
        this.giveAutonomousSpeechAnotherChance(world_id);
      }
    });
    this.communicationTurnInflight.set(world_id, { id: requestId, fingerprint, promise });
    return promise;
  }
  // Shared by presentHostedLocalDialogue (player-directed replies) and
  // presentObservationReport (autonomous NPC reports, Pass 9B-2): resolves
  // whether a local dialogue provider is usable right now and, if so,
  // acquires it under the same readiness rules. An explicitly injected
  // this.localDialogueProvider (dev/test override) bypasses the appliance
  // readiness supervisor entirely; the auto-selected appliance-backed
  // provider is wrapped by dialogueRuntime so a failed/unavailable backend
  // still drives supervisor state. Neither path weakens presentLocal's
  // contract: any failure throws the same way either provider would.
  acquireLocalDialogueProvider({ requestId, route, configured }) {
    const providerSetting = this.settings().provider;
    const isManualHosted = ["openai", "groq", "gemini", "openrouter"].includes(providerSetting);
    const key = isManualHosted ? this.credentials.get(providerSetting) : null;
    let provider = null;
    let dialogueProvider = null;
    let providerUnavailable = !this.localDialogueProvider && (!configured || (isManualHosted && !key));
    if (!providerUnavailable) {
      try {
        provider = this.localDialogueProvider ?? this.providerPool.createAutoProvider({ requestId, route });
        if (typeof provider.presentLocal !== "function") throw new Error("local dialogue provider unavailable");
        dialogueProvider = this.localDialogueProvider ? provider : this.dialogueRuntime.wrapProvider(provider, {
          fallback: () => { throw new Error("local dialogue provider unavailable"); }
        });
      } catch (providerError) {
        providerUnavailable = true;
        this.log(`LOCAL language assistance unavailable: ${providerError.message}`);
      }
    }
    return { provider, dialogueProvider, providerUnavailable };
  }
  // Speak callback for speechScheduler.drainSpeechQueue (Pass 9B-2): the
  // scheduler has already decided whether, who, and why -- this only builds
  // the observer-safe packet, asks the provider to word it, and validates
  // the result. When the provider is unavailable or its wording is rejected,
  // the SAME plan is worded by the deterministic report fallback (it states
  // only the authorized observation). null is returned only when no packet
  // can be built, which leaves the entry to the scheduler's exhaustion policy.
  async presentObservationReport(entry, run, phaseId = null) {
    const requestId = `speech-queue-${entry.id}`;
    const providerSetting = this.settings().provider;
    const configured = ["openai", "auto", "local", "groq", "gemini", "openrouter"].includes(providerSetting);
    let packet = null;
    try {
      packet = buildObservationReportPacket({ run, observer_id: entry.observer_id, feature_id: entry.feature_id, purpose: entry.purpose, disposition: entry.disposition, phase_id: phaseId });
    } catch (packetError) {
      this.log(`observation report packet unavailable for ${entry.observer_id}: ${packetError.message}`);
      return null;
    }
    // The scheduler already authorized WHETHER/WHO/WHEN. From here the SAME plan
    // feeds model wording, semantic validation and the same-plan fallback; an
    // authorized speech act is never silently dropped.
    const fallback = (reason) => {
      const text = dialogueFallback.presentReportFallback({ contribution: packet.authorized_contribution });
      this.log(`observation report fallback for ${entry.observer_id}: ${reason}`);
      return text ?? null;
    };
    const { dialogueProvider, providerUnavailable } = this.acquireLocalDialogueProvider({ requestId, route: "speechScheduler/observation-report", configured });
    if (providerUnavailable) return fallback("provider unavailable");
    if (!packet.authorized_contribution || !packet.context_capsule) return fallback("no authorized contribution");
    try {
      const candidateRaw = await dialogueProvider.presentLocal(structuredClone(packet));
      const validation = validateLocalDialogue(packet, candidateRaw, run);
      if (!validation.ok) {
        this.log(`observation report validateLocalDialogue failed: code=${validation.code}, candidate=${JSON.stringify(candidateRaw)}`);
        return fallback(validation.code);
      }
      // Same pre-commit revalidation as player-directed replies: the report must still
      // belong to this run and speaker, and anything commit-sensitive it asserts must hold now.
      const check = observerContextCompiler.revalidateContext({ run, capsule: packet._capsule, speech: validation.candidate.speech, speakerId: entry.observer_id, phaseId });
      if (this.developerMode) this.log(`[YB:CONTEXT_TRACE] ${JSON.stringify({ path: "autonomous-report", context: observerContextCompiler.describeCapsule(packet._capsule), candidate: candidateRaw?.speech ?? null, validator: "accepted", revalidation: { ok: check.ok, code: check.code ?? null } })}`);
      if (!check.ok) return fallback(check.code);
      return validation.candidate.speech;
    } catch (providerError) {
      this.log(`observation report language assistance unavailable for ${entry.observer_id}: ${providerError.message}`);
      return fallback("provider error");
    }
  }
  // Fire-and-forget continuation that runs the live speak() path against the
  // speech queue without blocking the synchronous turn that scheduled it
  // (mirrors submitQ4Communication's canonical-then-hosted split). Re-checks
  // the run_id staleness guard both before touching the queue and again
  // before persisting, exactly like presentHostedLocalDialogue -- a run that
  // moved on in the interim (save/reload, new turn) must never be committed
  // into by a report scheduled against an earlier state of it.
  // Complete busy authority for this world, equivalent to commandBusy() but
  // usable from inside our own transactionContext.run() wrapper: commandBusy
  // exempts the current AsyncLocalStorage store's own world_id ("I'm not
  // busy relative to myself"), which is meaningless here -- autonomous
  // speech is never the transaction a player turn is waiting on, so it must
  // see naturalTurnInflight/communicationTurnInflight exactly as they are.
  autonomousSpeechBlocked(world_id) {
    return this.naturalTurnInflight.has(world_id) || this.communicationTurnInflight.has(world_id);
  }
  // B1: transactionContext is an AsyncLocalStorage marker, not a lock, so a
  // player turn can start and finish entirely during the provider's await.
  // Gated twice: once before starting the drain (don't even begin a
  // provider call into a busy world) and once per-entry via canCommit(),
  // re-checked by drainSpeechQueue immediately after speak() resolves and
  // before any commit side effect. A busy/stale world at that point is a
  // postponement -- the entry is left queued for the next opportunity,
  // never marked failed.
  processAutonomousSpeech(world_id, expectedRunId) {
    return Promise.resolve().then(async () => {
      try {
        if (this.autonomousSpeechBlocked(world_id)) return;
        await this.transactionContext.run(world_id, async () => {
          if (this.autonomousSpeechBlocked(world_id)) return;
          const world = this.getWorld(world_id);
          if (!world || outcomes.isRetired(world)) return;
          const entry = this.session(world_id, "field-researcher");
          if (!entry?.run || entry.run.run_id !== expectedRunId) {
            this.log(`stale autonomous speech continuation discarded: operation ${expectedRunId} superseded`);
            return;
          }
          const result = await speechScheduler.drainSpeechQueue(entry.run, world, {
            communicationTurnInflight: this.autonomousSpeechBlocked(world_id),
            speak: (queueEntry, r) => this.presentObservationReport(queueEntry, r, entry.phase?.phase_id ?? null),
            canCommit: () => !this.autonomousSpeechBlocked(world_id) && this.session(world_id, "field-researcher") === entry && entry.run.run_id === expectedRunId
          });
          if (result.drained.length === 0) return;
          const stillCurrent = this.session(world_id, "field-researcher");
          if (stillCurrent !== entry || stillCurrent.run?.run_id !== expectedRunId) {
            this.log(`stale autonomous speech result discarded: operation ${expectedRunId} superseded before commit`);
            return;
          }
          try {
            this.persistSession(world, "field-researcher", entry);
          } catch (persistError) {
            this.log(`autonomous speech persistence failed: ${persistError.message}`);
            return; // no notification on a failed/rolled-back commit
          }
          // Notify only if the player actually heard one of the committed
          // reports (S2/listener gating carries through to the refresh
          // signal itself, not just the projected content).
          const playerId = entry.run.session?.startup?.player?.observer_id ?? null;
          if (playerId && result.drained.some((event) => event.listeners?.includes(playerId))) {
            try { this.notifyProjectionChanged(world_id); }
            catch (notifyError) { this.log(`projection-changed notification failed: ${notifyError.message}`); }
          }
        });
      } catch (error) {
        this.log(`autonomous speech continuation failed: ${error.message}`);
      }
    });
  }
  // C: gives any report postponed by B1's canCommit guard another
  // opportunity right after the player turn that blocked it finishes.
  // Fire-and-forget, single extra attempt -- not a loop, not a second
  // scheduler.
  giveAutonomousSpeechAnotherChance(world_id) {
    try {
      const entry = this.session(world_id, "field-researcher");
      if (entry?.run?.run_id) this.processAutonomousSpeech(world_id, entry.run.run_id);
    } catch (error) {
      this.log(`autonomous speech follow-up scheduling failed: ${error.message}`);
    }
  }
  async presentHostedLocalDialogue({ world_id }, canonical, { configured, requestId: callRequestId }) {
    const contexts = canonical._local_dialogue_contexts ?? (canonical._local_dialogue_context ? [canonical._local_dialogue_context] : []);
    delete canonical._local_dialogue_contexts;
    delete canonical._local_dialogue_context;
    if (contexts.length === 0) return canonical;
    const requestId = contexts[0].requestId ?? callRequestId ?? `desktop-local-${world_id}-${Date.now()}`;

    let currentWorld = this.getWorld(world_id);
    if (!currentWorld || outcomes.isRetired(currentWorld)) {
      return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
    }
    let currentEntry = this.session(world_id, "field-researcher");
    if (!currentEntry || currentEntry.run?.run_id !== contexts[0].runId) {
      this.log(`stale dialogue completion discarded: operation ${contexts[0].runId} superseded`);
      return publicError("OPERATION_SUPERSEDED", "The operation changed before the response could be delivered.");
    }

    const { provider, dialogueProvider, providerUnavailable } = this.acquireLocalDialogueProvider({ requestId, route: "submitQ4Communication/local-dialogue", configured });

    // Wording one owner's already-authorized contribution. `prior` is the lines ACCEPTED earlier in this
    // canonical turn (names + text only); it shapes wording, never who speaks or what is true.
    const wordOne = async (context, prior) => {
      context.same_turn_prior_responses = prior;
      let packet = null;
      let candidateRaw = null;
      let unavailable = providerUnavailable;
      let validation = { ok:false, code:"LOCAL_PROVIDER_UNAVAILABLE" };
      let selectedProvider = provider?.name ?? (unavailable ? "unavailable" : "injected-local-dialogue-provider");
      if (!unavailable) {
        try {
          packet = buildLocalDialoguePacket(context);
          // Hard model-input boundary: only a plan-carrying packet may be worded by a provider.
          if (!packet.authorized_contribution || !packet.context_capsule) throw Object.assign(new Error("dialogue packet carries no authorized contribution"), { code: "DIALOGUE_PLAN_REQUIRED" });
          this.recordInterpretationProvenance({ request_id: requestId, route: "submitQ4Communication/local-dialogue", event: "provider-selected", input: "player-supplied", provider:selectedProvider, model:provider.model ?? "injected", provider_invoked:false, response_classification:"not-yet-observed", canonical_resolution:"communication-runtime -> deterministic-response-owners -> personnel-continuity -> presentation-validation", observer_projection:"local-dialogue-packet@v1", responder_id:context.speaker?.personnel_id ?? context.speaker?.id });
          candidateRaw = await dialogueProvider.presentLocal(structuredClone(packet));
          const providerExecution = provider.getExecutions?.().at(-1) ?? null;
          selectedProvider = providerExecution?.selected_provider ?? provider.name ?? selectedProvider;
          validation = validateLocalDialogue(packet, candidateRaw);
        } catch (providerError) {
          unavailable = true;
          validation = { ok:false, code:"LOCAL_PROVIDER_UNAVAILABLE" };
          this.log(`LOCAL language assistance unavailable for ${context.speaker?.first_name ?? "responder"}: ${providerError.message}`);
        }
      }
      return { context, packet, candidateRaw, validation, unavailable, selectedProvider };
    };
    const acceptedPrior = (items) => items.map((item) => ({
      speaker_id: item.context.speaker?.personnel_id ?? item.context.speaker?.id ?? null,
      speaker_name: item.context.speaker?.first_name ?? item.context.speaker?.display_name ?? null,
      text: item.speech ?? null
    }));
    // Inference scheduling is NOT speech scheduling. Owners, their order and their plans were fixed by
    // code before any wording is requested, and every packet below is compiled from the same canonical
    // snapshot (nothing mutates canonical state until the commit loop), so independent owners may be
    // worded concurrently. Acceptance and commit still run strictly in canonical owner order; completion
    // order is never observed.
    const concurrency = Math.min(this.dialogueWordingConcurrency, contexts.length);
    const concurrent = !providerUnavailable && concurrency > 1
      ? await boundedAll(contexts.map((context) => () => wordOne(context, [])), concurrency)
      : null;
    const prepared = [];
    for (const [index, context] of contexts.entries()) {
      const prior = acceptedPrior(prepared);
      let result = concurrent ? concurrent[index] : await wordOne(context, prior);
      if (concurrent && result.validation.ok && prior.length) {
        // Same-turn coordination is judged against the lines accepted BEFORE this owner. A collision gets
        // one sequential re-wording that sees those lines (the serial behaviour); nothing else changes.
        const view = { ...result.packet, authorized_contribution: { ...result.packet.authorized_contribution, same_turn_prior_responses: prior.map(({ speaker_name, text }) => ({ speaker_name, text })) } };
        if (!validateLocalDialogue(view, result.candidateRaw, result.packet._run).ok) result = await wordOne(context, prior);
      }
      const { packet, candidateRaw, validation, unavailable, selectedProvider } = result;
      let fallbackSpeech = context.fallback_text ? context.fallback_text.replace(/^[^:]+:\s*/, "") : context.fallback_text;
      // Variant selection uses the lines actually ACCEPTED earlier this turn,
      // from the SAME frame/plan snapshot the model received.
      if (context.semantic_frame && context.response_plan && prepared.length) {
        const replanned = dialogueFallback.presentFallback({ frame: context.semantic_frame, plan: context.response_plan, prior: prepared.map((item) => item.speech).filter(Boolean) });
        if (replanned) fallbackSpeech = replanned;
      }
      const speech = validation.ok ? validation.candidate.speech : fallbackSpeech;
      const presentationSource = validation.ok ? (selectedProvider === "local" ? "local-model" : "hosted-model") : "deterministic-fallback";
      prepared.push({ context, packet, candidateRaw, validation, unavailable, selectedProvider, speech, presentationSource });
    }

    currentWorld = this.getWorld(world_id);
    if (!currentWorld || outcomes.isRetired(currentWorld)) {
      return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
    }
    currentEntry = this.session(world_id, "field-researcher");
    if (!currentEntry || currentEntry.run?.run_id !== contexts[0].runId) {
      this.log(`stale dialogue completion discarded: operation ${contexts[0].runId} superseded`);
      const oldRun = currentWorld.runs?.[contexts[0].runId];
      if (oldRun?.expedition?.communication_receipts) {
        const oldReceipt = oldRun.expedition.communication_receipts.find((r) => r.id === requestId);
        if (oldReceipt && oldReceipt.status === "pending") {
          oldReceipt.status = "canceled";
        }
      }
      return publicError("OPERATION_SUPERSEDED", "The operation changed before the response could be delivered.");
    }

    const receipt = currentEntry.run?.expedition?.communication_receipts?.find((r) => r.id === requestId);
    if (receipt && receipt.status === "canceled") {
      return publicError("REQUEST_CANCELED", "The communication was canceled before finalization.");
    }

    // PRE-COMMIT REVALIDATION. The provider awaits above can span other canonical
    // changes. A candidate must still belong to this world/run/speaker/turn/plan, and any
    // commit-sensitive fact its wording asserts (custody, presence, location, phase,
    // assignment) must still hold in CURRENT canonical state. Otherwise the stale wording
    // is never committed: the same turn/owner/purpose is worded by the deterministic
    // fallback, which withholds the stale value. Nothing about the turn itself changes.
    for (const item of prepared) {
      item.context_check = null;
      if (!item.speech || !item.packet?._capsule) continue;
      const speakerKey = item.context.speaker?.personnel_id ?? item.context.speaker?.id;
      const check = observerContextCompiler.revalidateContext({ run: currentEntry.run, capsule: item.packet._capsule, speech: item.speech, speakerId: speakerKey, submissionId: requestId, plan: item.context.response_plan ?? null, phaseId: currentEntry.phase?.phase_id ?? null });
      item.context_check = check;
      if (check.ok) continue;
      // A deterministic fallback is worded from the SAME plan snapshot as the model, so it can be just as
      // stale (e.g. custody changed while the provider was generating). Revalidation therefore applies to
      // whatever text would be committed, never only to model wording.
      if (check.cancel) {
        // The speaker is no longer a participant in this exchange: the reply is cancelled, not reworded.
        this.log(`pre-commit revalidation cancelled reply for ${item.context.speaker?.first_name ?? "responder"}: ${check.code}`);
        item.validation = { ok: false, code: "LOCAL_CONTEXT_TURN_CANCELLED", reason: check.code };
        item.speech = null;
        item.presentationSource = "cancelled";
        continue;
      }
      const priorSpeech = prepared.filter((other) => other !== item).map((other) => other.speech).filter(Boolean);
      const safe = item.context.semantic_frame ? dialogueFallback.presentStaleSafeFallback({ frame: item.context.semantic_frame, plan: item.context.response_plan, prior: priorSpeech }) : null;
      this.log(`pre-commit revalidation rejected candidate for ${item.context.speaker?.first_name ?? "responder"}: ${check.code}${check.stale?.length ? ` (${check.stale.map((entry) => entry.kind).join(", ")})` : ""}`);
      item.validation = { ok: false, code: "LOCAL_CONTEXT_STALE", reason: check.code };
      item.speech = safe ?? "I'm not sure right now.";
      item.presentationSource = "deterministic-fallback";
    }

    const beforeWorld = clone(currentWorld);
    const beforeRun = clone(currentEntry.run);
    const beforePhase = clone(currentEntry.phase);
    const committedResponses = [];
    for (const item of prepared) {
      const context = item.context;
      if (!item.validation.ok) this.log(`validateLocalDialogue failed: code=${item.validation.code}, candidate=${JSON.stringify(item.candidateRaw)}`);
      if (!item.speech) continue;
      personnelContinuity.recordDialogueMemory(currentWorld, {
        run_id: currentEntry.run.run_id,
        identity: context.speaker.personnel_id ?? context.speaker.id,
        player_text: context.player_text,
        response: item.speech,
        source: "local-communication",
        sender: currentEntry.run.session.startup.player.observer_id,
        at: currentEntry.run.expedition.clock?.interval ?? 0
      });
      const responseEvent = presentationBus.createDialogueEvent({
        submission_id: requestId,
        speaker_id: context.speaker.personnel_id ?? context.speaker.id,
        speaker_name: context.speaker.first_name ?? context.speaker.display_name ?? "Teammate",
        speaker_title: context.speaker.role ?? null,
        recipient_type: (context.recipient_type ?? (context.is_group ? "group" : "direct")) === "group" ? "group" : (context.recipient_type ?? (context.is_group ? "group" : "direct")) === "none" ? "none" : "direct",
        recipient_id: (context.recipient_type ?? (context.is_group ? "group" : "direct")) === "group" ? (currentEntry.run?.scenario && cq4Day1Opener.isOpener(currentEntry.run.scenario) ? "@table" : "@team") : (context.recipient_type ?? "direct") === "none" ? null : currentEntry.run.session.startup.player.observer_id,
        recipient_name: (context.recipient_type ?? (context.is_group ? "group" : "direct")) === "group" ? (cq4Day1Opener.isOpener(currentEntry.run.scenario) ? "Assembly Table" : "Team") : (context.recipient_type ?? "direct") === "none" ? null : "YOU",
        listeners: [currentEntry.run.session.startup.player.observer_id, ...(context.interaction?.listeners ?? []).filter((id) => id !== (context.speaker.personnel_id ?? context.speaker.id))],
        channel: "LOCAL",
        text: item.speech,
        kind: "speech",
        source: item.validation.ok ? presentationBus.SOURCES.AI_PERFORMANCE : presentationBus.SOURCES.DETERMINISTIC,
        interval: currentEntry.run.expedition.clock?.interval ?? 0,
        delivery: "delivered"
      });
      currentEntry.run.expedition.dialogue_history ??= [];
      currentEntry.run.expedition.dialogue_history.push(responseEvent);
      presentationBus.emit(currentEntry.run, responseEvent);
      committedResponses.push({
        order:committedResponses.length,
        speaker_id:responseEvent.speaker_id,
        speaker_name:responseEvent.speaker_name,
        text:item.speech,
        source:item.presentationSource,
        committed_event_id:responseEvent.id
      });
    }

    const first = prepared[0];
    const allModel = prepared.length > 0 && prepared.every((item) => item.validation.ok);
    const allFallback = prepared.every((item) => !item.validation.ok);
    if (prepared.some((item) => item.unavailable)) canonical.result.provider_unavailable = true;
    else delete canonical.result.provider_unavailable;
    canonical.result.presentation_source = allModel ? first.presentationSource : allFallback ? "deterministic-fallback" : "mixed-model-fallback";
    canonical.result.public_reason = committedResponses.map((item) => `${item.speaker_name}: ${item.text}`).join(" ") || "Your message is heard. No further response is required.";
    if (allFallback && first) {
      // Built from what was actually COMMITTED (after revalidation/cancellation), never from a
      // pre-commit fallback snapshot that may have gone stale or been cancelled.
      const committedText = committedResponses.map((item) => `${item.speaker_name}: ${item.text}`).join(" ") || "Your message is heard. No further response is required.";
      canonical.result.public_reason = first.unavailable
        ? `Language assistance is unavailable. Deterministic response: ${committedText}`
        : `Language assistance returned an invalid response and was rejected. Deterministic response: ${committedText}`;
    }
    canonical.result.hosted_request = { request_id:requestId, provider:first?.selectedProvider ?? "unavailable", hosted:first?.selectedProvider !== "local", status:"completed", responder_count:committedResponses.length };
    if (first?.context?.interaction) {
      q4Interactions.updatePresentation(currentEntry.run.expedition, first.context.interaction.id, {
        response: committedResponses[0]?.text ?? null,
        source: canonical.result.presentation_source,
        response_speaker: committedResponses[0]?.speaker_name ?? null,
        response_speaker_id: committedResponses[0]?.speaker_id ?? null,
        responses: committedResponses
      });
    }

    canonical.result.scene = this.sceneFor(currentEntry, "field-researcher", {
      scene_type: "delta",
      accepted: true,
      action: "LOCAL",
      public_reason: canonical.result.public_reason
    }, currentWorld);
    canonical.result.scene.narration = canonical.result.public_reason;
    canonical.result.scene.narration_source = canonical.result.presentation_source;

    if (receipt) {
      receipt.status = "completed";
      receipt.public_reason = canonical.result.public_reason;
      receipt.presentation_source = canonical.result.presentation_source;
      receipt.scene = clone(canonical.result.scene);
      receipt.cached_result = { ok: true, result: clone(canonical.result) };
    }

    try {
      this.persistSession(currentWorld, "field-researcher", currentEntry);
    } catch (persistError) {
      for (const key of Object.keys(currentWorld)) delete currentWorld[key];
      Object.assign(currentWorld, beforeWorld);
      for (const key of Object.keys(currentEntry.run)) delete currentEntry.run[key];
      Object.assign(currentEntry.run, beforeRun);
      currentEntry.run._world = currentWorld;
      currentEntry.phase = beforePhase;
      const failedReceipt = currentEntry.run.expedition?.communication_receipts?.find((r) => r.id === requestId);
      if (failedReceipt) {
        failedReceipt.status = "failed";
      }
      this.log(`finalization persistence failed: ${persistError.message}`);
      return publicError("PERSISTENCE_COMMIT_FAILED", "Your message was delivered, but the reply could not be saved. Retry this message to finish saving the reply.");
    }

    this.recordDialogueWordsmithTrace({
      developer_only:true,
      request_id:requestId,
      provider_used:first?.selectedProvider ?? "unavailable",
      player_event_id:contexts[0]?.player_event_id ?? null,
      deterministic_responders:contexts.map((context, order) => ({ order, speaker_id:context.speaker?.personnel_id ?? context.speaker?.id, speaker_name:context.speaker?.first_name ?? context.speaker?.display_name })),
      // Development-only diagnosis of what actually happened for this responder:
      // was the provider ready, did it produce a candidate, did validation
      // accept or reject it (and why), and what finally got said. Never
      // surfaced to the player -- gated by developerMode in
      // recordDialogueWordsmithTrace / getDialogueWordsmithTrace, and
      // redacted before storage.
      wordsmiths:prepared.map((item, order) => ({
        order,
        responder_id:item.context.speaker?.personnel_id ?? item.context.speaker?.id,
        provider_ready:!item.unavailable,
        speech_act:item.packet?.player_speech_act?.speech_act ?? null,
        semantic_frame:item.context.semantic_frame ?? null,
        response_plan:item.context.response_plan ?? null,
        authorized_contribution:item.packet?.authorized_contribution ?? null,
        discourse_function:item.packet?.authorized_contribution?.discourse_function ?? null,
        requested_content:item.packet?.authorized_contribution?.requested_content ?? null,
        expected_response_shape:item.packet?.authorized_contribution?.expected_response_shape ?? null,
        required_fields:(item.packet?.authorized_contribution?.required_facts ?? []).map((f) => f.key),
        optional_fields:(item.packet?.authorized_contribution?.optional_facts ?? []).map((f) => f.key),
        validation_reason:item.validation.ok ? null : (item.validation.reason ?? null),
        response_purpose:item.packet?.authorized_response?.purpose ?? null,
        context_trace:item.packet?._dialogue_trace?.context ?? null,
        context_revalidation:item.context_check ? { ok:item.context_check.ok, code:item.context_check.code ?? null, stale:(item.context_check.stale ?? []).map((entry) => entry.kind) } : null,
        wordsmith_packet:item.packet ? JSON.parse(JSON.stringify(item.packet)) : null,
        raw_candidate:item.candidateRaw,
        candidate_produced:Boolean(item.candidateRaw),
        validator_accepted:item.validation.ok,
        rejection_reason:item.validation.ok ? null : (item.validation.code ?? null),
        fallback_used:!item.validation.ok,
        output_source:item.presentationSource,
        committed_event_id:committedResponses[order]?.committed_event_id ?? null
      })),
      committed_event_ids:committedResponses.map((item) => item.committed_event_id),
      canonical_commit_order:[contexts[0]?.player_event_id, ...committedResponses.map((item) => item.committed_event_id)].filter(Boolean)
    });

    // DEV-ONLY console trace, gated the same as recordDialogueWordsmithTrace
    // (developerMode). Reuses the same `prepared` data the trace above is
    // built from -- no second tracing system, never player-visible, never
    // written to canonical state.
    if (this.developerMode) {
      for (const item of prepared) {
        const ctx = item.context;
        const ownerName = ctx.speaker?.first_name ?? ctx.speaker?.display_name ?? ctx.speaker?.personnel_id ?? ctx.speaker?.id ?? "unknown";
        this.log(`[YB:DIALOGUE_TRACE] text=${JSON.stringify(ctx.player_text)} recipient_type=${ctx.recipient_type ?? (ctx.is_group ? "group" : "direct")} inherited_scope=${ctx.inherited_scope ? "yes" : "no"} response_owner=${ownerName} speech_act=${item.packet?.player_speech_act?.speech_act ?? "n/a"} discourse_function=${ctx.semantic_frame?.discourse_function ?? "n/a"} plan_shape=${ctx.response_plan?.expected_response_shape ?? "n/a"} purpose=${JSON.stringify(item.packet?.authorized_response?.purpose ?? null)} provider_ready=${!item.unavailable} candidate_produced=${Boolean(item.candidateRaw)} validator_accepted=${item.validation.ok} rejection_reason=${item.validation.ok ? "none" : (item.validation.code ?? "unknown")} validation_reason=${JSON.stringify(item.validation.ok ? null : (item.validation.reason ?? null))} requested_content=${item.packet?.authorized_contribution?.requested_content ?? "n/a"} required_facts=${JSON.stringify((item.packet?.authorized_contribution?.required_facts ?? []).map((f) => f.key))} optional_facts=${JSON.stringify((item.packet?.authorized_contribution?.optional_facts ?? []).map((f) => f.key))} candidate=${JSON.stringify(item.candidateRaw?.speech ?? null)} fallback_used=${!item.validation.ok} output_source=${item.presentationSource}`);
        // One dev-only context trace: what the speaker was allowed to know, by category and
        // provenance. Omitted facts are named by reason only; their values are never printed.
        if (item.packet?._dialogue_trace?.context) this.log(`[YB:CONTEXT_TRACE] ${JSON.stringify({ speaker: ownerName, context: item.packet._dialogue_trace.context, response_plan_fact_keys: (item.packet?.authorized_contribution?.required_facts ?? []).map((f) => f.key), revalidation: item.context_check ? { ok: item.context_check.ok, code: item.context_check.code ?? null } : null, candidate: item.candidateRaw?.speech ?? null, validator: item.validation.ok ? "accepted" : (item.validation.code ?? "rejected"), fallback_source: item.validation.ok ? null : (item.validation.code === "LOCAL_CONTEXT_STALE" ? "stale-safe-plan-fallback" : "same-plan-fallback") })}`);
      }
    }

    canonical.projection = this.projectionFor(currentWorld, "field-researcher", currentEntry);
    return canonical;
  }
  submitQ4CommunicationCanonical({ world_id, channel, text, target = null, request_id = null, input_fingerprint = null, spatial_selection = null }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (outcomes.isRetired(this.getWorld(world_id))) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
    let entry = null; let world = null; let beforeRun = null; let beforeWorld = null; let beforePhase = null;
    try {
      world = this.getWorld(world_id); entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before communicating.");
      beforeRun = clone(entry.run); beforeWorld = clone(world); beforePhase = clone(entry.phase);
      const requestId = request_id ?? null;
      const cleanText = typeof text === "string" ? text.trim() : "";
      const fingerprint = input_fingerprint ?? crypto.createHash("sha256").update(JSON.stringify([world_id, channel, target ?? null, cleanText, ...(spatial_selection ? [spatial_selection] : [])])).digest("hex");
      if (requestId && entry.run?.expedition?.communication_receipts) {
        const recorded = entry.run.expedition.communication_receipts.find((receipt) => receipt.id === requestId);
        if (recorded) {
          if (recorded.input_fingerprint !== fingerprint) return publicError("REQUEST_ID_REUSED", "That communication reference belongs to a different message.");
          if (recorded.status === "canceled") return publicError("REQUEST_CANCELED", "The communication was canceled.");
          if (recorded.status === "pending" || recorded.status === "failed") {
            const res = clone(recorded.cached_result ?? {
              ok: true,
              result: {
                outcome: recorded.delivery ?? "delivered",
                public_reason: recorded.public_reason ?? "This message has already been recorded."
              }
            });
            const interaction = entry.run?.expedition?.interaction_history?.find((item) => item.submission_id === recorded.id || item.id === recorded.interaction_id);
            // Delivery and attitude changes were committed already. Reuse the original
            // authorization without calling react() or recording the utterance again.
            const savedContexts = recorded.response_contexts?.length ? recorded.response_contexts : [{ target_worker_id:recorded.target_worker_id ?? interaction?.response_speaker_id, response_category:recorded.response_category, fallback_text:recorded.fallback_text }];
            const recoveredContexts = savedContexts.map((saved) => {
              const speaker = entry.run?.expedition?.team?.members?.find((m) => (m.personnel_id ?? m.id) === saved.target_worker_id) ?? null;
              const person = speaker ? history.character(world, speaker.personnel_id ?? speaker.id) : null;
              const originalReaction = person?.continuity?.reaction_history?.find((item) => item.event_id === recorded.cached_result?.result?.message?.id && item.at === entry.run.run_id);
              const category = saved.response_category ?? originalReaction?.category ?? (saved.semantic_frame ? "acknowledgment" : null);
              if (!speaker || !person || !category) return null;
              // Recovery retains the exact frame/plan/contribution the turn was
              // authorized with. Only a receipt written before snapshots existed
              // is re-derived (context-free), never via the pre-ED-1 path.
              const recoveredRecipientType = saved.recipient_type ?? interaction?.recipient_type ?? null;
              let recoveredFrame = saved.semantic_frame ?? null;
              let recoveredPlan = saved.response_plan ?? null;
              let recoveredContribution = saved.authorized_contribution ?? null;
              if (!recoveredFrame || !recoveredPlan) {
                const equipmentNow = entry.run.expedition.equipment ?? {};
                const recoveredNames = Object.fromEntries([...(entry.run.expedition.team.members ?? []).map((m) => [m.personnel_id ?? m.id, m.first_name ?? m.display_name ?? null]), [entry.run.session?.startup?.player?.observer_id, "you"]]);
                const recoveredId = speaker.personnel_id ?? speaker.id;
                recoveredFrame = dialogueDiscourse.buildSemanticFrame({ text: stripNamedAddress(recorded.text, recorded.target), recipient_type: recoveredRecipientType ?? "none", equipment: equipmentNow });
                [recoveredPlan] = dialogueDiscourse.planResponses({ frame: recoveredFrame, owner_ids: [recoveredId], responders: { [recoveredId]: { self: dialogueDiscourse.buildSelfKnowledge({ person, member: speaker, held_equipment: Object.values(equipmentNow).filter((item) => item.holder === recoveredId), known_facts: (speaker.known_information ?? []).filter((fact) => fact.kind !== "reported-knowledge" || fact.source === "direct-observation"), names: recoveredNames, equipment: equipmentNow, player_id: entry.run.session?.startup?.player?.observer_id, custody_known: Object.fromEntries((recoveredFrame.referents ?? []).filter((ref) => ref.type === "equipment" && ref.resolved && ref.id).map((ref) => [ref.id, observerContextCompiler.resolveCustodyKnowledge(entry.run, recoveredId, ref.id).known])), self_state: canonicalLedger.describeSelfState(speaker) }) } }, names: recoveredNames });
                recoveredContribution = dialogueDiscourse.toAuthorizedContribution(recoveredPlan, recoveredFrame, { names: recoveredNames });
              }
              return {
                run:entry.run,
                runId:entry.run.run_id,
                player_text:recorded.text,
                speaker,
                person,
                reaction:{ category },
                fallback_text:saved.fallback_text ?? `${speaker.first_name}: Understood.`,
                interaction,
                world,
                entry,
                requestId:recorded.id,
                player_event_id:recorded.player_event_id ?? null,
                interpretation:saved.interpretation ?? interpretDialogueUtterance(stripNamedAddress(recorded.text, recorded.target), { isGroup:interaction?.recipient_type === "group" }),
                semantic_frame:recoveredFrame,
                response_plan:recoveredPlan,
                authorized_contribution:recoveredContribution,
                discourse_summary:saved.discourse_summary ?? null,
                is_group:saved.is_group ?? interaction?.recipient_type === "group",
                recipient_type:recoveredRecipientType,
                inherited_scope:Boolean(saved.inherited_scope),
                phase_id:entry.phase?.phase_id ?? null,
                resuming:true
              };
            }).filter(Boolean);
            if (!interaction || recoveredContexts.length !== savedContexts.length) {
              return publicError("DIALOGUE_RECOVERY_UNAVAILABLE", "Your message was delivered, but its original reply context is unavailable. The unfinished reply has been preserved.");
            }
            Object.defineProperty(res, "_local_dialogue_contexts", { configurable:true, enumerable:false, value:recoveredContexts });
            res.projection = this.projectionFor(world, "field-researcher", entry);
            return res;
          }
          if (recorded.status === "completed" || !recorded.status) {
            const res = clone(recorded.cached_result ?? {
              ok: true,
              result: {
                outcome: recorded.delivery ?? "delivered",
                public_reason: recorded.public_reason ?? "This message has already been recorded."
              }
            });
            res.result ??= {};
            res.result.duplicate = true;
            if (recorded.public_reason) res.result.public_reason = recorded.public_reason;
            if (recorded.presentation_source) res.result.presentation_source = recorded.presentation_source;
            if (recorded.scene) {
              res.result.scene = clone(recorded.scene);
            } else if (res.result.scene) {
              res.result.scene.public_reason = res.result.public_reason;
              res.result.scene.narration = res.result.public_reason;
              res.result.scene.narration_source = res.result.presentation_source;
            }
            res.projection = this.projectionFor(world, "field-researcher", entry);
            return res;
          }
        }
      }
      beforeRun = clone(entry.run); beforeWorld = clone(world); beforePhase = clone(entry.phase);
      if (!q4Interactions.CHANNELS.includes(channel) || channel === "action") return publicError("CHANNEL_INVALID", "Choose a communication channel.");
      if (cq4Day1Opener.isOpener(entry.run.scenario) && entry.phase?.phase_id === "BRIEFING") {
        if (!cq4Day1Opener.isBroadcastCompleted(entry.run)) {
          return publicError("BROADCAST_IN_PROGRESS", "The facility broadcast is in progress. Coworker interaction is unavailable until the broadcast concludes.");
        }
        if (channel !== "local") return publicError("INTRO_CHANNEL_UNAVAILABLE", "Introductions use LOCAL speech. The facility broadcast is receive-only and Standard is not active here.");
        if (entry.run?.expedition?.day1_opener?.beat === cq4Day1Opener.BEATS.PERSONNEL_BRIEFING) {
          cq4Day1Opener.concludePersonnelBriefing(entry.run);
        }
      }
      if (cq4Day1Opener.isOpener(entry.run.scenario) && ["STAGING", "FACILITY_TRANSIT", "THRESHOLD", "STANDARD_RADIO_CHECK"].includes(entry.phase?.phase_id) && channel === "local") return publicError("LOCAL_INPUT_PAUSED", "Personnel are focused on equipment preparation.");
      const message = typeof text === "string" ? text.trim().slice(0, 2000) : "";
      if (!message) return publicError("COMMUNICATION_EMPTY", "Say or transmit something before sending it.");
      const expedition = entry.run.expedition; const playerId = entry.run.session.startup.player.observer_id; const coworkers = expedition.team.members.filter((member) => member.personnel_id !== playerId);
      let rawTarget = typeof target === "string" ? target.trim() : (target && typeof target === "object" ? (target.id ?? target.name ?? target.personnel_id ?? null) : null);
      // ONE named-address parser for live interpretation, recipient resolution
      // and prior-turn reconstruction. A vocative counts only when it names a
      // known person or a group term; an explicit (UI-selected) target keeps
      // precedence and is never replaced by a vocative.
      const allWorldChars = Object.values(world.characters ?? {});
      const isKnownAddressName = (candidate) => {
        const candNorm = String(candidate).toLowerCase();
        return coworkers.some((m) => [m.first_name, m.last_name, m.display_name, m.personnel_id, m.id, ...(m.aliases ?? [])].filter(Boolean).some((name) => String(name).toLowerCase() === candNorm))
          || allWorldChars.some((c) => [c.first_name, c.last_name, c.display_name, c.identity, c.id, ...(c.aliases ?? [])].filter(Boolean).some((name) => String(name).toLowerCase() === candNorm));
      };
      const targetMember = rawTarget ? coworkers.find((m) => [m.personnel_id, m.id, m.first_name, m.display_name].filter(Boolean).some((n) => String(n).toLowerCase() === String(rawTarget).replace(/^@/, "").toLowerCase())) : null;
      const address = parseNamedAddress(message, { explicit_target: rawTarget || null, is_known: isKnownAddressName, name_tokens: targetMember ? [targetMember.first_name, targetMember.last_name, ...String(targetMember.display_name ?? "").split(/\s+/)].filter(Boolean) : [] });
      if (!rawTarget && address.address_type !== "none") rawTarget = address.explicit_target_name;

      const isOpenerBriefing = cq4Day1Opener.isOpener(entry.run?.scenario) && entry.phase?.phase_id === "BRIEFING";
      const GROUP_TERMS = new Set(["@table", "table", "team", "teammate", "teammates", "all", "everyone", "broadcast", "room", "local", "anyone", "crew", "group"]);
      const explicitGroupTarget = Boolean(rawTarget && GROUP_TERMS.has(rawTarget.toLowerCase()));
      // Interpretation sees only the residual utterance: a vocative naming the
      // explicit target ("Nora, what?") is address, not content. The explicit
      // target itself is unchanged and keeps precedence.
      const utterance = address.residual_text;
      const inferredRecipientType = inferLocalRecipientType(utterance, { explicitTarget: rawTarget && !explicitGroupTarget ? rawTarget : null });
      let isGroup = explicitGroupTarget || (!rawTarget && inferredRecipientType === "group");

      let peer = null;
      let recipients = [];
      let recipient_type = "none";
      let target_id = null;
      let target_name = null;
      // DEV-ONLY diagnostic flag: did this turn's scope come from inheriting
      // the immediately preceding LOCAL exchange (bare follow-up continuity)
      // rather than a fresh explicit/group address? Never read for canonical
      // routing -- surfaced only in the [YB:DIALOGUE_TRACE] dev trace below.
      let inheritedScope = false;
      // ED-1: bounded discourse context DERIVED from canonical interaction and
      // dialogue history (same location only). Read-only; nothing persisted.
      const discourseState = dialogueDiscourse.deriveDiscourseState({
        interaction_history: expedition.interaction_history,
        dialogue_history: entry.run.expedition.dialogue_history,
        player_id: playerId,
        location_id: entry.run.spatial?.player_location ?? null,
        current_interval: expedition.clock?.interval ?? null,
        equipment: expedition.equipment
      });

      if (channel === "local") {
        const localPeers = coworkers.filter((member) => {
          const record = history.character(world, member.personnel_id ?? member.id);
          return member.status === "active" && q4Personnel.observerStatus(member, record, entry.phase?.phase_id, entry.run.spatial, playerId).local_eligible;
        });

        if (isGroup) {
          if (localPeers.length === 0) {
            const reason = "No nearby participating personnel can hear this transmission.";
            communicationRuntime.local(expedition, { sender: playerId, recipients: ["unconfirmed teammate"], text: message, eligible: false, failure_reason: reason });
            q4Interactions.record(expedition, { channel, speaker: "You", targets: ["no nearby teammate"], player_text: message, attempted_behavior: "speak with a nearby teammate", eligibility: "target-out-of-range", delivery: "not-delivered", presentation: { result: reason } });
            try { this.persistSession(world, "field-researcher", entry); } catch (persistError) {
              for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
              for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
              entry.run._world = world; entry.phase = beforePhase;
              return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
            }
            return publicError("LOCAL_TARGET_UNAVAILABLE", reason);
          }
          recipients = localPeers;
          recipient_type = "group";
          target_id = isOpenerBriefing ? "@table" : "@team";
          target_name = isOpenerBriefing ? "Assembly Table" : "Team";
        } else if (rawTarget) {
          const targetNorm = rawTarget.toLowerCase();
          const activeMatches = coworkers.filter((member) => {
            const record = history.character(world, member.personnel_id ?? member.id);
            const candidates = [
              member.personnel_id,
              member.id,
              member.first_name,
              member.last_name,
              member.display_name,
              record?.first_name,
              record?.last_name,
              record?.display_name,
              ...(member.aliases ?? []),
              ...(record?.aliases ?? [])
            ].filter(Boolean).map(s => String(s).toLowerCase().trim());
            return candidates.includes(targetNorm);
          });

          if (activeMatches.length > 1) {
            return publicError("TARGET_AMBIGUOUS", `Multiple active teammates match "${rawTarget}". Specify the full name or role.`);
          }

          if (activeMatches.length === 0) {
            const allWorldCharacters = Object.values(world.characters ?? {});
            const worldMatches = allWorldCharacters.filter((person) => {
              const candidates = [
                person.identity,
                person.id,
                person.first_name,
                person.last_name,
                person.display_name,
                ...(person.aliases ?? [])
              ].filter(Boolean).map(s => String(s).toLowerCase().trim());
              return candidates.includes(targetNorm);
            });

            if (worldMatches.length > 0) {
              const match = worldMatches[0];
              if (match.status === "dead") {
                return publicError("LOCAL_TARGET_UNAVAILABLE", `${match.display_name || match.first_name || rawTarget} is deceased and cannot be addressed.`);
              }
              if (match.identity === playerId) {
                return publicError("TARGET_INVALID", "You cannot address yourself as a recipient.");
              }
              if (match.role?.toLowerCase().includes("chief") || match.identity === "kirk-maxwell") {
                return publicError("LOCAL_TARGET_UNAVAILABLE", `${match.display_name || match.first_name || rawTarget} is not present in the field complex.`);
              }
              return publicError("LOCAL_TARGET_UNAVAILABLE", `${match.display_name || match.first_name || rawTarget} is not assigned to the current operational team.`);
            }

            return publicError("TARGET_NOT_FOUND", `No personnel matching "${rawTarget}" was found.`);
          }

          peer = activeMatches[0];
          const person = history.character(world, peer.personnel_id ?? peer.id);
          const observed = q4Personnel.observerStatus(peer, person, entry.phase?.phase_id, entry.run.spatial, playerId);

          if (!localPeers.some((m) => (m.personnel_id ?? m.id) === (peer.personnel_id ?? peer.id))) {
            const reason = peer?.condition === "Unresponsive"
              ? "The teammate is unresponsive."
              : `${peer.first_name || peer.display_name} is not within speaking range.`;
            communicationRuntime.local(expedition, { sender: playerId, recipients: [peer.personnel_id ?? peer.id], text: message, eligible: false, failure_reason: reason });
            q4Interactions.record(expedition, { channel, speaker: "You", targets: [peer.display_name], player_text: message, attempted_behavior: "speak with a nearby teammate", eligibility: "target-out-of-range", delivery: "not-delivered", presentation: { result: reason } });
            try {
              this.persistSession(world, "field-researcher", entry);
            } catch (persistError) {
              for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
              for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
              entry.run._world = world; entry.phase = beforePhase;
              return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
            }
            return publicError("LOCAL_TARGET_UNAVAILABLE", reason);
          }

          recipients = [peer];
          recipient_type = "direct";
          target_id = peer.personnel_id ?? peer.id;
          target_name = peer.first_name ?? peer.display_name;
        } else {
          // Untargeted utterance: spoken aloud into the room. No individual or
          // group was addressed by the player's own words. A short, purely
          // reactive follow-up ("What?", "Huh?") may inherit the conversational
          // scope of the immediately preceding LOCAL exchange at this same
          // location -- it must never collapse to "pick the first eligible
          // teammate and pretend the player addressed them directly."
          const inheritedScopeResolution = dialogueDiscourse.resolveRecipientScope({
            text: utterance,
            discourse: discourseState,
            present_ids: localPeers.map((member) => member.personnel_id ?? member.id)
          });
          const priorLocal = inheritedScopeResolution.inherited ? discourseState.last_turn : null;
          const inheritedGroup = inheritedScopeResolution.recipient_type === "group"
            ? localPeers.filter((member) => inheritedScopeResolution.recipient_ids.includes(member.personnel_id ?? member.id))
            : [];
          const inheritedDirect = inheritedScopeResolution.recipient_type === "direct"
            ? localPeers.find((member) => (member.personnel_id ?? member.id) === inheritedScopeResolution.recipient_ids[0]) ?? null
            : null;

          if (inheritedGroup.length > 0) {
            recipients = inheritedGroup;
            recipient_type = "group";
            isGroup = true;
            target_id = priorLocal.recipient_id ?? (isOpenerBriefing ? "@table" : "@team");
            target_name = isOpenerBriefing ? "Assembly Table" : "Team";
            inheritedScope = true;
          } else if (inheritedDirect) {
            recipients = [inheritedDirect];
            recipient_type = "direct";
            isGroup = false;
            target_id = inheritedDirect.personnel_id ?? inheritedDirect.id;
            target_name = inheritedDirect.first_name ?? inheritedDirect.display_name;
            inheritedScope = true;
          } else {
            // Genuine untargeted scope: heard by everyone present, addressed
            // to no one. Nobody is spoken TO; any reaction stays room-scoped.
            recipients = [];
            recipient_type = "none";
            target_id = null;
            target_name = null;
          }
        }

        const deliveredRecipients = recipients.length > 0 ? recipients.map((member) => member.personnel_id ?? member.id) : localPeers.map((member) => member.personnel_id ?? member.id);
        const deliveredLocal = communicationRuntime.local(expedition, { sender: playerId, recipients: deliveredRecipients, text: message, eligible: true });
        phenomenonEcology.recordSpeech(world, entry.run, { speaker:playerId, text:message, location_id:entry.run.spatial.player_location });
        // Map knowledge never moves because a line merely contains "where"/"route": a knowledge
        // transfer needs communicated content (Doctrine 4.10, 7.19). Route sharing belongs to the
        // structured report path, not to keyword matching over speech.
        const request = /\b(hand|pass|give|bring|transfer)\b/i.test(message);
        const isQuestion = /\?$/.test(message.trim()) || /^(?:what|where|who|when|why|how|can you|could you|do you|is there|are there|will you)\b/i.test(message.trim());
        const isWarning = /\b(?:look out|watch out|careful|warning|danger|hazard|stop)\b/i.test(message);
        const importance = request ? 58 : isWarning ? 75 : 85;
        const risk = isWarning ? 70 : 0;
        // A disclosure is the player's own first-person preference or concern ("I prefer...", "I get nervous
        // in the dark"); a keyword about the world ("It's dark in here.") discloses nothing about them.
        const isDisclosure = /\b(?:i prefer|i(?:'d| would) rather|(?:please )?call me)\b|\b(?:i(?:'m| am)|i feel|i get|makes me|i hate|i don'?t like)\b[^.?!]{0,40}\b(?:nervous|afraid|scared|tight spaces|dark|claustrophobic|worried)\b/i.test(message);
        // Bounded interpretation — deterministic speech act classification for the wordsmith pipeline.
        // Separate from the regex flags above which feed the existing reactionContext API.
        const localInterpretation = interpretDialogueUtterance(utterance, { isGroup });
        // ED-1: deterministic semantic frame (discourse function, referents,
        // antecedent). Code decides the conversational situation; the model
        // never chooses any part of it.
        const semanticFrame = dialogueDiscourse.buildSemanticFrame({ text: utterance, recipient_type, interpretation: localInterpretation, discourse: discourseState, equipment: expedition.equipment, scope_inherited: inheritedScope, spatial_selection, temporal_anchors: dialogueTemporalAnchors(entry.run), now: expedition.clock?.interval ?? null });
        const discourseSummary = dialogueDiscourse.summarizeDiscourse(discourseState, semanticFrame);
        for (const recipient of (recipients.length > 0 ? recipients : localPeers)) {
          const recId = recipient.personnel_id ?? recipient.id;
          recipient.last_communication = { channel: "LOCAL", direction: "received", at: expedition.clock.interval, message_id: deliveredLocal.message.id };
          recipient.known_information ??= [];
          recipient.known_information.push({ kind: "reported-knowledge", text: message, source: "local-communication", sender: playerId, at: expedition.clock.interval, message_id: deliveredLocal.message.id });
          personnelContinuity.recordDialogueMemory(world, {
            run_id: entry.run.run_id,
            identity: recId,
            player_text: message,
            response: null,
            source: "local-communication",
            sender: playerId,
            at: expedition.clock.interval
          });
          if (isDisclosure) {
            personnelContinuity.recordAttitudeChange(world, {
              run_id: entry.run.run_id,
              identity: recId,
              target_id: playerId,
              delta: { trust: 8, rapport: 10 },
              reason: "Player shared working preferences and concerns openly.",
              at: expedition.clock.interval
            });
          } else if (isWarning) {
            personnelContinuity.recordAttitudeChange(world, {
              run_id: entry.run.run_id,
              identity: recId,
              target_id: playerId,
              delta: { trust: 4, rapport: 2 },
              reason: "Player gave timely operational warning.",
              at: expedition.clock.interval
            });
          }
        }
        // The ONE canonical item resolution is semanticFrame.referents. A
        // uniquely resolved referent may drive knowledge/owner selection and
        // handoff wording; an ambiguous or unmatched item never claims ownership.
        const equipmentReferent = semanticFrame.referents.find((ref) => ref.type === "equipment" && ref.resolved) ?? null;
        const requestedEquipment = equipmentReferent ? (expedition.equipment?.[equipmentReferent.id] ?? Object.values(expedition.equipment ?? {}).find((item) => item.id === equipmentReferent.id) ?? null) : null;
        const equipmentHolder = requestedEquipment ? expedition.team.members.find((member) => member.personnel_id === requestedEquipment.holder) : null;
        const unresolvedItemNamed = semanticFrame.referents.some((ref) => ref.type === "equipment" && !ref.resolved);
        const spokenNames = Object.fromEntries([...(expedition.team.members ?? []).map((member) => [member.personnel_id ?? member.id, member.first_name ?? member.display_name ?? null]), [playerId, "you"]]);

        let chosen = null;
        let response = "";
        let responseBody = "";
        let chosenId = null;
        let responseListeners = [];
        let interactionTargets = [];
        let recipientIds = [];
        const playerListeners = localPeers.map((p) => p.personnel_id ?? p.id);
        interactionTargets = recipient_type === "none" ? ["Room / Untargeted"] : (isGroup ? ["Assembly Table"] : recipients.map((r) => r.display_name));
        recipientIds = recipient_type === "none" ? [] : recipients.map((r) => r.personnel_id ?? r.id);

        const heardPeers = recipient_type === "none" ? localPeers : recipients;
        const equipmentKnowledgeQuestion = ["group_question", "factual_question"].includes(localInterpretation?.speech_act) && localInterpretation?.topic === "equipment" && /\b(?:carry|carrying|holding|holds|have|has|got|equipment|gear|kit|manifest|assigned|responsible)\b/i.test(message);
        const selfKnowledgeById = {};
        const responseCandidates = heardPeers.map((recipient) => {
          const recId = recipient.personnel_id ?? recipient.id;
          const recipientPerson = history.character(world, recId);
          const reactionContext = personnelContinuity.reactionContext({
            world,
            run: entry.run,
            phase: entry.phase?.phase_id,
            worker_id: recId,
            player_id: playerId,
            event: {
              id: deliveredLocal.message.id,
              category: "local-communication",
              summary: `The teammate heard the player's statement: ${message}`,
              novelty_key: request ? "local-equipment-request" : `local-statement-${message.toLowerCase().slice(0, 80)}`,
              operational_importance: importance,
              perceived_risk: risk,
              is_question: isQuestion,
              observed_by: [recId],
              delivered_to: [recId],
              participants: [playerId, recId]
            }
          });
          const reaction = personnelContinuity.react(world, reactionContext);
          // ONE known-answer authority: the structured answer decides relevance
          // here AND becomes a plan fact (toKnownAnswerFact) that the fallback
          // and the model both read. No wording function is involved.
          const knownAnswerFact = dialogueDiscourse.toKnownAnswerFact(personnelContinuity.resolveKnownAnswer(entry.run, recId, message, world));
          const heldEquipment = Object.values(expedition.equipment ?? {}).filter((item) => item.holder === recId);
          // Knowledge relevance (not wording): a uniquely resolved item is
          // relevant only to its canonical holder; an ambiguous/unmatched item
          // is relevant to nobody; a generic "what are we carrying?" keeps the
          // prior behavior (each holder of gear).
          const equipmentRelevant = equipmentKnowledgeQuestion && !unresolvedItemNamed && (requestedEquipment ? requestedEquipment.holder === recId : heldEquipment.length > 0);
          const knownFacts = (recipient.known_information ?? []).filter((fact) => fact.kind !== "reported-knowledge" || fact.source === "direct-observation");
          // Custody this listener can know comes ONLY from the observer/knowledge authority
          // (self, witnessed handoff, or unchanged institutional issuance).
          const custodyKnown = Object.fromEntries((semanticFrame.referents ?? []).filter((ref) => ref.type === "equipment" && ref.resolved && ref.id).map((ref) => [ref.id, observerContextCompiler.resolveCustodyKnowledge(entry.run, recId, ref.id).known]));
          selfKnowledgeById[recId] = dialogueDiscourse.buildSelfKnowledge({ person: recipientPerson, member: recipient, task: reactionContext?.worker?.task ?? null, held_equipment: heldEquipment, known_facts: knownFacts, known_answer: knownAnswerFact, names: spokenNames, equipment: expedition.equipment, player_id: playerId, custody_known: custodyKnown, self_state: canonicalLedger.describeSelfState(recipient) });
          // "Did anyone hear what I just said?" is answered only by someone who actually heard that line.
          const heardTheAskedLine = semanticFrame.discourse_function !== "ask_heard_confirmation" || !semanticFrame.antecedent?.resolved || (semanticFrame.antecedent.listener_ids ?? []).includes(recId);
          // Topic-matched known facts use the SAME selection the plan uses.
          const topicFactsKnown = (["ask_factual", "challenge"].includes(semanticFrame.discourse_function) ? dialogueDiscourse.selectKnownFacts(semanticFrame, knownFacts) : []).length > 0;
          // Wording is deferred: it runs only for already-authorized owners and
          // can influence neither eligibility, owner count nor scope.
          // Last-resort legacy wording for a discourse function the plan-aware
          // fallback does not cover. Every current function is covered, so this
          // is not reached on plan-carrying turns.
          const legacyWording = () => personnelContinuity.presentReaction(recipientPerson, reaction.reaction, message, playerId, localInterpretation?.speech_act ?? null);
          return {
            id: recId,
            recipient,
            person: recipientPerson,
            reaction_context: reactionContext,
            reaction: reaction.reaction,
            legacy_wording: legacyWording,
            // Eligibility: listener state (heardPeers) + reaction salience OR the
            // deterministic semantic duty of the frame. Never wording.
            response_eligible: heardTheAskedLine && (Boolean(reaction.reaction) || dialogueDiscourse.frameObligatesResponse(semanticFrame, recId, { recipient_type, holder_present: !requestedEquipment || heardPeers.some((peer) => (peer.personnel_id ?? peer.id) === requestedEquipment.holder) })),
            has_relevant_knowledge: Boolean(equipmentRelevant || (knownAnswerFact && dialogueDiscourse.KNOWN_ANSWER_FUNCTIONS.includes(semanticFrame.discourse_function)) || topicFactsKnown)
          };
        });

        const ownerIds = resolveResponseOwners({ recipient_type, interpretation:localInterpretation, player_text:utterance, candidates:responseCandidates, frame:semanticFrame });
        const authorizedResponses = ownerIds.map((id) => responseCandidates.find((candidate) => candidate.id === id)).filter(Boolean);
        // Per-owner response plan over the ALREADY-authorized owners; the
        // planner never adds, removes or reorders speakers.
        const responsePlans = dialogueDiscourse.planResponses({ frame: semanticFrame, owner_ids: authorizedResponses.map((item) => item.id), responders: Object.fromEntries(Object.entries(selfKnowledgeById).map(([id, self]) => [id, { self }])), names: spokenNames });
        const priorTexts = [];
        for (const item of authorizedResponses) {
          item.response_plan = responsePlans.find((plan) => plan.responder_id === item.id) ?? null;
          item.authorized_contribution = dialogueDiscourse.toAuthorizedContribution(item.response_plan, semanticFrame, { names: spokenNames });
          item.semantic_frame = semanticFrame;
          item.discourse_summary = discourseSummary;
          // Fallback wording, AFTER owners, from the SAME plan snapshot the model
          // receives (frame + plan facts + style hints + earlier same-turn lines).
          const planned = dialogueFallback.presentFallback({ frame: semanticFrame, plan: item.response_plan, prior: priorTexts });
          const first = item.recipient.first_name ?? item.recipient.display_name;
          item.text = planned ? `${first}: ${planned}` : item.legacy_wording();
          priorTexts.push(planned ?? "");
        }
        if (this.developerMode) this.log(`[YB:DISCOURSE_TRACE] ${dialogueDiscourse.formatDiscourseTrace({ raw_utterance: message, utterance, recipient_scope: semanticFrame.target_scope, frame: semanticFrame, discourse_summary: discourseSummary, owner_ids: ownerIds, plans: responsePlans, grounded_facts: responsePlans.flatMap((plan) => plan.required_facts.map((fact) => `${plan.responder_id}:${fact.key}`)) })}`);
        for (const item of authorizedResponses) {
          item.body = String(item.text ?? "").replace(new RegExp(`^${String(item.recipient?.first_name ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`, "i"), "");
          item.listeners = [playerId, ...localPeers.map((p) => p.personnel_id ?? p.id).filter((id) => id !== item.id)];
        }
        chosen = authorizedResponses[0] ?? null;
        chosenId = chosen?.id ?? null;
        response = authorizedResponses.map((item) => item.text).join(" ");
        responseBody = chosen?.body ?? "";
        responseListeners = chosen?.listeners ?? [];

        if (recipients.length > 0) {
          personnelContinuity.recordSharedHistory(world, { run_id: entry.run.run_id, participants: [playerId, ...recipients.map((recipient) => recipient.personnel_id ?? recipient.id)], kind: "local-communication", refs: { message_id: deliveredLocal.message.id, geography_shared: /\b(route|corridor|passage|location|map|survey|where)\b/i.test(message) }, at: expedition.clock.interval });
        }

        const providerSetting = this.settings().provider;
        const configured = ["openai", "auto", "local", "groq", "gemini", "openrouter"].includes(providerSetting);
        const willBeHosted = authorizedResponses.length > 0 && channel === "local" && (configured || Boolean(this.localDialogueProvider));
        const responseOwners = authorizedResponses.map((item, index) => ({
          order: index,
          speaker_id: item.id,
          speaker_name: item.recipient.first_name ?? item.recipient.display_name ?? "Coworker"
        }));
        const projectedResponses = willBeHosted ? [] : authorizedResponses.map((item, index) => ({
          order: index,
          speaker_id: item.id,
          speaker_name: item.recipient.first_name ?? item.recipient.display_name ?? "Coworker",
          text: item.body,
          source: "deterministic"
        }));

        const interaction = q4Interactions.record(expedition, {
          channel,
          speaker: "You",
          speaker_id: playerId,
          targets: interactionTargets,
          recipient_type,
          recipient_id: target_id,
          recipient_ids: recipientIds,
          listeners: playerListeners,
          player_text: message,
          attempted_behavior: recipient_type === "none" ? "speak aloud to the room" : (isGroup ? "address the group" : "speak with a nearby teammate"),
          eligibility: "eligible",
          delivery: "heard",
          time_cost: 0,
          canonical_effects: ["communication.local.delivered"],
          response_speaker: chosen?.recipient?.first_name ?? chosen?.recipient?.display_name ?? null,
          response_speaker_id: chosenId,
          response_owners: responseOwners,
          responses: projectedResponses,
          response_listeners: responseListeners,
          location_id: entry.run.spatial?.player_location ?? null,
          submission_id: requestId,
          presentation: { result: "heard", response: responseBody || null }
        });
        q4Trajectories.noteCommunication({ world, expedition, run_id: entry.run.run_id, channel: "local", delivered: true, text: message });
        const cycle = bootstrap.resolveOperationalCycle(entry.run, "LOCAL", 0, "local-communication");
        if (cq4Day1Opener.isOpener(entry.run.scenario)) {
          const commDuration = cq4Day1Opener.getActionDuration("COMMUNICATE", { length: message.length > 100 ? "extended" : message.length < 25 ? "brief" : "normal" });
          cq4Day1Opener.advanceSimulationTime(entry.run, commDuration);
        }

        // 1. Commit canonical player dialogue event FIRST
        const playerDialogueEvent = presentationBus.createDialogueEvent({
          submission_id: requestId,
          speaker_id: playerId,
          speaker_name: "YOU",
          speaker_title: "EXPEDITION LEAD",
          recipient_type,
          recipient_id: target_id,
          recipient_name: target_name,
          listeners: playerListeners,
          channel: "LOCAL",
          text: message,
          kind: "speech",
          source: presentationBus.SOURCES.DETERMINISTIC,
          interval: expedition.clock.interval,
          delivery: "delivered"
        });
        entry.run.expedition.dialogue_history ??= [];
        entry.run.expedition.dialogue_history.push(playerDialogueEvent);
        presentationBus.emit(entry.run, playerDialogueEvent);

        // 2. Commit authorized coworker responses in deterministic owner order.
        // The response's displayed recipient scope follows the PLAYER's actual
        // recipient_type, never a "someone answered" inference -- a room-scoped
        // ("none") utterance that happens to draw one deterministic reaction
        // must not be rendered as if the player had addressed that person directly.
        const coworkerRecipientType = recipient_type === "group" ? "group" : recipient_type === "direct" ? "direct" : "none";
        const coworkerRecipientId = coworkerRecipientType === "group" ? (isOpenerBriefing ? "@table" : "@team") : coworkerRecipientType === "direct" ? playerId : null;
        const coworkerRecipientName = coworkerRecipientType === "group" ? (isOpenerBriefing ? "Assembly Table" : "Team") : coworkerRecipientType === "direct" ? "YOU" : null;
        if (!willBeHosted) for (const authorized of authorizedResponses) {
          const coworkerDialogueEvent = presentationBus.createDialogueEvent({
            submission_id: requestId,
            speaker_id: authorized.id,
            speaker_name: authorized.recipient?.first_name ?? authorized.recipient?.display_name ?? "Coworker",
            speaker_title: authorized.recipient?.role ?? null,
            recipient_type: coworkerRecipientType,
            recipient_id: coworkerRecipientId,
            recipient_name: coworkerRecipientName,
            listeners: authorized.listeners,
            channel: "LOCAL",
            text: authorized.body,
            kind: "speech",
            source: presentationBus.SOURCES.DETERMINISTIC,
            interval: expedition.clock.interval,
            delivery: "delivered"
          });
          entry.run.expedition.dialogue_history.push(coworkerDialogueEvent);
          presentationBus.emit(entry.run, coworkerDialogueEvent);
        }

        if (entry.run?.spatial && ["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id)) {
          const spatialDefLocal = bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id);
          try { decisionScheduler.scheduleDecisions(entry.run, spatialDefLocal, world); } catch (schedulerError) { this.log(`decision scheduler non-fatal: ${schedulerError.message}`); }
          try { this.processAutonomousSpeech(world.world_id, entry.run.run_id); } catch (speechSchedulerError) { this.log(`speech scheduler non-fatal: ${speechSchedulerError.message}`); }
        }
        const publicReason = response || (recipient_type === "none" ? (isOpenerBriefing ? "You speak aloud to the room. Nobody at the table responds." : "You speak aloud. Nobody responds.") : "Your message is heard. No further response is required.");
        const scene = this.sceneFor(entry, "field-researcher", { scene_type: "delta", accepted: true, action: "LOCAL", public_reason: publicReason }, world);
        const output = { ok: true, result: { outcome: "delivered", public_reason: publicReason, message: { id: deliveredLocal.message.id, state: deliveredLocal.message.state }, mission_updates: cycle.mission_updates, scene }, projection: this.projectionFor(world, "field-researcher", entry) };
        if (requestId) {
          const receipt = {
            id: requestId,
            submission_id: requestId,
            input_fingerprint: fingerprint,
            run_id: entry.run.run_id,
            interval: expedition.clock.interval,
            channel,
            target: target ?? null,
            text: message,
            delivery: "delivered",
            status: willBeHosted ? "pending" : "completed",
            public_reason: publicReason,
            presentation_source: "deterministic",
            scene: clone(scene),
            cached_result: { ok: true, result: clone(output.result) },
            interaction_id: interaction?.id ?? null,
            target_worker_id: authorizedResponses[0]?.id ?? null,
            response_category: authorizedResponses[0]?.reaction?.category ?? null,
            fallback_text: authorizedResponses[0]?.text ?? response,
            player_event_id: playerDialogueEvent.id,
            response_owners: responseOwners,
            response_contexts: authorizedResponses.map((authorized) => ({
              target_worker_id: authorized.id,
              response_category: authorized.reaction?.category ?? null,
              fallback_text: authorized.text,
              // Retry/recovery snapshot: the exact frame, plan and contribution
              // this turn was authorized with. Never re-derived after the fact.
              semantic_frame: clone(authorized.semantic_frame),
              response_plan: clone(authorized.response_plan),
              authorized_contribution: clone(authorized.authorized_contribution),
              discourse_summary: clone(authorized.discourse_summary),
              interpretation: clone(localInterpretation),
              is_group: isGroup,
              recipient_type,
              inherited_scope: inheritedScope
            }))
          };
          entry.run.expedition.communication_receipts ??= [];
          entry.run.expedition.communication_receipts.push(receipt);
        }
        try {
          this.persistSession(world, "field-researcher", entry);
        } catch (persistError) {
          for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
          for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
          entry.run._world = world; entry.phase = beforePhase;
          return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
        }
        if (authorizedResponses.length > 0) Object.defineProperty(output, "_local_dialogue_contexts", { configurable:true, enumerable:false, value:authorizedResponses.map((authorized) => ({ run:entry.run, runId:entry.run.run_id, player_text:message, speaker:authorized.recipient, person:authorized.person, reaction_context:authorized.reaction_context, reaction:authorized.reaction, fallback_text:authorized.text, interaction, world, entry, requestId, player_event_id:playerDialogueEvent.id, interpretation:localInterpretation, semantic_frame:authorized.semantic_frame, response_plan:authorized.response_plan, authorized_contribution:authorized.authorized_contribution, discourse_summary:authorized.discourse_summary, is_group:isGroup, recipient_type, inherited_scope:inheritedScope, phase_id:entry.phase?.phase_id ?? null })) });
        return output;
      }
      const radio = expedition.equipment?.["survey-radio"];
      const radioCheckPhase = entry.phase?.phase_id === "STANDARD_RADIO_CHECK";
      const isOpenerReturnAtKV31 = cq4Day1Opener.isOpener(entry.run.scenario) &&
        ["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id) &&
        (entry.run.spatial?.player_location === "utility-room" || entry.run.spatial?.player_location === "threshold-side-entry");
      const radioAvailable = radioCheckPhase || isOpenerReturnAtKV31 || (q4Equipment.stateUsable(radio) && radio.holder === playerId && radio.charges > 0);
      if (cq4Day1Opener.isOpener(entry.run.scenario) && cq4Day1Opener.isCutoffExceeded(entry.run)) {
        const reason = "Standard communication line is dead. Operational cutoff exceeded.";
        communicationRuntime.failRadio(expedition, { sender: playerId, recipient: "Standard", text: message, reason });
        q4Interactions.record(expedition, { channel, speaker: "You", targets: ["Standard"], player_text: message, attempted_behavior: "transmit over the survey radio", eligibility: "radio-unavailable", delivery: "not-delivered", presentation: { result: reason } });
        try {
          this.persistSession(world, "field-researcher", entry);
        } catch (persistError) {
          for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
          for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
          entry.run._world = world; entry.phase = beforePhase;
          return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
        }
        return publicError("STANDARD_UNAVAILABLE", reason);
      }
      if (!["STANDARD_RADIO_CHECK", "FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id) || !radioAvailable || (!radioCheckPhase && !isOpenerReturnAtKV31 && !q4Radio.available(expedition))) {
        const reason = entry.phase?.phase_id === "BRIEFING" ? "The field radio channel is not active during briefing." : entry.phase?.phase_id === "STAGING" ? "Standard remains unavailable until the radio-check phase." : entry.phase?.phase_id === "THRESHOLD" ? "Complete the approach before establishing radio contact." : "The Standard radio channel is not available from here.";
        communicationRuntime.failRadio(expedition, { sender: playerId, recipient: "Standard", text: message, reason });
        q4Interactions.record(expedition, { channel, speaker: "You", targets: ["Standard"], player_text: message, attempted_behavior: "transmit over the survey radio", eligibility: "radio-unavailable", delivery: "not-delivered", presentation: { result: "The radio channel is not available from this operational context." } });
        try {
          this.persistSession(world, "field-researcher", entry);
        } catch (persistError) {
          for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
          for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
          entry.run._world = world; entry.phase = beforePhase;
          return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
        }
        return publicError("STANDARD_UNAVAILABLE", reason);
      }
      if (!radioCheckPhase && !isOpenerReturnAtKV31) {
        const used = q4Equipment.use(expedition, "survey-radio", playerId);
        if (!used.ok) return publicError("STANDARD_UNAVAILABLE", "The Standard radio channel could not begin the transmission.");
      }
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
        if (!radioCheckPhase && entry.phase?.phase_id === "FIELD_OPERATION") {
          q4Trajectories.noteCommunication({ world, expedition, run_id: entry.run.run_id, channel: "standard", delivered: true, text: message });
        }
        if (/\b(entity|form|figure|voice|sound|discrepancy|structure|humanoid|unidentified)\b/i.test(message)) for (const observation of phenomenonEcology.projection(world,{observer:playerId,location_id:entry.run.spatial.player_location})) { const item=phenomenonEcology.resolveObservedTarget(world,{observer:playerId,location_id:entry.run.spatial.player_location,target:observation.designation}); if(item)phenomenonEcology.deliverReport(world,item.id,{observer:playerId,message_id:resolvedMessage.id,summary:message,include_alias:message.toLowerCase().includes(String(observation.alias??"").toLowerCase())&&Boolean(observation.alias),at:resolvedMessage.delivered_at??expedition.clock.interval}); }
        if (cq4Day1Opener.isOpener(entry.run.scenario) && ["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id)) {
          const loc = entry.run.spatial?.player_location;
          if (loc === "utility-room" || loc === "threshold-side-entry") {
            entry.run.expedition.day1_opener ??= {};
            entry.run.expedition.day1_opener.return_surveillance_verified = true;
            presentationBus.emit(entry.run, {
              type: presentationBus.EVENT_TYPES.RADIO,
              source: presentationBus.SOURCES.AUTHORED_VARIANT,
              speaker: "CONTROL ROOM",
              recipient: "Clear-Q4 team",
              channel: "STANDARD",
              text: "I've got you from here. I'm logging the return this time. Don't count on somebody having eyes on you next time."
            });
          }
        }
      }
      const delivery = actuallyDelivered ? "delivered" : resolvedMessage.state === "delayed" ? "delayed" : "queued";
      const interaction = q4Interactions.record(expedition, { channel, speaker: "You", targets: ["Standard"], player_text: message, attempted_behavior: "transmit over the survey radio", eligibility: "eligible", delivery, time_cost: 1, canonical_effects: ["communication.sent"], observer_knowledge: actuallyDelivered ? [{ observer: "Standard", kind: "reported-communication", text: message }] : [], submission_id: requestId, presentation: { result: delivery } });
      if (radioCheckPhase && resolvedMessage.state === "acknowledged") q4Interactions.record(expedition, { channel, speaker: "STANDARD", targets: ["Clear-Q4 team"], player_text: "Standard acknowledgment received for Radio check.", attempted_behavior: "scheduled radio-check acknowledgment", eligibility: "eligible", delivery: "received", canonical_effects: ["q4.radio.check.acknowledged"], presentation: { result: "received" } });
      const missionUpdates = [...cycle.mission_updates, ...(acknowledgmentCycle?.mission_updates ?? [])];
      if (cq4Day1Opener.isOpener(entry.run.scenario)) {
        const duration = radioCheckPhase
          ? cq4Day1Opener.getActionDuration("RADIO_CHECK")
          : cq4Day1Opener.getActionDuration("COMMUNICATE", { length: message.length > 100 ? "extended" : message.length < 25 ? "brief" : "normal" });
        cq4Day1Opener.advanceSimulationTime(entry.run, duration);
      }
      const radioPlayerEvent = presentationBus.createDialogueEvent({
        submission_id: requestId,
        speaker_id: playerId,
        speaker_name: "YOU",
        speaker_title: "EXPEDITION LEAD",
        recipient_type: "broadcast",
        recipient_id: "standard-operations",
        recipient_name: "STANDARD DESK",
        channel: "STANDARD",
        text: message,
        kind: "radio",
        source: presentationBus.SOURCES.DETERMINISTIC,
        interval: expedition.clock.interval,
        delivery: actuallyDelivered ? "delivered" : "not-delivered"
      });
      entry.run.expedition.dialogue_history ??= [];
      entry.run.expedition.dialogue_history.push(radioPlayerEvent);
      presentationBus.emit(entry.run, {
        type: presentationBus.EVENT_TYPES.RADIO,
        source: presentationBus.SOURCES.DETERMINISTIC,
        speaker: "You",
        recipient: "Standard",
        channel: "STANDARD",
        text: message
      });
      if (radioCheckPhase && resolvedMessage.state === "acknowledged") {
        const standardAckEvent = presentationBus.createDialogueEvent({
          submission_id: requestId,
          speaker_id: "standard-operations",
          speaker_name: "STANDARD DESK",
          speaker_title: "Operations Authority",
          recipient_type: "broadcast",
          recipient_id: playerId,
          recipient_name: "YOU",
          channel: "STANDARD",
          text: "Standard acknowledgment received for Radio check.",
          kind: "radio",
          source: presentationBus.SOURCES.DETERMINISTIC,
          interval: expedition.clock.interval,
          delivery: "delivered"
        });
        entry.run.expedition.dialogue_history.push(standardAckEvent);
        presentationBus.emit(entry.run, {
          type: presentationBus.EVENT_TYPES.RADIO,
          source: presentationBus.SOURCES.DETERMINISTIC,
          speaker: "STANDARD",
          recipient: "Clear-Q4 team",
          channel: "STANDARD",
          text: "Standard acknowledgment received for Radio check."
        });
      }
      if (entry.run?.spatial && ["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id)) {
        const spatialDefRadio = bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id);
        try { decisionScheduler.scheduleDecisions(entry.run, spatialDefRadio, world); } catch (schedulerError) { this.log(`decision scheduler non-fatal: ${schedulerError.message}`); }
        try { this.processAutonomousSpeech(world.world_id, entry.run.run_id); } catch (speechSchedulerError) { this.log(`speech scheduler non-fatal: ${speechSchedulerError.message}`); }
      }
      const publicReason = resolvedMessage.state === "delayed" ? resolvedMessage.interference?.public_description ?? "The transmission is delayed; no delivery confirmation has been received." : actuallyDelivered ? "The transmission was delivered. Standard acknowledgment remains separately recorded." : "The transmission is queued; delivery has not been confirmed.";
      const scene = this.sceneFor(entry, "field-researcher", { scene_type: "delta", accepted: true, action: "STANDARD", public_reason: publicReason }, world);
      const output = { ok: true, result: { outcome: resolvedMessage.state, public_reason: publicReason, message: { id: resolvedMessage.id, state: resolvedMessage.state }, mission_updates: missionUpdates, operational_updates: cycle.public_updates, scene }, projection: this.projectionFor(world, "field-researcher", entry) };
      if (requestId) {
        const receipt = {
          id: requestId,
          submission_id: requestId,
          input_fingerprint: fingerprint,
          run_id: entry.run.run_id,
          interval: expedition.clock.interval,
          channel,
          target: target ?? null,
          text: message,
          delivery: resolvedMessage.state,
          status: "completed",
          public_reason: publicReason,
          presentation_source: "deterministic",
          scene: clone(scene),
          cached_result: { ok: true, result: clone(output.result) }
        };
        entry.run.expedition.communication_receipts ??= [];
        entry.run.expedition.communication_receipts.push(receipt);
      }
      try {
        this.persistSession(world, "field-researcher", entry);
      } catch (persistError) {
        for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
        for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return output;
    } catch (error) {
      if (entry?.run && beforeRun) {
        for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
        for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
      }
      this.log(`Q4 communication failed: ${error.message}`);
      if (error.code === "PERSISTENCE_COMMIT_FAILED" || error.code?.includes("PERSISTENCE")) {
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return publicError("COMMUNICATION_RUNTIME_ERROR", "The communication could not be resolved safely.");
    }
  }
  submitQ4Handoff({ world_id, item_id, target = null }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (outcomes.isRetired(this.getWorld(world_id))) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
    let entry = null; let world = null; let beforeRun = null; let beforeWorld = null; let beforePhase = null;
    try {
      world = this.getWorld(world_id); entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before handing over equipment.");
      beforeRun = clone(entry.run); beforeWorld = clone(world); beforePhase = clone(entry.phase);
      const player = entry.run.session.startup.player.observer_id; const coworkers = entry.run.expedition.team.members.filter((member) => member.personnel_id !== player); const targetText = String(target ?? "").toLowerCase(); const key = entry.run.expedition.equipment[item_id] ? item_id : Object.entries(entry.run.expedition.equipment).find(([, item]) => item.id === item_id)?.[0]; const item = entry.run.expedition.equipment[key];
      const isPlayerTarget = ["player", "you", String(player).toLowerCase()].includes(targetText) || targetText === String(entry.run.session?.startup?.player?.observer_id).toLowerCase() || targetText === String(entry.run.expedition.team.members[0]?.identity).toLowerCase() || targetText === String(entry.run.expedition.team.members[0]?.personnel_id).toLowerCase();
      if (isPlayerTarget) {
        if (entry.phase?.phase_id !== "STAGING") return publicError("HANDOFF_TARGET_UNAVAILABLE", "Coworker-to-player custody reassignment is available during accountable staging only.");
        const source = coworkers.find((member) => member.personnel_id === item?.holder); if (!source) return publicError("HANDOFF_SOURCE_UNAVAILABLE", "No assigned coworker holds that equipment for staging reassignment.");
        const transferred = logisticsRuntime.transact(entry.run.expedition, bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id, entry.run.scenario), { action:"HAND_OVER", item_id:key, actor:source.personnel_id, target_holder:player }, this.q4LogisticsContext(entry, world));
        if (!transferred.ok) return publicError(transferred.code, transferred.public_reason);
        q4Interactions.record(entry.run.expedition, { channel:"action", speaker:"You", targets:[source.display_name], player_text:`accept custody of ${transferred.item.display_name} during staging`, attempted_behavior:"reassign staged equipment custody to the controlled worker", eligibility:"eligible", delivery:"transferred", time_cost:1, canonical_effects:["equipment.handoff"], presentation:{ result:"transferred" } });
        history.event(world, entry.run.run_id, "q4.equipment.handed_over", { equipment_id:transferred.item.instance_id, from:source.personnel_id, to:player }); personnelContinuity.recordCustody(world, { run_id:entry.run.run_id, equipment_id:transferred.item.instance_id, from:source.personnel_id, to:player, at:entry.run.expedition.clock?.interval ?? 0 }); if (entry.run.spatial) spatialRuntime.syncEquipment(entry.run.spatial, entry.run.expedition); const cycle = bootstrap.resolveOperationalCycle(entry.run, "HANDOFF", 1, "staging-equipment-handoff");
        try {
          this.persistSession(world, "field-researcher", entry);
        } catch (persistError) {
          for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
          for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
          entry.run._world = world; entry.phase = beforePhase;
          return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
        }
        return { ok:true, result:{ outcome:"succeeded", public_reason:`You take accountable custody of the ${transferred.item.display_name} from ${source.first_name}.`, time_advanced:cycle.clock.cost, mission_updates:cycle.mission_updates }, projection:this.projectionFor(world, "field-researcher", entry) };
      }
      const peer = coworkers.find((member) => [member.personnel_id, member.first_name, member.display_name].filter(Boolean).some((value) => String(value).toLowerCase() === targetText)) ?? coworkers[0]; const peerPerson = history.character(world, peer?.personnel_id ?? peer?.id); const observed = q4Personnel.observerStatus(peer, peerPerson, entry.phase?.phase_id, entry.run.spatial, player);
      const validTarget = observed.local_eligible && [peer?.personnel_id, peer?.first_name, peer?.display_name, "team", "teammate"].filter(Boolean).map((value) => String(value).toLowerCase()).includes(targetText || String(peer?.first_name ?? "").toLowerCase());
      if (!validTarget) return publicError("HANDOFF_TARGET_UNAVAILABLE", "That person is not available for a physical handoff here.");
      const transferred = logisticsRuntime.transact(entry.run.expedition, bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id, entry.run.scenario), { action: "HAND_OVER", item_id: key, actor: player, target_holder: peer.personnel_id }, this.q4LogisticsContext(entry, world));
      if (!transferred.ok) return publicError(transferred.code, transferred.public_reason);
      q4Interactions.record(entry.run.expedition, { channel: "action", speaker: "You", targets: [peer.display_name], player_text: `hand over ${transferred.item.display_name}`, attempted_behavior: "physically hand equipment to a nearby teammate", eligibility: "eligible", delivery: "transferred", time_cost: 1, canonical_effects: ["equipment.handoff"], presentation: { result: "transferred" } });
      history.event(world, entry.run.run_id, "q4.equipment.handed_over", { equipment_id: transferred.item.instance_id, from: player, to: peer.personnel_id }); personnelContinuity.recordCustody(world, { run_id: entry.run.run_id, equipment_id: transferred.item.instance_id, from: player, to: peer.personnel_id, at: entry.run.expedition.clock?.interval ?? 0 }); personnelContinuity.recordSharedHistory(world, { run_id: entry.run.run_id, participants: [player, peer.personnel_id], kind: "equipment-transferred", refs: { equipment_id: transferred.item.instance_id }, at: entry.run.expedition.clock?.interval ?? 0 }); if (entry.run.spatial) spatialRuntime.syncEquipment(entry.run.spatial, entry.run.expedition); const cycle = bootstrap.resolveOperationalCycle(entry.run, "HANDOFF", 1, "equipment-handoff");
      try {
        this.persistSession(world, "field-researcher", entry);
      } catch (persistError) {
        for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
        for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return { ok: true, result: { outcome: "succeeded", public_reason: `${peer.first_name} takes the ${transferred.item.display_name}.`, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) {
      if (entry?.run && beforeRun) {
        for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
        for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
      }
      this.log(`Q4 handoff failed: ${error.message}`);
      if (error.code === "PERSISTENCE_COMMIT_FAILED" || error.code?.includes("PERSISTENCE")) {
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return publicError("HANDOFF_RUNTIME_ERROR", "The physical handoff could not be resolved safely.");
    }
  }
  selectQ4OptionalStore({ world_id, item_id }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    let entry = null; let world = null; let beforeRun = null; let beforeWorld = null; let beforePhase = null;
    try {
      world = this.getWorld(world_id); entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before selecting stores.");
      if (entry.phase?.phase_id !== "STAGING") return publicError("STAGING_REQUIRED", "Optional stores can only be selected during staging.");
      beforeRun = clone(entry.run); beforeWorld = clone(world); beforePhase = clone(entry.phase);
      const selected = logisticsRuntime.transact(entry.run.expedition, bootstrap.logisticsDefinitionFor(entry.run.spatial_pack_id, entry.run.scenario), { action: "RETRIEVE", item_id, actor: entry.run.session.startup.player.observer_id }, this.q4LogisticsContext(entry, world));
      if (!selected.ok) return publicError(selected.code, selected.public_reason);
      expeditionEvent(entry.run.expedition, "q4.loadout.optional_selected", { equipment_id: selected.item.instance_id, type: selected.item.category });
      bootstrap.evaluateMissionState(entry.run, entry.phase?.phase_id);
      try {
        this.persistSession(world, "field-researcher", entry);
      } catch (persistError) {
        for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
        for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return { ok: true, result: { outcome: "succeeded", public_reason: `${selected.item.display_name} added to the field loadout.` }, projection: this.projectionFor(world, "field-researcher", entry) };
    } catch (error) {
      if (entry?.run && beforeRun) {
        for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
        for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
      }
      this.log(`Q4 store selection failed: ${error.message}`);
      if (error.code === "PERSISTENCE_COMMIT_FAILED" || error.code?.includes("PERSISTENCE")) {
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return publicError("STAGING_RUNTIME_ERROR", "The optional store could not be selected safely.");
    }
  }
  beginQ4CheckInHold({ world_id, actor = null } = {}) {
    if (!world_id) return publicError("INVALID_ARGUMENT", "world_id is required.");
    const existing = this.checkInHolds.get(world_id);
    if (existing) {
      return { ok: true, hold_started_at: existing.startTime, actor: existing.actor };
    }
    const now = this.now();
    this.checkInHolds.set(world_id, { startTime: now, actor });
    return { ok: true, hold_started_at: now, actor };
  }

  cancelQ4CheckInHold({ world_id } = {}) {
    if (!world_id) return publicError("INVALID_ARGUMENT", "world_id is required.");
    this.checkInHolds.delete(world_id);
    return { ok: true, cancelled: true };
  }

  completeQ4CheckInHold({ world_id } = {}) {
    if (!world_id) return publicError("INVALID_ARGUMENT", "world_id is required.");
    const hold = this.checkInHolds.get(world_id);
    if (!hold) {
      return publicError("CHECK_IN_HOLD_REQUIRED", "No radio check-in hold was initiated.");
    }
    const now = this.now();
    const elapsed = now - hold.startTime;
    this.checkInHolds.delete(world_id);
    if (elapsed < 2000) {
      return {
        ok: false,
        error: {
          code: "CHECK_IN_HOLD_INSUFFICIENT",
          message: "Formal radio check-in requires a 2-second continuous hold on the check-in control."
        },
        code: "CHECK_IN_HOLD_INSUFFICIENT",
        elapsed_ms: elapsed
      };
    }
    return this.executeQ4CheckIn(world_id, elapsed);
  }

  submitQ4CheckIn({ world_id, hold_duration_ms = null } = {}) {
    if (this.checkInHolds.has(world_id)) {
      // Service hold takes strict precedence: ignore client-supplied duration
      return this.completeQ4CheckInHold({ world_id });
    }
    const durationMs = Number(hold_duration_ms ?? 0);
    if (!Number.isFinite(durationMs) || durationMs < 2000) {
      return publicError("CHECK_IN_HOLD_INSUFFICIENT", "Formal radio check-in requires a 2-second continuous hold on the check-in control.");
    }
    return this.executeQ4CheckIn(world_id, durationMs);
  }

  executeQ4CheckIn(world_id, durationMs) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (outcomes.isRetired(this.getWorld(world_id))) return publicError("WORLD_RETIRED", "This world is a read-only historical record.");
    try {
      const world = this.getWorld(world_id);
      const entry = this.session(world_id, "field-researcher") ?? this.restoreSession(world, "field-researcher", readJson(this.sessionFile(world_id, "field-researcher"), null));
      if (!entry || entry.kind !== "bootstrap") return publicError("SESSION_NOT_FOUND", "Start or continue Clear-Q4 before checking in.");
      const beforeRun = clone(entry.run); const beforeWorld = clone(world); const beforePhase = clone(entry.phase);

      const expedition = entry.run.expedition;
      const playerId = entry.run.session.startup.player.observer_id;
      const radio = expedition.equipment?.["survey-radio"];
      const allowedPhases = ["STANDARD_RADIO_CHECK", "FIELD_OPERATION", "RETURN"];
      const radioCheckPhase = entry.phase?.phase_id === "STANDARD_RADIO_CHECK";
      if (!radioCheckPhase && (!allowedPhases.includes(entry.phase?.phase_id) || !q4Equipment.stateUsable(radio) || radio.holder !== playerId || radio.charges <= 0)) {
        return publicError("RADIO_UNAVAILABLE", "The survey radio is not usable or not in your custody.");
      }

      if (!radioCheckPhase && !q4Radio.available(expedition)) {
        return publicError("RADIO_OUT_OF_RANGE", "Radio check-in failed: No operational signal reaching Standard.");
      }

      const playerLoc = entry.run.spatial?.player_location ?? "unknown";
      const interval = expedition.clock?.interval ?? 0;
      const now = this.now();

      presentationBus.emit(entry.run, {
        type: presentationBus.EVENT_TYPES.AUDIO_CUE,
        cue: "radio_tx_chirp",
        source: presentationBus.SOURCES.DETERMINISTIC,
        text: "*radio chirp*",
        channel: "STANDARD"
      });

      expedition.last_check_in = {
        source: "formal_radio_check_in",
        interval,
        timestamp: now,
        location: playerLoc,
        sender: playerId,
        hold_duration_ms: durationMs
      };

      if (expedition.day1_opener) {
        expedition.day1_opener.last_check_in_time = now;
        expedition.day1_opener.check_in_held_seconds = durationMs / 1000;
      }

      if (radioCheckPhase) {
        expedition.radio_check_completed = true;
        q4Radio.completeCheck(expedition);
        expeditionEvent(expedition, "q4.radio_check.completed", { endpoint: "Standard", method: "formal-check-in" });
        history.event(world, entry.run.run_id, "q4.radio_check.completed", { endpoint: "Standard", status: "acknowledged", method: "formal-check-in" });
      }

      const pendingCheckIn = expedition.communications?.check_ins?.find((item) => !["completed", "waived"].includes(item.state));
      if (pendingCheckIn) {
        communicationRuntime.completeCheckIn(expedition, { id: `check-in-msg-${now}`, check_in_id: pendingCheckIn.id, sender: playerId, intended_recipient: "Standard" });
      }

      const checkInMsg = {
        id: `check-in-transmission-${now}`,
        state: "acknowledged",
        intended_recipient: "Standard",
        sender: playerId,
        purpose: "formal-check-in",
        delivered_at: interval
      };
      standardOperator.recordContact(world, entry.run, checkInMsg);

      const locallyPresentPersonnel = q4Personnel.publicTeam(entry.run, entry.phase?.phase_id, world).filter((member) => !member.controlled && member.local_eligible);
      for (const member of locallyPresentPersonnel) {
        const mId = member.personnel_id ?? member.id;
        if (mId) {
          personnelContinuity.recordAttitudeChange(world, {
            run_id: entry.run.run_id,
            identity: mId,
            target_id: playerId,
            delta: { trust: 4, rapport: 3 },
            reason: "Completed formal radio check-in with Standard.",
            at: interval
          });
        }
      }

      q4Interactions.record(expedition, {
        channel: "standard",
        speaker: "You",
        targets: ["Standard"],
        player_text: `[FORMAL CHECK-IN: ${durationMs}ms hold]`,
        attempted_behavior: "formal radio check-in",
        eligibility: "eligible",
        delivery: "acknowledged",
        time_cost: 0,
        canonical_effects: ["q4.radio.check_in.recorded"],
        presentation: { result: "acknowledged" }
      });

      presentationBus.emit(entry.run, {
        type: presentationBus.EVENT_TYPES.RADIO,
        source: presentationBus.SOURCES.DETERMINISTIC,
        speaker: "STANDARD",
        recipient: "Clear-Q4 team",
        channel: "STANDARD",
        text: "Standard acknowledges formal check-in. Time and location logged."
      });

      try {
        this.persistSession(world, "field-researcher", entry);
      } catch (persistError) {
        for (const key of Object.keys(world)) delete world[key]; Object.assign(world, beforeWorld);
        for (const key of Object.keys(entry.run)) delete entry.run[key]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
        return publicError("PERSISTENCE_COMMIT_FAILED", "The check-in could not be saved and was not committed. Check the operation record storage before retrying.");
      }

      return {
        ok: true,
        result: {
          outcome: "check-in-acknowledged",
          public_reason: "Standard acknowledged formal radio check-in.",
          check_in: clone(expedition.last_check_in)
        },
        projection: this.projectionFor(world, "field-researcher", entry)
      };
    } catch (error) {
      this.log(`Q4 check-in failed: ${error.message}`);
      return publicError("CHECK_IN_FAILED", "Formal check-in could not be completed safely.");
    }
  }
  submitAction({ world_id, mode, action, target = null }) {
    if (this.commandBusy(world_id)) return publicError("SESSION_BUSY", "Wait for the current action to finish before changing this operation.");
    if (this.recoveredWorlds.has(world_id)) return publicError("PERSISTENCE_RECOVERY_READ_ONLY", "This verified previous record is available for inspection only until it is explicitly restored.");
    let world = null; let entry = null; let beforeRun = null; let beforeWorld = null; let beforePhase = null;
    try {
      world = this.getWorld(world_id); if (outcomes.isRetired(world)) return publicError("WORLD_RETIRED", "This world is a read-only historical record."); entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null)); if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue a session first.");
      beforeRun = clone(entry.run); beforeWorld = clone(world); beforePhase = clone(entry.phase);
      const verb = String(action ?? "").toUpperCase(); let result; if (entry.kind === "bootstrap") { entry.run._last_mission_updates = []; entry.run._active_submission_id = `player-submission-${crypto.createHash("sha256").update(JSON.stringify([entry.run.run_id, entry.run.expedition.interaction_history?.length ?? 0, verb, target ?? null])).digest("hex").slice(0, 18)}`; }
      if (entry.kind === "bootstrap" && verb === "ADVANCE_OPERATIONS") return this.advanceQ4Operations({ world_id });
      if (entry.kind === "bootstrap" && (verb === "COMPLETE_BROADCAST" || verb === "RELEASE_FEED")) {
        return this.completeBriefingBroadcast({ world_id });
      }
      if (entry.kind === "bootstrap" && verb === "START_BROADCAST") {
        return this.startBriefingBroadcast({ world_id });
      }
      if (entry.kind === "bootstrap" && (verb === "START_BRIEFING" || verb === "ATTEND_BRIEFING")) {
        return this.startPersonnelBriefing({ world_id });
      }
      if (entry.kind === "bootstrap" && (verb === "CONCLUDE_BRIEFING" || verb === "END_BRIEFING")) {
        return this.concludePersonnelBriefing({ world_id });
      }
      if (entry.kind === "bootstrap" && (verb === "CONTINUE_BRIEFING" || verb === "CONTINUE_LISTENING" || verb === "LISTEN")) {
        return this.interactPersonnelBriefing({ world_id, text: "continue" });
      }
      if (entry.kind === "bootstrap" && verb === "COMMUNICATE") return publicError("PLAYER_TRANSMISSION_REQUIRED", "Type and deliberately submit your own message in the communication composer.");
      if (entry.kind === "bootstrap" && ["DEPLOY", "READY", "PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION"].includes(verb)) {
        const phase = entry.phase?.phase_id;
        if (verb === "READY" && phase === "BRIEFING" && cq4Day1Opener.isOpener(entry.run.scenario)) {
          if (!cq4Day1Opener.isBroadcastCompleted(entry.run)) {
            return publicError("BROADCAST_IN_PROGRESS", "The facility broadcast is in progress. Await conclusion of the broadcast before proceeding to equipment staging.");
          }
          const briefingStatus = entry.run?.expedition?.day1_opener?.personnel_briefing?.status;
          if (briefingStatus === "active") {
            return publicError("BRIEFING_IN_PROGRESS", "Dr. Kirk Maxwell's briefing is in progress. Conclude the briefing before proceeding to equipment staging.");
          }
          if (briefingStatus === "pending") {
            this.concludePersonnelBriefing({ world_id });
          }
        }
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
              if (cq4Day1Opener.isOpener(entry.run.scenario)) {
                if (!cq4Day1Opener.isOneShotConsumed(entry.run, "crossing_cutscene")) {
                  cq4Day1Opener.markOneShotConsumed(entry.run, "crossing_cutscene");
                }
                if (!cq4Day1Opener.isOneShotConsumed(entry.run, "complex_acoustic_transition")) {
                  const acousticEvent = {
                    type: "crossing_acoustic_shift",
                    facility_ambient_cut: true,
                    metallic_tone: true,
                    complex_hum: true,
                    near_ringing: true,
                    source: presentationBus.SOURCES.DETERMINISTIC,
                    cue: "crossing_acoustic_shift",
                    details: {
                      facility_ambience: "cut",
                      threshold_tone: true,
                      footstep: true,
                      fluorescent_hum: true,
                      near_ringing: true,
                      music: false
                    },
                    text: "Standard-side environmental bed ceases. Low fluorescent hum and Threshold acoustics commence."
                  };
                  presentationBus.emit(entry.run, acousticEvent);
                  presentationBus.emit(entry.run, { ...acousticEvent, type: "complex_acoustic_transition" });
                  cq4Day1Opener.markOneShotConsumed(entry.run, "complex_acoustic_transition");
                }
              }
            }
            else q4Radio.authorize(entry.run.expedition, "legacy-threshold-crossed");
            q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id);
          }
        } else {
          result = { ok: true, outcome: "phase-advanced" };
          if (verb === "PROCEED") { const readiness = q4Equipment.projection(entry.run.expedition, entry.run.session.startup.player.observer_id); if (!readiness.readiness) { entry.run.expedition.deviations.push("proceeded-with-required-equipment-unavailable"); expeditionEvent(entry.run.expedition, "q4.loadout.proceeded_without_required", { missing: readiness.missing }); } }
          const advanced = q4.nextPhase(entry.phase, { action: verb, legacy_flow: legacyFlow }); if (!advanced.ok) return publicError(advanced.code, "The expedition cannot advance from its current state."); entry.phase = advanced.phase; bootstrap.setSpatialPhase(entry.run, entry.phase.phase_id); if (entry.phase.phase_id === "STAGING" && cq4Day1Opener.isOpener(entry.run.scenario)) entry.run.expedition.day1_opener.esd_handoff = { status:"equipment-cooperation", destination:"Equipment Services Division", player_dialogue_input:"paused", coworker_activity:"active" }; if (entry.phase.phase_id === "STANDARD_RADIO_CHECK") q4Radio.authorize(entry.run.expedition); q4Equipment.updatePhase(entry.run.expedition, entry.phase.phase_id);
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
      if (!result.ok) {
        if (entry.run?.expedition?.day1_opener?.catastrophic_ending) {
          try {
            this.persistSession(world, mode, entry);
          } catch (persistError) {
            this.log(`catastrophic persist error: ${persistError.message}`);
            if (entry?.run && beforeRun) {
              if (world && beforeWorld) { for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld); }
              for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
              entry.run._world = world; entry.phase = beforePhase;
            }
            return publicError("PERSISTENCE_COMMIT_FAILED", "The catastrophic outcome could not be saved and was not committed. Check the operation record storage before retrying.");
          }
        }
        return publicError(result.error?.code ?? result.code ?? "ACTION_REJECTED", result.error?.public_reason ?? result.result?.public_reason ?? result.public_reason ?? "That action is not available right now.");
      }
      if (entry.kind === "bootstrap" && q4Radio.ensure(entry.run.expedition).check_completed && !q4Interactions.history(entry.run.expedition, "standard").some((item) => item.attempted_behavior === "scheduled radio-check acknowledgment")) {
        const acknowledged = entry.run.expedition.messages?.find((item) => item.purpose === "radio-check" && item.state === "acknowledged");
        if (acknowledged) q4Interactions.record(entry.run.expedition, { channel: "standard", speaker: "STANDARD", targets: ["Clear-Q4 team"], player_text: "Standard acknowledgment received for Radio check.", attempted_behavior: "scheduled radio-check acknowledgment", eligibility: "eligible", delivery: "received", canonical_effects: ["q4.radio.check.acknowledged"], presentation: { result: "received" } });
      }
      if (entry.kind === "bootstrap") {
        if (cq4Day1Opener.isOpener(entry.run.scenario)) {
          const duration = cq4Day1Opener.getActionDuration(verb, { target });
          cq4Day1Opener.advanceSimulationTime(entry.run, duration);
        }
        this.recordQ4Action(entry, `${verb}${target ? ` ${target}` : ""}`, result, world, entry.run._active_submission_id);
        this.finishQ4Action(world, entry, verb, result);
        const actionNarration = result.result?.public_reason ?? result.public_reason ?? null;
        if (actionNarration) {
          presentationBus.emit(entry.run, {
            type: presentationBus.EVENT_TYPES.INTERPRETATION,
            source: presentationBus.SOURCES.DETERMINISTIC,
            text: actionNarration
          });
        }
      }
      const missionUpdates = result.result?.mission_updates ?? entry.run?._last_mission_updates ?? [];
      const mortality = entry.kind === "bootstrap" ? outcomes.resolve(world, entry.run, { cause: result.result?.consequence_id ?? result.outcome ?? verb }) : null;
      // Advance deterministic actor decision scheduler before persistence so coworker state is committed atomically
      if (entry.kind === "bootstrap" && entry.run.spatial && ["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id)) {
        const spatialDef = bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id);
        try { decisionScheduler.scheduleDecisions(entry.run, spatialDef, world); } catch (schedulerError) { this.log(`decision scheduler non-fatal: ${schedulerError.message}`); }
        try { this.processAutonomousSpeech(world.world_id, entry.run.run_id); } catch (speechSchedulerError) { this.log(`speech scheduler non-fatal: ${speechSchedulerError.message}`); }
      }
      try {
        if (mortality?.player_deceased) this.persistTerminalRetirement(world, mode, entry);
        else this.persistSession(world, mode, entry);
      } catch (persistError) {
        if (entry?.run && beforeRun) {
          if (world && beforeWorld) { for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld); }
          for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
          entry.run._world = world; entry.phase = beforePhase;
        }
        this.log(`submitAction persistence failed: ${persistError.message}`);
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      const scene = this.sceneFor(entry, mode, { action: verb, scene_type: verb === "LOOK" ? "observation" : "delta", accepted: true, public_reason: result.result?.public_reason ?? result.public_reason }, world);
      return { ok: true, result: { outcome: result.outcome ?? "succeeded", public_reason: result.result?.public_reason ?? result.public_reason ?? null, mission_updates: missionUpdates, scene }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) {
      if (entry?.run && beforeRun) {
        if (world && beforeWorld) { for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld); }
        for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
      }
      this.log(`action failed: ${error.message}`);
      if (error.code === "PERSISTENCE_COMMIT_FAILED" || error.code === "SESSION_SAVE_INVALID" || error.code === "SESSION_VALUE_INVALID" || error.code?.includes("PERSISTENCE")) {
        return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
      }
      return publicError("ACTION_RUNTIME_ERROR", "Yellow Beast could not complete that action safely.");
    }
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
          if ((referenceExpedition.isReference(entry.run.scenario) || cq4Day1Opener.isOpener(entry.run.scenario)) && !entry.run.expedition.written_report) {
            const reportPhase = phases.transition(entry.phase, "REPORT", { reason:"evidence-custody-complete", guard:true });
            if (reportPhase.ok) entry.phase = reportPhase.phase;
            result.result = { ...(result.result ?? {}), public_reason:"Returned evidence entered ASync custody. Submit your written account before institutional review." };
          } else this.finalizeQ4Closure(world, entry);
        }
  }
  commandBusy(worldId) {
    if (this.transactionContext?.getStore() === worldId || this.naturalCommandContext?.getStore() === worldId) {
      return false;
    }
    return this.naturalTurnInflight.has(worldId) || this.communicationTurnInflight.has(worldId);
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
    if (this.commandBusy(world_id)) {
      return publicError("SESSION_BUSY", "The previous action is still being resolved. Wait for its result before submitting another action.");
    }
    const promise = Promise.resolve().then(() => this.transactionContext.run(world_id, () => this.submitNaturalInternal({ ...input, request_id:requestId, input_fingerprint:fingerprint })));
    this.naturalTurnInflight.set(world_id, { id:requestId, fingerprint, promise });
    try { return await promise; } finally { this.naturalTurnInflight.delete(world_id); this.giveAutonomousSpeechAnotherChance(world_id); }
  }
  async submitNaturalInternal({ world_id, mode, text, request_id, input_fingerprint }) {
    let world = null; let entry = null; let beforeRun = null; let beforeWorld = null; let beforePhase = null;
    try {
      if (!this.authorityRegistry.healthy) return publicError("AUTHORITY_UNAVAILABLE", "Authoritative interpretation sources are unavailable. Continue with structured controls while the installation is repaired.");
      world = this.getWorld(world_id);
      entry = this.session(world_id, mode) ?? this.restoreSession(world, mode, readJson(this.sessionFile(world_id, mode), null));
      if (!entry) return publicError("SESSION_NOT_FOUND", "Start or continue this session first.");
      beforeRun = clone(entry.run); beforeWorld = clone(world); beforePhase = clone(entry.phase);
      const recorded = entry.run?.expedition?.natural_action_receipts?.find(receipt => receipt.id === request_id);
      if (recorded) {
        if (recorded.input_fingerprint !== input_fingerprint) return publicError("REQUEST_ID_REUSED", "That action reference belongs to a different instruction.");
        return { ok:true, result:{ turn_status:"RESOLVED", executed:false, duplicate:true, summary:recorded.public_reason ?? "This action has already been recorded." }, projection:this.projectionFor(world, mode, entry) };
      }
      if (entry.kind === "bootstrap" && mode === "field-researcher" && entry.phase?.phase_id === "REPORT") return this.submitReferenceWrittenReport({ world_id, text });
      if (entry.kind === "bootstrap" && mode === "field-researcher" && ["BRIEFING", "STAGING", "FACILITY_TRANSIT", "THRESHOLD", "STANDARD_RADIO_CHECK"].includes(entry.phase?.phase_id)) {
        const phaseId = entry.phase.phase_id;
        if (phaseId === "BRIEFING" && cq4Day1Opener.isOpener(entry.run?.scenario)) {
          const beat = entry.run?.expedition?.day1_opener?.beat;
          const briefingStatus = entry.run?.expedition?.day1_opener?.personnel_briefing?.status ?? "pending";
          if (beat === cq4Day1Opener.BEATS.PERSONNEL_BRIEFING) {
            if (briefingStatus === "pending") {
              return this.startPersonnelBriefing({ world_id });
            }
            if (briefingStatus === "active") {
              return this.interactPersonnelBriefing({ world_id, text });
            }
          }
        }
        const inputClass = interpretiveDirector.classifyInput(text, phaseId, entry.run);

        if (inputClass.classification === "PREFIELD_CLARIFICATION" || inputClass.classification === "PREFIELD_REFUSAL") {
          const question = "Please confirm the intended action separately. Your procedure has not advanced.";
          const scene = { ...this.sceneFor(entry, mode, { scene_type: "observation", accepted: false, public_reason: question }, world), narration: question, narration_source: "DETERMINISTIC" };
          return { ok: true, result: { turn_status: "CLARIFICATION_REQUIRED", clarification_required: true, clarification_question: question, executed: false, summary: question, scene }, projection: this.projectionFor(world, mode, entry) };
        }

        if (inputClass.classification === "ON_SCRIPT" && inputClass.targetAction) {
          const radioChecked = q4Radio.ensure(entry.run.expedition).check_completed;
          if (phaseId === "STANDARD_RADIO_CHECK" && inputClass.targetAction === "CROSS" && !radioChecked) {
            const warning = "Standard dispatch requires a completed radio check before Threshold crossing.";
            const scene = { ...this.sceneFor(entry, mode, { scene_type: "observation", accepted: false, public_reason: warning }, world), narration: warning, narration_source: "DETERMINISTIC" };
            return { ok: true, result: { turn_status: "CLARIFICATION_REQUIRED", clarification_required: true, clarification_question: warning, executed: false, summary: warning, scene }, projection: this.projectionFor(world, mode, entry) };
          }
          const actResult = this.submitAction({ world_id, mode, action: inputClass.targetAction });
          if (!actResult.ok) return actResult;
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
            presentationBus.emit(entry.run, {
              type: presentationBus.EVENT_TYPES.INTERPRETATION,
              source: authored ? authored.source : presentationBus.SOURCES.DETERMINISTIC,
              text: narration,
              chunk_id: authored?.chunk_id ?? null
            });
            const scene = { ...this.sceneFor(entry, mode, { scene_type: "delta", accepted: true, public_reason: narration }, world), narration, narration_source: authored ? authored.source : "DETERMINISTIC" };
            try {
              this.persistSession(world, mode, entry);
            } catch (persistError) {
              for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
              for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
              entry.run._world = world; entry.phase = beforePhase;
              return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
            }
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
            try {
              this.persistSession(world, mode, entry);
            } catch (persistError) {
              for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
              for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
              entry.run._world = world; entry.phase = beforePhase;
              return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
            }
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
            try {
              this.persistSession(world, mode, entry);
            } catch (persistError) {
              for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
              for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
              entry.run._world = world; entry.phase = beforePhase;
              return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
            }
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
          // Advance deterministic actor decision scheduler before canonical commit
          if (entry.run?.spatial && ["FIELD_OPERATION", "RETURN"].includes(entry.phase?.phase_id)) {
            const spatialDefNat = bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id);
            try { decisionScheduler.scheduleDecisions(entry.run, spatialDefNat, world); } catch (schedulerError) { this.log(`decision scheduler non-fatal: ${schedulerError.message}`); }
            try { this.processAutonomousSpeech(world.world_id, entry.run.run_id); } catch (speechSchedulerError) { this.log(`speech scheduler non-fatal: ${speechSchedulerError.message}`); }
          }
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
        let presentationPersisted = true;
        if (living.status === "resolved") {
          // Canonical consequences are already durable. Persist the completed
          // presentation history separately without misreporting a lost action.
          try { this.persistSession(world, mode, entry); }
          catch (error) { presentationPersisted = false; this.log(`presentation history save failed after canonical commit: ${error.message}`); }
        }
        const language_assistance = { ...summarizeLanguageAssistance(selected, living), presentation_persisted: presentationPersisted };
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
        if (/\b(drop|deliver|leave|set down|unload)\b/i.test(text) && /\b(bag|duffle|materials|startup|stores|kit)\b/i.test(text)) {
          const duffleId = "startup-materials-duffle";
          const duffle = entry.run.expedition?.logistics?.items?.[duffleId]
            ?? Object.values(entry.run.expedition?.logistics?.items ?? {}).find((i) => i.template === duffleId || i.definition_id === duffleId);
          const holder = duffle?.current_holder ?? entry.run.expedition?.team?.members?.[2]?.personnel_id;
          const dropResult = this.submitQ4Logistics({
            world_id,
            action: "DROP",
            item_id: duffle?.id ?? duffleId,
            actor: holder
          });
          if (dropResult.ok) {
            const isOutpost = entry.run.spatial?.player_location === "outpost-a";
            const memberObj = entry.run.expedition?.team?.members?.find((m) => m.personnel_id === holder);
            const speakerName = memberObj?.display_name ?? memberObj?.first_name ?? "Courier";
            const reply = isOutpost
              ? "I've set the startup materials duffle down beside the folding tables."
              : "I've set the duffle down here.";
            if (cq4Day1Opener.isOpener(entry.run.scenario)) {
              cq4Day1Opener.verifyDelivery(entry.run);
            }
            presentationBus.emit(entry.run, {
              type: presentationBus.EVENT_TYPES.DIALOGUE,
              source: presentationBus.SOURCES.DETERMINISTIC,
              speaker: speakerName,
              text: reply
            });
            return {
              ok: true,
              result: {
                turn_status: "RESOLVED",
                executed: true,
                summary: `${speakerName}: "${reply}"`,
                public_reason: `${speakerName}: "${reply}"`
              },
              projection: this.projectionFor(world, mode, entry)
            };
          }
        }
        if (entry.phase?.phase_id === "FIELD_OPERATION" && (/\b(begin return|initiate return|return procedure|start return)\b/i.test(text) || (text.trim().toLowerCase() === "return" && ["threshold-side-entry", "utility-room"].includes(entry.run.spatial?.player_location)))) {
          return this.submitAction({ world_id, mode, action: "RETURN" });
        }
        if (entry.phase?.phase_id === "RETURN" && /\b(complete return|finalize return|finish return)\b/i.test(text)) {
          return this.submitAction({ world_id, mode, action: "COMPLETE_RETURN" });
        }
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
          try {
            this.persistSession(world, mode, entry);
          } catch (persistError) {
            for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
            for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
            entry.run._world = world; entry.phase = beforePhase;
            return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
          }
          const scene = this.sceneFor(entry, mode, { action: "LOOK", scene_type: "observation", accepted: Boolean(member), public_reason: reason }, world);
          return { ok: true, result: { outcome: member ? "succeeded" : "rejected", executed: Boolean(member), public_reason: reason, scene }, projection: this.projectionFor(world, mode, entry) };
        }
        // The bounded interpreter receives only the observer-safe operational
        // context below. Its candidate still has to resolve through the same
        // object/spatial authorities; unsupported intent cannot mutate reality.
      }
      const providerSetting = this.settings().provider ?? "offline";
      const isManual = providerSetting !== "auto" && providerSetting !== "offline" && providerSetting !== "local";
      const key = isManual ? this.credentials.get(providerSetting) : null;
      if (isManual && !key) return publicError("PROVIDER_CONFIGURATION_REQUIRED", "Language assistance needs an access key. Your world is safe; you can continue offline.");
      const nonBootstrap = entry.kind !== "bootstrap"; const adapterRun = nonBootstrap ? { session: { startup: { player: { observer_id: mode } } }, profile_id: mode } : entry.run; const available = this.availableFor(world, mode, entry);
      const phaseBefore = entry.phase?.phase_id; const interpretationContext = nonBootstrap ? this.naturalContext(world, mode, entry) : this.q4InterpretationContext(world, entry); const requestId = `desktop-natural-${world_id}-${Date.now()}`;
      const provider = providerSetting === "offline" ? createMockProvider() : this.providerPool.createAutoProvider({ requestId, route: "submitNatural" });
      const contextHash = crypto.createHash("sha256").update(JSON.stringify(interpretationContext)).digest("hex");
      this.recordInterpretationProvenance({ request_id: requestId, route: "submitNatural", event:"provider-selected", input: "player-supplied", provider: provider.name, model: provider.model ?? "deterministic", provider_invoked:false, response_classification:providerSetting === "offline" ? "deterministic" : "not-yet-observed", doctrine: interpretationContext.authority_contract?.doctrine_sha256 ?? null, context_sha256: contextHash, context_sections: Object.keys(interpretationContext), canonical_resolution: "executePlayerTurn -> consequenceResolver", observer_projection: nonBootstrap ? "naturalContext" : "q4InterpretationContext" });
      const turn = await executePlayerTurn({ run: adapterRun, mode, provider, player_text: text, request_id: requestId, context: interpretationContext, consequenceResolver: entry.kind === "bootstrap" ? ({ plan }) => this.resolveQ4Attempt({ world_id, mode, entry, plan }) : ({ plan }) => resolveModeAttempt({ service: this, world_id, mode, plan, available }), sceneBuilder: entry.kind === "bootstrap" ? ({ natural: resolved }) => this.sceneFor(entry, mode, { scene_type: resolved.consequence?.result?.accepted ? "delta" : "observation", accepted: resolved.consequence?.result?.accepted, public_reason: resolved.consequence?.result?.observer_safe_summary }, world) : ({ natural: resolved }) => this.modeScene(world, mode, entry, resolved) });
      if (entry.kind === "bootstrap" && turn.save_required && phaseBefore === entry.phase?.phase_id) this.recordQ4Action(entry, text, { ok: true, result: { time_advanced: turn.consequence?.result?.time_advanced ?? 0, canonical_event_ids: turn.consequence?.result?.canonical_event_ids ?? [] } }, world);
      if (turn.save_required) {
        try {
          this.persistSession(world, mode, entry);
        } catch (persistError) {
          for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
          for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
          entry.run._world = world; entry.phase = beforePhase;
          return publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.");
        }
      }
      const scene = { ...turn.scene, narration: turn.narration.prose, narration_source: turn.narration.source };
      const hostedFailure = providerSetting !== "offline" && this.interpretationProvenance.some((record) => record.request_id === requestId && record.invocation_status === "failed");
      return { ok: true, result: { turn_status: turn.status, interpretation_error:turn.status === "INTERPRETATION_ERROR", provider_unavailable:hostedFailure, clarification_required: turn.status === "CLARIFICATION_REQUIRED", clarification_question: turn.clarification?.question ?? null, executed: turn.save_required, summary: scene.narration, scene }, projection: this.projectionFor(world, mode, entry) };
    } catch (error) {
      if (entry?.run && beforeRun) {
        for (const k of Object.keys(world)) delete world[k]; Object.assign(world, beforeWorld);
        for (const k of Object.keys(entry.run)) delete entry.run[k]; Object.assign(entry.run, beforeRun);
        entry.run._world = world; entry.phase = beforePhase;
      }
      this.log(`natural action failed: ${error.message}`);
      return (error.code === "PERSISTENCE_COMMIT_FAILED" || error.code === "SESSION_SAVE_INVALID" || error.code === "SESSION_VALUE_INVALID" || error.code?.includes("PERSISTENCE"))
        ? publicError("PERSISTENCE_COMMIT_FAILED", "The action could not be saved and was not committed. Check the operation record storage before retrying.")
        : publicError("PROVIDER_UNAVAILABLE", "Language assistance is unavailable. Continue using structured controls or retry this action reference.");
    }
  }
  shutdown() {
    this.shuttingDown = true;
    try { this.dialogueRuntime?.shutdown()?.catch(() => {}); } catch {}
    try { this.inferenceAppliance?.shutdown(); } catch {}
    for (const [key, entry] of this.sessions) { const [worldId, mode] = key.split(":"); if (this.recoveredWorlds.has(worldId)) continue; try { this.persistSession(this.getWorld(worldId), mode, entry); } catch (error) { this.log(`shutdown save failed: ${error.message}`); } }
    return { ok: true };
  }
}

module.exports = { DesktopService, MODES, DEFAULT_SETTINGS };
