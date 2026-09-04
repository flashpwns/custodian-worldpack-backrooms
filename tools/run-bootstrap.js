"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSession, exportSession, restoreSession, stableSerialize, getAvailableSessionActions, submitSessionAction, inspectSessionObserver } = require("custodian");
const { FIELD_SCENARIO, fieldExpedition, event, useEquipment, safeSummary, finalize, ensureFacilityOperations, recordFacilityEvent, reconcileFacilityOperations } = require("./expedition");
const procedural = require("./procedural-complex");
const proceduralV2 = require("./procedural-complex-v2");
const history = require("./world-history");
const q4Personnel = require("./q4-personnel");
const q4Equipment = require("./q4-equipment");
const q4Missions = require("./q4-missions");
const assignmentEngine = require("./q4-assignment-engine");
const q4Continuity = require("./q4-continuity");
const evidenceAuthority = require("./q4-evidence-authority");
const runIdentity = require("./run-identity");
const spatialRuntime = require("./spatial-runtime");
const objectRuntime = require("./object-runtime");
const missionRuntime = require("./mission-runtime");
const q4Time = require("./q4-time");
const q4Radio = require("./q4-radio");
const dynamicsRuntime = require("./operational-dynamics");
const operationalCycle = require("./operational-cycle");
const operationalTime = require("./operational-time");
const communications = require("./communication-runtime");
const teamRuntime = require("./team-runtime");
const hazardRuntime = require("./hazard-runtime");
const consequenceRuntime = require("./consequence-runtime");
const logisticsRuntime = require("./logistics-runtime");
const institutionalRuntime = require("./institutional-runtime");
const surveyFrontier = require("./survey-frontier");
const environment = require("./q4-environment");
const phenomenonEcology = require("./q4-phenomenon-ecology");
const personnelContinuity = require("./q4-personnel-continuity");
const referenceExpedition = require("./reference-expedition");

const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const clone = (value) => structuredClone(value);
const FIELD_PROFILE = "field-researcher";
function generatorFor(stateOrVersion) { const version = typeof stateOrVersion === "string" ? stateOrVersion : stateOrVersion?.version; if (version === procedural.VERSION) return procedural; if (version === proceduralV2.VERSION) return proceduralV2; throw Object.assign(new Error(`unsupported generator version: ${version ?? "missing"}`), { code: "GENERATOR_VERSION_UNSUPPORTED" }); }
function spatialDefinitionFor(packId) {
  if (typeof packId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(packId)) throw new Error("invalid spatial worldpack id");
  const definition = read(`data/worldpacks/${packId}/spatial.json`);
  spatialRuntime.validateDefinition(definition);
  return definition;
}
function interactionDefinitionFor(packId) {
  if (typeof packId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(packId)) throw new Error("invalid interaction worldpack id");
  const definition = read(`data/worldpacks/${packId}/interactions.json`);
  objectRuntime.validateDefinition(definition, spatialDefinitionFor(packId));
  return definition;
}
function dynamicsDefinitionFor(packId) {
  return dynamicsRuntime.load(packId, { spatial: spatialDefinitionFor(packId), equipment: logisticsDefinitionFor(packId).item_instances.map((item) => item.id) });
}
function logisticsDefinitionFor(packId) {
  if (typeof packId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(packId)) throw new Error("invalid logistics worldpack id");
  const definition = read(`data/worldpacks/${packId}/logistics.json`);
  logisticsRuntime.validateDefinition(definition, { personnel_roles: dynamicsStaffingRoles(packId) });
  return definition;
}
function institutionalDefinitionFor(packId) {
  if (typeof packId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(packId)) throw new Error("invalid institutional worldpack id");
  const definition = read(`data/worldpacks/${packId}/institution.json`);
  institutionalRuntime.validateDefinition(definition);
  return definition;
}
function dynamicsStaffingRoles(packId) {
  const definition = read(`data/worldpacks/${packId}/dynamics.json`);
  return definition.staffing?.coworker_roles ?? [];
}
function missionDefinitionFor(packId) {
  if (typeof packId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(packId)) throw new Error("invalid mission worldpack id");
  const definition = read(`data/worldpacks/${packId}/mission.json`);
  const spatial = spatialDefinitionFor(packId);
  const interactions = interactionDefinitionFor(packId);
  missionRuntime.validateDefinition(definition, {
    objects: interactions.objects.map((item) => item.id),
    locations: spatial.locations.map((item) => item.id),
    connections: spatial.connections.map((item) => item.id),
    equipment: logisticsDefinitionFor(packId).item_instances.map((item) => item.id),
    personnel_roles: dynamicsDefinitionFor(packId).staffing.coworker_roles.concat(["field surveyor", "field researcher"])
  });
  return definition;
}
function spatialContext(run) {
  const player = run.session.startup.player.observer_id;
  const members = (run.expedition?.team?.members ?? []).map((member) => member.personnel_id ?? member.id).filter((id) => id && id !== player);
  const equipment = Object.values(run.expedition?.equipment ?? {});
  return { player, personnel: members, equipment, personnel_records: run.expedition?.team?.members ?? [], world_seed: run._world?.seed ?? run.seed };
}
function topologyFor(run) { return spatialRuntime.canonicalDefinition(run.spatial, spatialDefinitionFor(run.spatial_pack_id)); }

function profileFor(profileId) { return read("profiles/profiles.json").profiles.find((profile) => profile.id === profileId); }
function startupFor(profileId, playerOverride = null) {
  const profile = profileFor(profileId);
  const config = read("profiles/startups.json").startups.find((entry) => entry.profile === profileId);
  if (!profile || !config) throw new Error(`unknown profile: ${profileId}`);
  const knowledge = read("profiles/knowledge.json").profiles.find((entry) => entry.id === profile.starting_knowledge_profile);
  const permissions = read("profiles/permissions.json").sets.find((entry) => entry.id === profile.starting_permissions);
  const resources = read("profiles/resources.json").profiles.find((entry) => entry.id === profile.starting_resource_profile);
  const declared = profileId === FIELD_PROFILE ? ["traverse-controlled-route", "toggle-light"] : [];
  const player = playerOverride ? { ...config.player, observer_id: playerOverride } : config.player;
  return { profile, startup: { profile: { id: profile.id }, player, knowledge: [...knowledge.institutional_records, ...config.knowledge.map((entry) => entry.reference)].map((reference, index) => ({ observer_id: player.observer_id, kind: config.knowledge[index]?.kind ?? "institutional_record", reference })), permissions: [...permissions.permissions, ...declared].map((permission) => ({ observer_id: player.observer_id, permission })), resources: resources.resources.map((id) => ({ id, custodian: player.observer_id, quantity: 1 })), metadata: config.metadata } };
}
function configuredScenario(profileId, playerId) {
  const scenario = clone(read("scenarios/threshold-baseline.json"));
  scenario.id = profileId === FIELD_PROFILE ? FIELD_SCENARIO : scenario.id;
  const actorId = `yb-actor-${playerId}`;
  const initialPosition = profileId === FIELD_PROFILE ? "threshold-transition" : profileId === "local-anomaly" ? "complex-side-adjacent-survey-space" : (read("profiles/startups.json").startups.find((entry) => entry.profile === profileId)?.metadata.starting_location);
  scenario.actors = [{ id: actorId, position: initialPosition }];
  scenario.observers.push({ id: playerId, goals: [], plans: [], actor_id: actorId, origin: "embodied", capabilities: ["visual"], access: profileId === FIELD_PROFILE ? ["field-survey"] : [] });
  return scenario;
}
function configuredPack(profileId, playerId) {
  const pack = clone(read("manifest.json"));
  if (profileId === FIELD_PROFILE) {
    const route = pack.execution_rules.find((rule) => rule.intent === "traverse-controlled-route");
    route.success_effects = [{ type: "actors.positioned", domain: "actors", payload: { actor_id: `yb-actor-${playerId}`, position: "complex-side-controlled-area" } }];
    const fieldInteraction = pack.execution_rules.find((rule) => rule.intent === "toggle-light");
    fieldInteraction.preconditions = [...fieldInteraction.preconditions, { path: "resources.recording-device.custodian", equals: playerId }];
  }
  return pack;
}
function newRun({ profile, seed, session, expedition, staffing = null, loadout = null, mission = null, procedural_state, procedural_scenario = false, spatial_state = null, object_state = null, survey_frontier = null, interpretation_state = null, spatial_pack_id = null, world_id = null, run_id = null, world = null, phase = "BRIEFING" }) {
  const profileRecord = profileFor(profile);
  const player = session.startup.player.observer_id;
  const staffingRules = spatial_pack_id ? dynamicsDefinitionFor(spatial_pack_id).staffing : {};
  const run = { version: "yellow-beast-run@v9", profile_id: profile, profile_title: profileRecord.title, scenario: procedural_scenario ? "async-clear-q4-procedural-survey" : session.scenario.id, seed, session, lifecycle: "active", checklist: { moved: false, inspected: false, used: false }, aliases: {}, expedition: expedition ?? (profile === FIELD_PROFILE ? fieldExpedition(player, staffing, loadout, mission, seed, staffingRules) : null), procedural: procedural_scenario ? (procedural_state ?? procedural.initialize({ seed, observer: player })) : null, spatial_pack_id: profile === FIELD_PROFILE ? spatial_pack_id : null, spatial: spatial_state, object_state, survey_frontier, interpretation_state, world_id, run_id, _world: world };
  if (run.spatial_pack_id) {
    ensureFacilityOperations(run.expedition);
    const logisticsDefinition = logisticsDefinitionFor(run.spatial_pack_id);
    logisticsRuntime.migrate(run.expedition, logisticsDefinition, { player, team: run.expedition.team?.members ?? [], location: run.spatial?.player_location ?? logisticsDefinition.containers.find((item) => item.kind === "staging")?.location ?? null, at: run.expedition.clock?.interval ?? 0 });
    if (world) institutionalRuntime.ensure(world, institutionalDefinitionFor(run.spatial_pack_id));
    const definition = spatialDefinitionFor(run.spatial_pack_id);
    const context = spatialContext(run);
    run.spatial = spatialRuntime.migrate(run.spatial, definition, { ...context, phase });
    reconcileFacilityOperations(run.expedition, run.spatial);
    const topology = topologyFor(run);
    environment.ensure(run.spatial, topology, run.seed);
    run.survey_frontier = surveyFrontier.migrate(run.survey_frontier, topology, { ...context, spatial: run.spatial, at: run.expedition.clock?.interval ?? 0 });
    surveyFrontier.observe(run.survey_frontier, topology, player, run.spatial.player_location, { at: run.expedition.clock?.interval ?? 0, co_present: Object.entries(run.spatial.personnel_locations).filter(([id, location]) => id !== player && location === run.spatial.player_location).map(([id]) => id) });
    spatialRuntime.syncEquipment(run.spatial, run.expedition); logisticsRuntime.syncSpatial(run.expedition, run.spatial);
    const interactions = interactionDefinitionFor(run.spatial_pack_id);
    run.object_state = objectRuntime.migrate(run.object_state, interactions);
    const missionDefinition = missionDefinitionFor(run.spatial_pack_id);
    const legacyObjectives = run.expedition?.objectives ? clone(run.expedition.objectives) : null;
    run.expedition.mission_state = missionRuntime.migrate(run.expedition.mission_state, missionDefinition, { instance_id: run.expedition.mission?.id ?? missionDefinition.mission.id, phase, legacy_objectives: legacyObjectives, at: run.expedition.clock?.interval ?? 0 });
    missionRuntime.attachCompatibilityView(run.expedition);
    operationalCycle.ensure(run, dynamicsDefinitionFor(run.spatial_pack_id));
  }
  run.identity = runIdentity.describe(run);
  return run;
}
function startRun({ profile, seed = "yellow-beast-bootstrap", scenario = null, world = null, region_id = null, generator_version = null, player_identity = null, spatial_worldpack = null }) {
  const controlled = player_identity ?? world?.q4_operations?.controlled_player ?? null;
  const { profile: profileRecord, startup } = startupFor(profile, profile === FIELD_PROFILE ? controlled : null);
  const player = startup.player.observer_id;
  const result = createSession({ world_pack: configuredPack(profile, player), scenario: configuredScenario(profile, player), startup, seed_material: { seed } });
  if (!result.ok) return result;
  const restored = restoreSession(exportSession(result.session).envelope);
  const procedural_scenario = profile === FIELD_PROFILE && scenario === "procedural-survey";
  const reference_scenario = profile === FIELD_PROFILE && referenceExpedition.isReference(scenario);
  const runtimeScenario = procedural_scenario ? "async-clear-q4-procedural-survey" : reference_scenario ? referenceExpedition.RUNTIME_SCENARIO : result.session.scenario.id;
  const run_id = world ? history.beginRun(world, { profile, scenario: runtimeScenario, seed }) : null;
  const dynamics = profile === FIELD_PROFILE && spatial_worldpack ? dynamicsDefinitionFor(spatial_worldpack) : null;
  const institution = profile === FIELD_PROFILE && world && spatial_worldpack ? institutionalRuntime.ensure(world, institutionalDefinitionFor(spatial_worldpack)) : null;
  const followUpMinimum = Math.max(0, ...(institution?.follow_up_assignments ?? []).filter((item) => item.status === "available").map((item) => item.staffing_modifier?.minimum_total ?? 0));
  const institutionalStaffing = dynamics ? { ...dynamics.staffing, minimum_total: Math.min(dynamics.staffing.maximum_total, Math.max(dynamics.staffing.minimum_total, followUpMinimum, institution?.dimensions?.staffing_posture === "reinforced" ? 4 : 0)) } : null;
  const staffingRules = reference_scenario ? referenceExpedition.staffingRules(institutionalStaffing ?? {}) : (institutionalStaffing ?? {});
  const staffing = profile === FIELD_PROFILE && world ? q4Personnel.staffQ4(world, run_id, player, seed, staffingRules) : null;
  if (staffing && !staffing.ok) return { ok: false, error: { code: staffing.code } };
  const assignment = profile === FIELD_PROFILE && world && !reference_scenario ? assignmentEngine.issue(world, { run_id, seed, selection_context: `${world.world_id}:${world.q4_operations?.institutional_time ?? 0}`, staffing }) : null;
  if (assignment && !assignment.ok) return { ok: false, error: { code: assignment.code } };
  const mission = profile === FIELD_PROFILE ? (reference_scenario ? referenceExpedition.mission({ run_id, seed, staffing }) : (assignment?.mission ?? q4Missions.generate({ world, run_id, seed, staffing }))) : null;
  if (mission && world) history.recordQ4Mission(world, run_id, mission);
  const loadout = profile === FIELD_PROFILE && world ? q4Equipment.prepare(world, run_id, { player: staffing.player.identity, coworkers: staffing.coworkers, required_keys: mission.required_equipment }) : null;
  const existing = region_id && world?.regions?.[region_id];
  let generator; try { generator = generatorFor(existing?.generator_version ?? generator_version ?? procedural.VERSION); } catch (error) { return { ok: false, error: { code: error.code ?? "GENERATOR_VERSION_UNSUPPORTED" } }; }
  const procedural_state = existing ? clone(history.restoreRegion(world, region_id).state) : (procedural_scenario && generator_version === proceduralV2.VERSION ? generator.initialize({ seed, observer: player, policy: "moderate" }) : undefined);
  if (procedural_state) { const known = procedural_state.discovery[player] ?? { spaces: [], edges: [], features: [] }; procedural_state.discovery = { [player]: { spaces: [], edges: [], features: [] } }; procedural_state.current = { [player]: Object.keys(procedural_state.nodes)[0] }; void known; }
  const run = newRun({ profile, seed, session: result.session, staffing, loadout, mission, procedural_scenario, procedural_state, spatial_pack_id: spatial_worldpack, spatial_state: world?.q4_geography ?? null, object_state: world?.q4_object_state ?? null, survey_frontier: world?.q4_survey_frontier ?? null, world_id: world?.world_id ?? null, run_id, world });
  if (reference_scenario) { run.scenario = referenceExpedition.RUNTIME_SCENARIO; referenceExpedition.instantiate(run); }
  return { ok: restored.ok, session: result.session, run, restored_equivalent: restored.ok && stableSerialize(restored.session) === stableSerialize(result.session), summary: { session_id: result.session.id, profile, profile_title: profileRecord.title, scenario: result.session.scenario.id, seed, player: startup.player, knowledge: startup.knowledge, permissions: startup.permissions, resources: startup.resources } };
}
function normalizeRun(value) {
  if (value?.version === "yellow-beast-run@v9") {
    if (!["active", "completed"].includes(value.lifecycle)) throw Object.assign(new Error("invalid current run lifecycle"), { code:"RUN_STATE_INVALID" });
    const activeClearQ4 = (value.lifecycle ?? "active") === "active" && value.spatial_pack_id === "clear-q4";
    if (!value.session || !value.checklist || !value.aliases || (value.spatial_pack_id && (!value.expedition || !value.spatial || !value.object_state || !value.survey_frontier)) || (activeClearQ4 && value.spatial?.environment?.version !== environment.VERSION)) throw Object.assign(new Error("invalid current run state"), { code:"RUN_STATE_INVALID" });
    if (activeClearQ4) {
      const topology = topologyFor(value); const player = value.session?.startup?.player?.observer_id; const personnel = (value.expedition?.team?.members ?? []).map((member) => member.personnel_id ?? member.id).filter(Boolean);
      environment.validateCurrent(value.spatial.environment, spatialDefinitionFor(value.spatial_pack_id));
      surveyFrontier.validateCurrent(value.survey_frontier, topology, { player, personnel });
    }
    if (value.expedition) reconcileFacilityOperations(value.expedition, value.spatial);
    return value;
  }
  if (["yellow-beast-run@v8", "yellow-beast-run@v7", "yellow-beast-run@v6", "yellow-beast-run@v5", "yellow-beast-run@v4", "yellow-beast-run@v3", "yellow-beast-run@v2", "yellow-beast-run@v1"].includes(value?.version)) return newRun({ profile: value.profile_id, seed: value.seed, session: value.session, expedition: value.expedition, procedural_state: value.procedural, procedural_scenario: Boolean(value.procedural), spatial_state: value.spatial, object_state: value.object_state, survey_frontier: value.survey_frontier, spatial_pack_id: value.spatial_pack_id ?? null, world_id: value.world_id, run_id: value.run_id });
  if (value?.session) return newRun({ profile: value.session.startup.profile.id, seed: value.session.seed_material?.seed ?? "restored", session: value.session });
  return newRun({ profile: value.startup.profile.id, seed: value.seed_material?.seed ?? "restored", session: value });
}
function ensureSpatial(runValue, phase = "BRIEFING") {
  const run = normalizeRun(runValue);
  if (!run.spatial_pack_id) return run;
  const definition = spatialDefinitionFor(run.spatial_pack_id);
  const legacy = run.procedural ? generatorFor(run.procedural).visible(run.procedural, run.session.startup.player.observer_id)?.location?.alias : null;
  run.spatial = spatialRuntime.migrate(run.spatial, definition, { ...spatialContext(run), phase, legacy_location: legacy });
  environment.ensure(run.spatial, topologyFor(run), run.seed);
  spatialRuntime.syncEquipment(run.spatial, run.expedition); logisticsRuntime.syncSpatial(run.expedition, run.spatial);
  const interactions = interactionDefinitionFor(run.spatial_pack_id);
  run.object_state = objectRuntime.migrate(run.object_state, interactions);
  const missionDefinition = missionDefinitionFor(run.spatial_pack_id);
  const legacyObjectives = run.expedition?.objectives ? clone(run.expedition.objectives) : null;
  run.expedition.mission_state = missionRuntime.migrate(run.expedition.mission_state, missionDefinition, { instance_id: run.expedition.mission?.id ?? missionDefinition.mission.id, phase, legacy_objectives: legacyObjectives, at: run.expedition.clock?.interval ?? 0 });
  missionRuntime.attachCompatibilityView(run.expedition);
  operationalCycle.ensure(run, dynamicsDefinitionFor(run.spatial_pack_id));
  if (["FIELD_OPERATION", "RETURN", "DEBRIEF"].includes(phase)) objectRuntime.observeLocation(run.object_state, interactions, { observer: run.session.startup.player.observer_id, location: run.spatial.player_location, time: run.expedition?.clock?.interval ?? 0 });
  return run;
}
function synchronizeMissionOutcome(run) {
  const finalResult = run.expedition?.mission_state?.final_result;
  if (!finalResult) return null;
  if (!run.expedition.result) {
    run.expedition.result = {
      ...clone(finalResult),
      mission_title: run.expedition.title,
      outcome: finalResult.classification,
      objectives: clone(run.expedition.mission_state.objectives),
      team: clone(run.expedition.team), evidence: clone(run.expedition.evidence), resources: clone(run.expedition.equipment), messages: clone(run.expedition.messages), clock: clone(run.expedition.clock), deviations: clone(run.expedition.deviations ?? []),
      simulation_authority: "condition-driven-mission-runtime"
    };
    event(run.expedition, "mission.finalized", { final_state: finalResult.final_mission_state, classification: finalResult.classification });
  }
  run.expedition.outcome = finalResult.classification;
  run.lifecycle = "completed";
  return run.expedition.result;
}
function evaluateMissionState(run, phase = null) {
  if (!run.spatial_pack_id || !run.expedition?.mission_state) return [];
  if (phase) run.expedition.mission_state.phase = phase;
  const result = missionRuntime.evaluateAndCommit(run.expedition.mission_state, missionDefinitionFor(run.spatial_pack_id), { run, player: run.session.startup.player.observer_id }, { at: run.expedition.clock?.interval ?? 0 });
  run._last_mission_updates = result.transitions;
  for (const transition of result.transitions) event(run.expedition, "mission.objective.transitioned", { ...transition, interval: run.expedition.clock?.interval ?? 0 });
  synchronizeMissionOutcome(run);
  return result.transitions;
}
function resolveOperationalCycle(run, action, cost, source = "player-action") {
  if (!run.spatial_pack_id || !run.expedition) { const missionUpdates = evaluateMissionState(run); return { clock: { from: run.expedition?.clock?.interval ?? 0, to: run.expedition?.clock?.interval ?? 0, cost: 0 }, mission_updates: missionUpdates, public_updates: [] }; }
  q4Equipment.absorbCompatibility(run.expedition);
  const result = operationalCycle.resolve(run, dynamicsDefinitionFor(run.spatial_pack_id), spatialDefinitionFor(run.spatial_pack_id), { action, cost, source, evaluateMission: () => evaluateMissionState(run), syncEquipment: (spatial, expedition) => { spatialRuntime.syncEquipment(spatial, expedition); logisticsRuntime.syncSpatial(expedition, spatial); }, institutionalDefinition: institutionalDefinitionFor(run.spatial_pack_id) });
  run._last_phenomenon_updates = run._world && run.spatial ? phenomenonEcology.advance(run._world, run, { action }) : [];
  return result;
}
function renderInteractionText(run, text, toolStatuses = []) {
  const observer = run.session.startup.player.observer_id; const used = toolStatuses.find((entry) => entry.status?.holder)?.status; const holder = run.expedition.team.members.find((member) => (member.personnel_id ?? member.id) === used?.holder); const player = run.expedition.team.members.find((member) => (member.personnel_id ?? member.id) === observer);
  const values = { tool_holder_first_name: used?.holder === observer ? "You" : holder?.first_name ?? "The assigned teammate", actor_display_name: used?.holder === observer ? "You" : holder?.display_name ?? "The assigned teammate", team_lead_first_name: player?.first_name ?? "You" };
  return String(text).replace(/\{(tool_holder_first_name|actor_display_name|team_lead_first_name)\}/g, (_, key) => values[key]);
}
function observeCurrentObjects(run) {
  if (!run.object_state || !run.spatial) return [];
  return objectRuntime.observeLocation(run.object_state, interactionDefinitionFor(run.spatial_pack_id), { observer: run.session.startup.player.observer_id, location: run.spatial.player_location, time: run.expedition?.clock?.interval ?? 0 });
}
function toolAdapter(run, activeObserver = null) {
  const observer = activeObserver ?? run.session.startup.player.observer_id;
  function resolveTool(requirement) {
    const match = Object.entries(run.expedition?.equipment ?? {}).find(([key, item]) => (requirement.key && key === requirement.key) || (!requirement.key && requirement.capability && item.capability === requirement.capability));
    if (!match) return { ok: false, code: "EQUIPMENT_NOT_ACCESSIBLE", reason: requirement.unavailable ?? "The required equipment was not assigned to this operation." };
    const [key, item] = match;
    if (!q4Equipment.stateUsable(item) || item.charges <= 0) return { ok: false, code: "EQUIPMENT_UNAVAILABLE", reason: requirement.unavailable ?? `The ${item.label.toLowerCase()} is not operational.` };
    if (item.holder === observer) return { ok: true, key, item, holder: observer, team_use: false };
    const holder = run.expedition.team.members.find((member) => (member.personnel_id ?? member.id) === item.holder);
    const nearby = holder?.status === "active" && run.spatial && spatialRuntime.proximity(run.spatial, observer, item.holder).speaking_range;
    if (requirement.allow_team_use === true && nearby) return { ok: true, key, item, holder: item.holder, team_use: true };
    return { ok: false, code: "EQUIPMENT_NOT_ACCESSIBLE", reason: nearby ? `The ${item.label.toLowerCase()} remains with ${holder.first_name ?? "the assigned teammate"}; a handoff or declared team-use procedure is required.` : requirement.separated ?? `The ${item.label.toLowerCase()} is not within working range.` };
  }
  function consumeTool(requirement, status) {
    const used = q4Equipment.use(run.expedition, status.key, status.holder);
    return used.ok ? { ok: true, item: used.item } : { ok: false, code: used.code, reason: requirement.unavailable ?? "The required equipment is not operational." };
  }
  return { resolveTool, consumeTool };
}
function objectProjection(run) {
  if (!run.object_state || !run.spatial) return [];
  const tools = toolAdapter(run);
  return objectRuntime.projectLocation(run.object_state, interactionDefinitionFor(run.spatial_pack_id), { observer: run.session.startup.player.observer_id, location: run.spatial.player_location, toolContext: { resolveTool: tools.resolveTool } });
}
function setSpatialPhase(runValue, phase) {
  const run = ensureSpatial(runValue, phase);
  if (!run.spatial_pack_id) return run;
  spatialRuntime.setPhase(run.spatial, spatialDefinitionFor(run.spatial_pack_id), phase, spatialContext(run));
  surveyFrontier.observe(run.survey_frontier, topologyFor(run), run.session.startup.player.observer_id, run.spatial.player_location, { at: run.expedition.clock?.interval ?? 0, co_present: Object.entries(run.spatial.personnel_locations).filter(([id, location]) => id !== run.session.startup.player.observer_id && location === run.spatial.player_location).map(([id]) => id) });
  spatialRuntime.syncEquipment(run.spatial, run.expedition); logisticsRuntime.syncSpatial(run.expedition, run.spatial);
  if (["FIELD_OPERATION", "RETURN", "DEBRIEF"].includes(phase)) observeCurrentObjects(run);
  evaluateMissionState(run, phase);
  return run;
}
function enterSpatialField(runValue) {
  const run = ensureSpatial(runValue, "FIELD_OPERATION");
  if (!run.spatial_pack_id) return run;
  spatialRuntime.enterField(run.spatial, spatialDefinitionFor(run.spatial_pack_id), spatialContext(run));
  surveyFrontier.observe(run.survey_frontier, topologyFor(run), run.session.startup.player.observer_id, run.spatial.player_location, { at: run.expedition.clock?.interval ?? 0, co_present: Object.entries(run.spatial.personnel_locations).filter(([id, location]) => id !== run.session.startup.player.observer_id && location === run.spatial.player_location).map(([id]) => id) });
  spatialRuntime.syncEquipment(run.spatial, run.expedition); logisticsRuntime.syncSpatial(run.expedition, run.spatial);
  observeCurrentObjects(run);
  evaluateMissionState(run, "FIELD_OPERATION");
  const currentView = look(run, { record:false }); run.aliases = Object.fromEntries((currentView.aliases ?? []).map(({ alias, ref }) => [alias, ref]));
  return run;
}
function look(runValue, { record = true } = {}) {
  const run = normalizeRun(runValue);
  const observer = run.session.startup.player.observer_id;
  if (run.spatial) {
    if (record) {
      surveyFrontier.observe(run.survey_frontier, topologyFor(run), observer, run.spatial.player_location, { at: run.expedition.clock?.interval ?? 0, co_present: Object.entries(run.spatial.personnel_locations).filter(([id, location]) => id !== observer && location === run.spatial.player_location).map(([id]) => id) });
      observeCurrentObjects(run);
      evaluateMissionState(run);
    }
    const definition = spatialDefinitionFor(run.spatial_pack_id);
    const location = spatialRuntime.currentLocation(run.spatial, definition);
    const exits = spatialRuntime.visibleExits(run.spatial, definition);
    const objects = objectProjection(run);
    const coObservers = Object.entries(run.spatial.personnel_locations).filter(([id, local]) => id !== observer && local === run.spatial.player_location).map(([id]) => id);
    const phenomena = run._world ? (record ? phenomenonEcology.observe(run._world, { run, observer, location_id:run.spatial.player_location, co_observers:coObservers, has_field_light:q4Equipment.stateUsable(run.expedition.equipment?.["field-light"]) }).observations : phenomenonEcology.projection(run._world, { observer, location_id:run.spatial.player_location })) : [];
    if (record && run._world && ["FIELD_OPERATION","RETURN"].includes(run.expedition.mission_state?.phase)) { run._last_phenomenon_reactions=[]; for(const observed of phenomena)for(const worker of coObservers){const context=personnelContinuity.reactionContext({world:run._world,run,phase:run.expedition.mission_state.phase,worker_id:worker,player_id:observer,event:{id:observed.observation_ref,category:"unidentified-field-observation",summary:observed.description,novelty_key:observed.observation_ref,operational_importance:82,perceived_risk:observed.current_visible_state==="SEATED_QUIET"?48:72,observed_by:[observer,...coObservers],participants:[observer,...coObservers],location:run.spatial.player_location,scene:"field"}});const reaction=personnelContinuity.react(run._world,context);if(reaction.reaction)run._last_phenomenon_reactions.push({worker_id:worker,observation_ref:observed.observation_ref,reaction:reaction.reaction});} }
    const features = [...(location?.landmarks ?? []).map((feature) => ({ alias: feature.name, kind: "landmark" })), ...objects.map((object) => ({ alias: object.name, kind: object.object_type })), ...phenomena.map((item) => ({ alias:item.designation, kind:"observed-form", observation:item.description, observed_properties:item.observed_properties }))];
    const aliases = Object.fromEntries([...features.map((feature) => [feature.alias, feature.alias]), ...exits.map((exit) => [exit.label, exit.ref])]);
    if (record) run.aliases = aliases;
    return { outcome: "succeeded", observer_id: observer, kind: "look", view: { location: { id: location?.id, alias: location?.name, family: location?.type, lighting: location?.environment?.lighting, description: location?.short_description }, features, objects, phenomena, exits: exits.map((exit) => ({ alias: exit.label, edge_id: exit.ref, destination_known: exit.destination_known, status: exit.status })), environment: clone(location?.environment ?? {}) }, targets: Object.keys(aliases).map((alias) => ({ alias })), aliases: Object.entries(aliases).map(([alias, ref]) => ({ alias, ref })), public_reason: null, spatial_version: spatialRuntime.VERSION, object_state_version: objectRuntime.VERSION };
  }
  if (run.procedural) {
    const generator = generatorFor(run.procedural); const view = generator.visible(run.procedural, observer); if (record && generator.VERSION === proceduralV2.VERSION) { const local = generator.observe(run.procedural, observer, run.profile_id); view.landmark = local.landmark; view.objects = local.objects; view.environment = local.environment; view.route_character = local.route_character; }
    const aliases = Object.fromEntries([...view.features.map((feature) => [feature.alias, feature.alias]), ...view.exits.map((exit) => [exit.alias, exit.alias])]);
    if (record) run.aliases = aliases;
    return { outcome: "succeeded", observer_id: observer, kind: "look", view, targets: Object.keys(aliases).map((alias) => ({ alias })), aliases: Object.keys(aliases).map((alias) => ({ alias, ref: aliases[alias] })), public_reason: null, generator_version: generator.VERSION };
  }
  const result = inspectSessionObserver({ session: run.session, observer, request: { id: `look-${run.session.id}`, kind: "look" } });
  const aliases = Object.fromEntries((result.targets ?? []).map((target, index) => [`fixture-${index + 1}`, target.ref]));
  if (record) run.aliases = aliases;
  return { ...result, aliases: Object.keys(aliases).map((alias) => ({ alias, ref: aliases[alias] })) };
}
function inspect(runValue, alias) {
  const run = normalizeRun(runValue);
  const observer = run.session.startup.player.observer_id;
  if (run.spatial) {
    const interactions = run.object_state ? interactionDefinitionFor(run.spatial_pack_id) : null;
    const objectTarget = interactions ? objectRuntime.resolveTarget(run.object_state, interactions, alias, run.spatial.player_location) : { ok: false };
    if (objectTarget.ok || objectTarget.code === "INTERACTION_TARGET_AMBIGUOUS") {
      const inspected = objectTarget.ok ? objectRuntime.inspection(run.object_state, interactions, { observer, location: run.spatial.player_location, target: alias, time: run.expedition?.clock?.interval ?? 0, toolContext: { resolveTool: toolAdapter(run).resolveTool } }) : objectTarget;
      if (inspected.ok) {
        run.checklist.inspected = true;
        const objectives = evaluateMissionState(run);
        event(run.expedition, "object.inspected", { target: inspected.target, location: run.spatial.player_location, interaction_sequence: run.object_state.interaction_history.at(-1)?.sequence ?? null });
        return { outcome: "succeeded", details: { narration: inspected.narration, alias: inspected.target, location: run.spatial.player_location, known_properties: inspected.known_properties, actions: inspected.actions, objective_updates: objectives }, public_reason: inspected.narration };
      }
      return { outcome: "rejected", public_reason: inspected.reason };
    }
    const result = spatialRuntime.inspect(run.spatial, spatialDefinitionFor(run.spatial_pack_id), alias);
    if (result.ok && run.expedition) { run.checklist.inspected = true; event(run.expedition, "spatial.feature.inspected", { target: alias, location: run.spatial.player_location }); evaluateMissionState(run); }
    return { outcome: result.ok ? "succeeded" : "rejected", ...(result.ok ? { details: { narration: result.narration, alias, location: run.spatial.player_location } } : {}), public_reason: result.narration ?? result.reason };
  }
  if (run.procedural) {
    const result = generatorFor(run.procedural).inspect(run.procedural, observer, alias);
    if (result.ok && run.expedition) { run.checklist.inspected = true; event(run.expedition, "procedural.feature.inspected", result.detail); }
    return { outcome: result.ok ? "succeeded" : "rejected", ...(result.ok ? { details: result.detail } : {}), public_reason: result.public_reason ?? null };
  }
  const target = run.aliases?.[alias] ?? alias;
  const result = inspectSessionObserver({ session: run.session, observer, request: { id: `inspect-${run.session.id}-${alias ?? ""}`, kind: "inspect", target } });
  if (result.outcome === "succeeded" && run.profile_id === FIELD_PROFILE) { run.checklist.inspected = true; if (run.expedition) event(run.expedition, "survey.inspected", { alias, location: look(run).view?.location ?? null }); }
  return result;
}
function status(runValue) {
  const run = normalizeRun(runValue);
  const observer = run.session.startup.player.observer_id;
  const view = look(run, { record: false });
  const actions = getAvailableSessionActions({ session: run.session, actor: observer }).actions;
  const active = run.lifecycle === "active";
  const closing = run.expedition?.mission_state?.return?.requested === true;
  const operationalVerbs = run.spatial_pack_id ? ["ORDER_HOLD", "ORDER_INVESTIGATE", "ORDER_FOLLOW", "TRANSFER", "ASSIST", "RECOVER", "MITIGATE"] : [];
  const expeditionVerbs = active && run.expedition ? ["COMMUNICATE", "RECORD", "WAIT", "RETURN", "ABORT", ...operationalVerbs, ...(closing ? ["COMPLETE_RETURN"] : [])] : [];
  const objectVerbs = active ? [...new Set((view.view?.objects ?? []).flatMap((object) => object.actions ?? []).map((item) => item.action))] : [];
  const discovered = run.spatial ? spatialRuntime.project(run.spatial, spatialDefinitionFor(run.spatial_pack_id), { personnel: (run.expedition?.team?.members ?? []).map((member) => ({ id: member.personnel_id ?? member.id, name: member.display_name })) }) : run.procedural ? generatorFor(run.procedural).map(run.procedural, observer) : null;
  return { profile_id: run.profile_id, profile_title: run.profile_title, scenario: run.scenario, lifecycle: run.lifecycle, player: observer, run_identity: runIdentity.describe(run), known_resources: (run.session.startup.resources ?? []).filter((entry) => entry.custodian === observer).map((entry) => entry.id), available_verbs: [...new Set(["LOOK", ...(active && view.targets?.length ? ["INSPECT"] : []), ...(active && ((run.spatial || run.procedural) ? view.view?.exits?.length : actions.includes("traverse-controlled-route")) ? ["MOVE"] : []), ...(active && actions.includes("toggle-light") ? ["USE"] : []), ...objectVerbs, ...expeditionVerbs])], view: { outcome: view.outcome, location: view.view?.location ?? null, targets: (view.aliases ?? []).map(({ alias }) => ({ alias })), observations: { environment: view.view?.environment ?? {}, landmark: view.view?.landmark ?? null, objects: view.view?.objects ?? [], phenomena:view.view?.phenomena ?? [], route_character: view.view?.route_character ?? null }, public_reason: view.public_reason ?? null }, ...(run.expedition ? { expedition: safeSummary(run.expedition) } : {}), ...(discovered ? { discovered_topology: discovered } : {}), ...(run.procedural ? { generator_version: generatorFor(run.procedural).VERSION } : {}), ...(run.spatial ? { spatial_version: spatialRuntime.VERSION, object_state_version: run.object_state?.version ?? null } : {}) };
}
function terminal(run, decision) { finalize(run.expedition, decision, { checklist: run.checklist }); run.lifecycle = "completed"; const continuity = run._world && run.run_id ? q4Continuity.commitOutcome(run._world, run, decision) : null; const ingestion = run._world && run.run_id ? history.ingestRun(run._world, run) : null; return { ok: true, outcome: "succeeded", result: { public_reason: null, expedition_result: clone(run.expedition.result), ...(continuity ? { continuity: { outcome: continuity.outcome, review_id: continuity.review.mission_id } } : {}), ...(ingestion ? { history: { run_id: ingestion.run_id, region_id: ingestion.region_id } } : {}) }, run }; }
function expeditionAction(run, verb, target) {
  const expedition = run.expedition; const player = run.session.startup.player.observer_id;
  if (!expedition) return { ok: false, error: { code: "UNSUPPORTED_VERB" }, run };
  const dynamics = run.spatial_pack_id ? dynamicsDefinitionFor(run.spatial_pack_id) : null;
  const costFor = (action, authored = null) => dynamics ? dynamicsRuntime.actionCost(dynamics, action, authored) : Number.isInteger(authored) ? authored : 1;
  if (verb === "WAIT") { event(expedition, "expedition.waited", { interval: expedition.clock.interval }); const cycle = resolveOperationalCycle(run, verb, costFor(verb)); const checkIn = communications.project(expedition).check_ins[0]; return { ok: true, outcome: "succeeded", result: { public_reason: checkIn?.state === "overdue" || checkIn?.state === "missed" ? checkIn.summary : "The team waits and the operational clock advances.", time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates }, run }; }
  if (verb === "COMMUNICATE") {
    if (!["standard", "teammate", "team"].includes(target)) return { ok: false, error: { code: "RECIPIENT_UNAVAILABLE" }, run };
    const radio = useEquipment(expedition, "survey-radio", player); if (!radio.ok) return { ok: false, error: { code: radio.code }, run };
    if (!dynamics) { const message = communications.createMessage(expedition, { sender: player, recipient: target === "standard" ? "Standard" : expedition.team.members.find((member) => (member.personnel_id ?? member.id) !== player)?.personnel_id, channel: "FIELD_RADIO", purpose: target === "standard" ? "scheduled-check-in" : "team-contact", text: "Field transmission." }); communications.transition(expedition, message, "delivered", "legacy procedural transmission delivered"); operationalTime.advance(expedition, 1, "legacy-communication"); return { ok: true, outcome: "succeeded", result: { public_reason: "Message delivered.", time_advanced: 1, message }, run }; }
    const queued = communications.queueRadio(run, dynamics, { sender: player, recipient: target === "standard" ? "Standard" : expedition.team.members.find((member) => (member.personnel_id ?? member.id) !== player)?.personnel_id, text: "Field transmission.", purpose: target === "standard" ? "scheduled-check-in" : "team-contact" });
    const cycle = resolveOperationalCycle(run, verb, costFor(verb)); const message = expedition.messages.find((entry) => entry.id === queued.message.id);
    event(expedition, "communication.sent", { message_id: message.id, state: message.state, interval: expedition.clock.interval });
    return { ok: true, outcome: "succeeded", result: { public_reason: message.state === "delayed" ? message.interference.public_description : message.state === "delivered" || message.state === "acknowledged" ? "Message delivered; acknowledgment is recorded separately." : "Transmission queued; delivery is not yet confirmed.", time_advanced: cycle.clock.cost, message: { recipient: target, delivery_status: message.delivery_status, state: message.state }, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates }, run };
  }
  if (verb === "RECORD") {
    const view = look(run); const alias = target ?? view.aliases[0]?.alias;
    if (!alias || !view.aliases.some((entry) => entry.alias === alias)) return { ok: false, error: { code: "TARGET_UNAVAILABLE" }, run };
    const observedPhenomenon = run._world && run.spatial ? phenomenonEcology.resolveObservedTarget(run._world, { observer:player, location_id:run.spatial.player_location, target:alias }) : null;
    const safeObservation = observedPhenomenon ? phenomenonEcology.projection(run._world, { observer:player, location_id:run.spatial.player_location }).find((item) => item.designation === alias || item.formal_designation === alias) : null;
    const operator = run.spatial ? player : expedition.equipment?.["recording-device"]?.holder ?? player; const device = useEquipment(expedition, "recording-device", operator);
    if (!device.ok) return { ok: false, error: { code: device.code }, run };
    const cost = costFor(verb); const evidence = { id: `field-note-${expedition.evidence.length + 1}`, type: "field-note", creator: player, operator, custodian: player, target_alias: alias, location: view.view?.location ?? null, capture_event: "evidence.recorded", device: "recording-device", storage: "with field record", captured_at: { interval: expedition.clock.interval + cost }, target_observation: safeObservation?.description ?? "observer-visible target", visible_objects: safeObservation?.observed_properties ?? [alias], phenomenon_observation_ref:safeObservation?.observation_ref ?? null, provenance: "observer-safe-record", valid: true, available_to_player: true, available_to_standard: false, reporting_state: "unreported", interval: expedition.clock.interval + cost, environmental_conditions:run.spatial ? environment.captureContext(run.spatial.environment, run.spatial.player_location, { has_field_light:q4Equipment.stateUsable(run.expedition.equipment?.["field-light"]) }) : null };
    if (run._world) { evidenceAuthority.capture(run._world, run, evidence); if (observedPhenomenon) phenomenonEcology.linkEvidence(run._world, observedPhenomenon.id, { observer:player, evidence_id:evidence.id }); } evidence.render = { status: "fallback-ready" }; expedition.evidence.push(evidence); event(expedition, "evidence.recorded", evidence); const cycle = resolveOperationalCycle(run, verb, cost);
    return { ok: true, outcome: "succeeded", result: { public_reason: null, time_advanced: cycle.clock.cost, evidence: { id: evidence.id, type: evidence.type, render_status: evidence.render.status }, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates }, run };
  }
  if (verb === "RETURN") { if (!expedition.mission_state) return terminal(run, verb); const requested = missionRuntime.requestReturn(expedition.mission_state, missionDefinitionFor(run.spatial_pack_id), { run, player }, { at: expedition.clock?.interval ?? 0 }); if (!requested.ok) return { ok: false, error: { code: requested.code }, result: { public_reason: requested.reason }, run }; expedition.mission_state.phase = "RETURN"; const cycle = resolveOperationalCycle(run, verb, costFor(verb)); return { ok: true, outcome: "return-begun", result: { public_reason: requested.reason, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates }, run }; }
  if (verb === "ABORT") { if (!expedition.mission_state) return terminal(run, verb); const requested = missionRuntime.requestAbort(expedition.mission_state, missionDefinitionFor(run.spatial_pack_id), { run, player }, { at: expedition.clock?.interval ?? 0 }); if (!requested.ok) return { ok: false, error: { code: requested.code }, result: { public_reason: requested.reason }, run }; expedition.mission_state.phase = "RETURN"; const cycle = resolveOperationalCycle(run, verb, costFor(verb)); const missionUpdates = [...(requested.transitions ?? []), ...cycle.mission_updates]; expedition.mission_state.recent_updates = missionUpdates.slice(-5).map((transition) => ({ headline: transition.headline, summary: transition.reason, state: transition.to, at: expedition.clock?.interval ?? 0 })); return { ok: true, outcome: "controlled-abort-begun", result: { public_reason: requested.reason, time_advanced: cycle.clock.cost, mission_updates: missionUpdates, operational_updates: cycle.public_updates }, run }; }
  if (verb === "COMPLETE_RETURN") {
    const definition = missionDefinitionFor(run.spatial_pack_id); const state = expedition.mission_state;
    if (!state?.return?.requested) return { ok: false, error: { code: "RETURN_NOT_REQUESTED" }, result: { public_reason: "Begin the return procedure before mission closure." }, run };
    expedition.mission_state.phase = "RETURN"; evaluateMissionState(run, "RETURN");
    const closure = missionRuntime.requestClosure(state, definition, { run, player }, { at: expedition.clock?.interval ?? 0 });
    if (!closure.ok) return { ok: false, error: { code: closure.code }, result: { public_reason: closure.reason }, run };
    const closureRadio = expedition.equipment?.["survey-radio"];
    if (q4Radio.available(expedition) && q4Equipment.stateUsable(closureRadio) && closureRadio.charges > 0 && !(expedition.messages ?? []).some((message) => message.purpose === "mission-closure" && message.delivery_status === "delivered")) {
      useEquipment(expedition, "survey-radio", player);
      communications.queueRadio(run, dynamics, { sender: player, recipient: "Standard", text: "Return accountability and mission closure report.", purpose: "mission-closure", acknowledgment: false });
    }
    const cycle = resolveOperationalCycle(run, verb, costFor(verb));
    return { ok: true, outcome: run.lifecycle === "completed" ? "mission-closed" : "return-reconciliation-pending", result: { public_reason: expedition.result?.public_debrief_summary ?? closure.reason, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates, expedition_result: clone(expedition.result) }, run };
  }
  return { ok: false, error: { code: "UNSUPPORTED_VERB" }, run };
}
function objectInteraction(run, verb, target) {
  if (!run.spatial || !run.object_state || !target) return null;
  const definition = interactionDefinitionFor(run.spatial_pack_id);
  const resolved = objectRuntime.resolveTarget(run.object_state, definition, target, run.spatial.player_location);
  if (!resolved.ok) return resolved.code === "INTERACTION_TARGET_AMBIGUOUS" ? { ok: false, error: { code: resolved.code }, result: { public_reason: resolved.reason }, public_reason: resolved.reason, run } : null;
  let action = String(verb).toLowerCase();
  const authored = resolved.object.affordances ?? [];
  if (action === "record" && !authored.some((item) => item.type === "record") && authored.some((item) => item.type === "photograph")) action = "photograph";
  const tools = toolAdapter(run);
  const onEvidence = (evidence) => {
    evidence.mission_id = run.expedition.mission?.id ?? null;
    evidence.environmental_conditions = environment.captureContext(run.spatial.environment, run.spatial.player_location, { has_field_light:q4Equipment.stateUsable(run.expedition.equipment?.["field-light"]) });
    if (run._world) evidenceAuthority.capture(run._world, run, evidence);
    evidence.render = { status: "fallback-ready" };
  };
  const result = objectRuntime.interact(run.object_state, definition, {
    observer: run.session.startup.player.observer_id,
    location: run.spatial.player_location,
    location_name: spatialRuntime.currentLocation(run.spatial, spatialDefinitionFor(run.spatial_pack_id))?.name ?? null,
    target,
    action,
    time: run.expedition.clock?.interval ?? 0,
    run_ref: run.run_id ?? run.expedition.id,
    evidence: run.expedition.evidence,
    resolveTool: tools.resolveTool,
    consumeTool: tools.consumeTool,
    advanceTime: null,
    onEvidence,
    renderText: (text, statuses) => renderInteractionText(run, text, statuses)
  });
  if (!result.ok) return { ok: false, error: { code: result.code }, result: { public_reason: result.reason }, public_reason: result.reason, run };
  for (const hook of resolved.object.hazard_hooks ?? []) hazardRuntime.applyInteractionHook(run, dynamicsDefinitionFor(run.spatial_pack_id), hook, result.action, run.session.startup.player.observer_id);
  const committedObject = run.object_state.objects?.[result.object_id];
  if (committedObject?.container && committedObject.container !== "with field record") for (const evidence of run.expedition.evidence ?? []) if (evidence.source_object === result.object_id) { evidence.storage = committedObject.container; evidence.custody_state = committedObject.moved ? "contained-returnable" : "contained"; evidence.custodian = committedObject.holder ?? run.session.startup.player.observer_id; }
  run.checklist.used = action !== "inspect" ? true : run.checklist.used;
  const eventId = `object.interaction.${result.interaction_sequence ?? run.object_state.interaction_history.length}`;
  event(run.expedition, "object.interacted", { action: result.action, target: result.target, location: run.spatial.player_location, interaction_sequence: result.interaction_sequence, evidence_id: result.evidence?.id ?? null, time_cost: result.time_cost });
  const cycle = resolveOperationalCycle(run, String(verb).toUpperCase(), result.time_cost, "object-interaction");
  return { ok: true, outcome: "succeeded", result: { public_reason: result.narration, time_advanced: cycle.clock.cost, state_changed: result.state_changed, evidence: result.evidence ? { id: result.evidence.id, type: result.evidence.type, render_status: result.evidence.render?.status ?? "fallback-ready" } : null, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates, canonical_event_ids: [eventId] }, run };
}

function coordinatedFailure(run, code, reason) { return { ok:false, outcome:"rejected", error:{ code }, result:{ public_reason:reason }, run }; }
function validateCoordinatedAttempts(run, bundle) {
  const player = run.session?.startup?.player?.observer_id;
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle) || typeof bundle.submission_id !== "string" || !bundle.submission_id.trim()) return { ok:false, code:"COORDINATED_BUNDLE_MALFORMED", reason:"A coordinated attempt requires an explicit submission identity." };
  if (!bundle.player_attempt || typeof bundle.player_attempt !== "object" || Array.isArray(bundle.player_attempt)) return { ok:false, code:"COORDINATED_PLAYER_ATTEMPT_REQUIRED", reason:"A coordinated interval requires an explicitly supplied player attempt." };
  if (!Array.isArray(bundle.coworker_attempts) || bundle.coworker_attempts.length < 1) return { ok:false, code:"COORDINATED_COWORKER_ATTEMPT_REQUIRED", reason:"A coordinated interval requires at least one explicit coworker attempt." };
  const attempts = [bundle.player_attempt, ...bundle.coworker_attempts];
  if (attempts.some((attempt) => !attempt || typeof attempt !== "object" || typeof attempt.actor !== "string" || typeof attempt.action !== "string" || typeof attempt.target !== "string")) return { ok:false, code:"COORDINATED_BUNDLE_MALFORMED", reason:"Every coordinated attempt requires an explicit actor, action, and target." };
  if (bundle.player_attempt.actor !== player) return { ok:false, code:"COORDINATED_PLAYER_ACTOR_INVALID", reason:"The player attempt actor must be the controlled player." };
  if (bundle.coworker_attempts.some((attempt) => attempt.actor === player)) return { ok:false, code:"COORDINATED_PLAYER_IN_COWORKER_ATTEMPTS", reason:"The controlled player cannot appear among coworker attempts." };
  const actors = attempts.map((attempt) => attempt.actor);
  if (new Set(actors).size !== actors.length) return { ok:false, code:"COORDINATED_DUPLICATE_ACTOR", reason:"An actor may make only one explicit attempt in a coordinated interval." };
  const equipmentClaims = attempts.filter((attempt) => String(attempt.action).toUpperCase() === "USE" && typeof attempt.equipment === "string").map((attempt) => attempt.equipment);
  if (new Set(equipmentClaims).size !== equipmentClaims.length) return { ok:false, code:"COORDINATED_RESOURCE_CONFLICT", reason:"One exclusive equipment item is claimed by more than one simultaneous attempt." };
  const members = new Map((run.expedition?.team?.members ?? []).map((member) => [member.personnel_id ?? member.id, member]));
  const playerLocation = run.spatial?.personnel_locations?.[player];
  if (!run.spatial || !run.object_state || !playerLocation) return { ok:false, code:"COORDINATED_SCENE_UNAVAILABLE", reason:"A confirmed field scene is required for coordinated physical execution." };
  const interactions = interactionDefinitionFor(run.spatial_pack_id); const spatial = spatialDefinitionFor(run.spatial_pack_id); const resources = new Map(); const prepared = [];
  for (const [index, submitted] of attempts.entries()) {
    const attempt = { actor:submitted.actor, action:String(submitted.action).toUpperCase(), target:submitted.target, equipment:submitted.equipment ?? null, role:index === 0 ? "player" : "coworker" };
    const member = members.get(attempt.actor);
    if (!member || (index > 0 && attempt.actor === player)) return { ok:false, code:"COORDINATED_ACTOR_UNASSIGNED", reason:"Every coordinated actor must be assigned to the current expedition." };
    if (String(member.status).toLowerCase() !== "active" || member.health === "incapacitated" || /incapacitat|unconscious|deceased/i.test(String(member.condition))) return { ok:false, code:"COORDINATED_ACTOR_INCAPABLE", reason:"Every coordinated actor must be active and capable at the start of the interval." };
    if (run.spatial.personnel_locations[attempt.actor] !== playerLocation) return { ok:false, code:"COORDINATED_ACTOR_OUT_OF_RANGE", reason:"Local physical attempts require confirmed co-presence at the start of the interval." };
    if (attempt.action === "USE") {
      if (typeof attempt.equipment !== "string" || !attempt.equipment) return { ok:false, code:"COORDINATED_EQUIPMENT_REQUIRED", reason:"Equipment use requires an explicit equipment identity." };
      const item = run.expedition.equipment?.[attempt.equipment];
      if (!item || !q4Equipment.stateUsable(item) || Number(item.charges ?? 0) <= 0) return { ok:false, code:"COORDINATED_EQUIPMENT_UNAVAILABLE", reason:"The declared equipment is not operationally available." };
      const operator = item.holder; const operatorMember = members.get(operator);
      if (!operatorMember || String(operatorMember.status).toLowerCase() !== "active" || run.spatial.personnel_locations[operator] !== playerLocation) return { ok:false, code:"COORDINATED_EQUIPMENT_OUT_OF_RANGE", reason:"The actual equipment holder is not active and co-present." };
      if (operator !== attempt.actor) return { ok:false, code:"COORDINATED_EQUIPMENT_NOT_HELD", reason:"A coordinated equipment attempt requires the declared actor to hold and operate the equipment." };
      if (attempt.equipment === "survey-instrument") {
        if (!referenceExpedition.isReference(run.scenario) || playerLocation !== referenceExpedition.definition.measurement.location_id || ![playerLocation, "Open Passage", "open passage"].includes(attempt.target)) return { ok:false, code:"COORDINATED_MEASUREMENT_UNAVAILABLE", reason:"The declared passage measurement is not available from this scene." };
        if ((run.expedition.evidence ?? []).some((item) => item.type === referenceExpedition.definition.measurement.evidence_type && item.location === playerLocation)) return { ok:false, code:"EVIDENCE_REDUNDANT", reason:"The current passage measurement is already recorded." };
      } else return { ok:false, code:"COORDINATED_ACTION_UNSUPPORTED", reason:"That equipment action is not supported by the bounded coordinated executor." };
      const claim = resources.get(attempt.equipment); if (claim) return { ok:false, code:"COORDINATED_RESOURCE_CONFLICT", reason:`The ${item.label.toLowerCase()} is claimed by more than one simultaneous attempt.` };
      resources.set(attempt.equipment, attempt.actor); prepared.push({ ...attempt, operator, kind:"equipment-use" }); continue;
    }
    if (attempt.action === "INSPECT") {
      const object = objectRuntime.resolveTarget(run.object_state, interactions, attempt.target, playerLocation);
      if (object.ok) { prepared.push({ ...attempt, kind:"object-inspection" }); continue; }
      const landmark = spatialRuntime.inspect(run.spatial, spatial, attempt.target);
      if (!landmark.ok) return { ok:false, code:"COORDINATED_TARGET_UNAVAILABLE", reason:landmark.reason };
      prepared.push({ ...attempt, kind:"spatial-inspection", validation_narration:landmark.narration }); continue;
    }
    if (attempt.action === "PHOTOGRAPH" || attempt.action === "TEST") {
      const resolved = objectRuntime.resolveTarget(run.object_state, interactions, attempt.target, playerLocation);
      if (!resolved.ok) return { ok:false, code:resolved.code === "INTERACTION_TARGET_AMBIGUOUS" ? resolved.code : "COORDINATED_TARGET_UNAVAILABLE", reason:resolved.reason };
      const affordanceAction = attempt.action.toLowerCase();
      const affordance = (resolved.object.affordances ?? []).find((item) => item.type === affordanceAction);
      if (!affordance) return { ok:false, code:"COORDINATED_ACTION_UNSUPPORTED", reason:resolved.object.rejections?.[affordanceAction] ?? `The ${resolved.object.display_name.toLowerCase()} does not support that action.` };
      const stateFailure = objectRuntime.stateRequirementFailure(resolved.object_state, affordance);
      if (stateFailure) return { ok:false, code:"COORDINATED_ACTION_UNAVAILABLE", reason:stateFailure };
      const reqEquipment = affordance.requirements?.equipment ?? [];
      let requiredItemKey = null;
      let requiredItem = null;
      for (const req of reqEquipment) {
        const match = Object.entries(run.expedition.equipment ?? {}).find(([key, item]) => (req.key && key === req.key) || (!req.key && req.capability && item.capability === req.capability));
        if (!match) return { ok:false, code:"COORDINATED_EQUIPMENT_UNAVAILABLE", reason:req.unavailable ?? "Required equipment is not available." };
        const [key, item] = match;
        if (!q4Equipment.stateUsable(item) || Number(item.charges ?? 0) <= 0) return { ok:false, code:"COORDINATED_EQUIPMENT_UNAVAILABLE", reason:req.unavailable ?? `The ${item.label.toLowerCase()} is not operational.` };
        if (item.holder !== attempt.actor) return { ok:false, code:"COORDINATED_EQUIPMENT_NOT_HELD", reason:"A coordinated equipment attempt requires the declared actor to hold and operate the equipment." };
        requiredItemKey = key;
        requiredItem = item;
      }
      if (requiredItemKey) {
        const claim = resources.get(requiredItemKey);
        if (claim) return { ok:false, code:"COORDINATED_RESOURCE_CONFLICT", reason:`The ${requiredItem.label.toLowerCase()} is claimed by more than one simultaneous attempt.` };
        resources.set(requiredItemKey, attempt.actor);
      }
      prepared.push({ ...attempt, operator:attempt.actor, kind:"object-interaction", affordance_action:affordanceAction, object_id:resolved.object.id, equipment:requiredItemKey });
      continue;
    }
    return { ok:false, code:"COORDINATED_ACTION_UNSUPPORTED", reason:"The bounded coordinated executor supports passage measurement, inspection, photography, and instrument testing only." };
  }
  return { ok:true, submission_id:bundle.submission_id.trim(), player, player_location:playerLocation, prepared };
}
function resolveCoordinatedAttempts(runValue, bundle) {
  const run = normalizeRun(runValue); if (run.lifecycle === "completed") return coordinatedFailure(run, "RUN_COMPLETE", "The operation is already complete.");
  const validation = validateCoordinatedAttempts(run, bundle); if (!validation.ok) return coordinatedFailure(run, validation.code, validation.reason);
  const from = run.expedition.clock.interval; const interval = from + 1; const intervalId = `coordinated:${run.run_id ?? run.expedition.id}:${validation.submission_id}:${interval}`; const priorSubmission = run._active_submission_id; run._active_submission_id = validation.submission_id;
  const interactions = interactionDefinitionFor(run.spatial_pack_id);
  const spatial = spatialDefinitionFor(run.spatial_pack_id);
  const outcomes = [];
  for (const attempt of validation.prepared) {
    if (attempt.kind === "equipment-use") {
      const used = q4Equipment.use(run.expedition, attempt.equipment, attempt.operator);
      if (!used.ok) { run._active_submission_id = priorSubmission; return coordinatedFailure(run, used.code, "Validated equipment became unavailable before coordinated commit."); }
      const evidence = referenceExpedition.measurementEvidence(run, attempt.operator, interval);
      if (evidence) {
        evidence.mission_id = run.expedition.mission?.id ?? null; evidence.environmental_conditions = environment.captureContext(run.spatial.environment, validation.player_location, { has_field_light:q4Equipment.stateUsable(run.expedition.equipment?.["field-light"]) });
        if (run._world) evidenceAuthority.capture(run._world, run, evidence); run.expedition.evidence.push(evidence); event(run.expedition, "evidence.recorded", evidence);
      }
      run.checklist.used = true; const outcome = { actor:attempt.actor, role:attempt.role, action:attempt.action, target:attempt.target, equipment:attempt.equipment, operator:attempt.operator, outcome:"succeeded", interval_id:intervalId, interval, evidence_id:evidence?.id ?? null, public_reason:evidence?.target_observation ?? "The equipment procedure was completed." };
      event(run.expedition, "coordinated.attempt.resolved", outcome); outcomes.push(outcome); continue;
    }
    if (attempt.kind === "object-interaction") {
      const tools = toolAdapter(run, attempt.actor);
      const onEvidence = (evidence) => {
        evidence.mission_id = run.expedition.mission?.id ?? null;
        evidence.environmental_conditions = environment.captureContext(run.spatial.environment, validation.player_location, { has_field_light:q4Equipment.stateUsable(run.expedition.equipment?.["field-light"]) });
        evidence.operator = attempt.actor;
        evidence.creator = attempt.actor;
        evidence.capturing_observer = attempt.actor;
        evidence.custodian = attempt.actor;
        if (run._world) evidenceAuthority.capture(run._world, run, evidence);
        evidence.render = { status:"fallback-ready" };
      };
      const interacted = objectRuntime.interact(run.object_state, interactions, {
        observer: attempt.actor,
        location: validation.player_location,
        location_name: spatialRuntime.currentLocation(run.spatial, spatial)?.name ?? null,
        target: attempt.target,
        action: attempt.affordance_action,
        time: interval,
        run_ref: run.run_id ?? run.expedition.id,
        evidence: run.expedition.evidence,
        resolveTool: tools.resolveTool,
        consumeTool: tools.consumeTool,
        advanceTime: null,
        onEvidence,
        renderText: (text, statuses) => renderInteractionText(run, text, statuses)
      });
      if (!interacted.ok) { run._active_submission_id = priorSubmission; return coordinatedFailure(run, interacted.code, interacted.reason); }
      run.checklist.used = true;
      const eventId = `object.interaction.${interacted.interaction_sequence ?? run.object_state.interaction_history.length}`;
      event(run.expedition, "object.interacted", { action:interacted.action, target:interacted.target, location:validation.player_location, interaction_sequence:interacted.interaction_sequence, evidence_id:interacted.evidence?.id ?? null, time_cost:0 });
      const outcome = { actor:attempt.actor, role:attempt.role, action:attempt.action, target:interacted.target, equipment:attempt.equipment, operator:attempt.actor, outcome:"succeeded", interval_id:intervalId, interval, evidence_id:interacted.evidence?.id ?? null, public_reason:interacted.narration };
      event(run.expedition, "coordinated.attempt.resolved", outcome);
      outcomes.push(outcome);
      continue;
    }
    const member = run.expedition.team.members.find((item) => (item.personnel_id ?? item.id) === attempt.actor); let inspected;
    if (attempt.kind === "object-inspection") inspected = objectRuntime.inspection(run.object_state, interactions, { observer:attempt.actor, location:validation.player_location, target:attempt.target, time:interval, toolContext:{ resolveTool:toolAdapter(run, attempt.actor).resolveTool } });
    else inspected = { ok:true, action:"inspect", target:attempt.target, narration:attempt.validation_narration, time_cost:0, state_changed:false };
    if (member) {
      member.known_information ??= []; member.known_information.push({ kind:"coordinated-inspection", target:inspected.target, location:validation.player_location, at:interval, source:"direct-observation", interval_id:intervalId });
    }
    run.checklist.inspected = true;
    const outcome = { actor:attempt.actor, role:attempt.role, action:attempt.action, target:inspected.target, equipment:null, operator:attempt.actor, outcome:"succeeded", interval_id:intervalId, interval, evidence_id:null, public_reason:inspected.narration };
    event(run.expedition, "coordinated.attempt.resolved", outcome); outcomes.push(outcome);
  }
  const cycle = resolveOperationalCycle(run, "COORDINATED_ATTEMPT", 1, "coordinated-attempt");
  const record = { version:"yellow-beast-coordinated-attempt@v1", submission_id:validation.submission_id, interval_id:intervalId, interval, from, to:cycle.clock.to, outcomes:clone(outcomes), mission_transition_count:cycle.mission_updates.length, environment_update_count:cycle.environment_updates.length };
  run.expedition.coordinated_attempts ??= []; run.expedition.coordinated_attempts.push(record); event(run.expedition, "coordinated.interval.resolved", record); run._active_submission_id = priorSubmission;
  return { ok:true, outcome:"coordinated-interval-resolved", result:{ interval_id:intervalId, interval, outcomes:clone(outcomes), time_advanced:cycle.clock.cost, mission_updates:cycle.mission_updates, operational_updates:cycle.public_updates, cycle }, run };
}
function act(runValue, verb, target) {
  const run = normalizeRun(runValue);
  if (verb === "LOOK") return { ok: true, outcome: "succeeded", result: look(run), run };
  if (verb === "INSPECT") { const result = inspect(run, target); return result.outcome === "succeeded" ? { ok: true, outcome: "succeeded", result, run } : { ok: false, outcome: "rejected", error: { code: "INTERACTION_TARGET_UNAVAILABLE" }, result, public_reason: result.public_reason, run }; }
  if (run.lifecycle === "completed") return { ok: false, error: { code: "RUN_COMPLETE" }, run };
  if (String(verb).startsWith("ORDER_") && run.spatial) {
    const parts = String(target ?? "").split("|");
    const type = String(verb).slice(6).toLowerCase().replace(/_/g, "-");
    const recipientArg = parts[0]?.trim();
    const destination = parts[1]?.trim() ?? null;
    const player = run.session.startup.player.observer_id;
    const isAll = !recipientArg || ["all", "everyone", "team"].includes(recipientArg.toLowerCase());
    const recipients = isAll
      ? (run.expedition?.team?.members ?? []).filter((m) => (m.personnel_id ?? m.id) !== player && run.spatial.personnel_locations[m.personnel_id ?? m.id] === run.spatial.player_location).map((m) => m.personnel_id ?? m.id)
      : [recipientArg];
    if (recipients.length === 0) return { ok: false, error: { code: "PERSONNEL_NOT_AVAILABLE" }, result: { public_reason: "No eligible teammates are present to receive that order." }, run };
    let lastOrdered = null;
    for (const recipient of recipients) {
      lastOrdered = teamRuntime.issueOrder(run, spatialDefinitionFor(run.spatial_pack_id), { recipient, type, target: destination, channel: "LOCAL" });
    }
    if (!lastOrdered?.ok) return { ok: false, error: { code: lastOrdered?.code ?? "ORDER_REJECTED" }, result: { public_reason: lastOrdered?.reason }, run };
    const cycle = resolveOperationalCycle(run, "ORDER", dynamicsRuntime.actionCost(dynamicsDefinitionFor(run.spatial_pack_id), "ORDER"), "team-order");
    const publicReason = isAll ? `The team acknowledges the instruction to ${type.replace(/-/g, " ")}.` : lastOrdered.public_reason;
    return { ok: true, outcome: lastOrdered.order.state, result: { public_reason: publicReason, order: lastOrdered.order, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates }, run };
  }
  if ((verb === "TRANSFER" || verb === "HANDOFF") && run.spatial && run.expedition) {
    const player = run.session.startup.player.observer_id;
    let itemId = null;
    let recipientId = null;
    if (typeof target === "object" && target !== null) {
      itemId = target.item ?? target.item_id ?? target.equipment;
      recipientId = target.recipient ?? target.recipient_id ?? target.target_holder;
    } else {
      const parts = String(target ?? "").split("|");
      itemId = parts[0]?.trim();
      recipientId = parts[1]?.trim();
    }
    const itemEntry = Object.entries(run.expedition.equipment ?? {}).find(([key, val]) =>
      key === itemId || val.id === itemId || val.instance_id === itemId ||
      val.label?.toLowerCase() === itemId?.toLowerCase() ||
      val.model?.toLowerCase() === itemId?.toLowerCase() ||
      (itemId && val.label?.toLowerCase().includes(itemId.toLowerCase()))
    );
    if (!itemEntry) return { ok: false, error: { code: "ITEM_UNKNOWN" }, result: { public_reason: "That equipment is not part of this operation." }, run };
    const [itemKey, item] = itemEntry;

    const recipientMember = run.expedition.team?.members?.find((m) =>
      (m.personnel_id ?? m.id) === recipientId ||
      m.first_name?.toLowerCase() === recipientId?.toLowerCase() ||
      m.display_name?.toLowerCase() === recipientId?.toLowerCase() ||
      (recipientId && m.display_name?.toLowerCase().includes(recipientId.toLowerCase()))
    );
    if (!recipientMember) return { ok: false, error: { code: "PERSONNEL_UNKNOWN" }, result: { public_reason: "That teammate is not part of the assigned field team." }, run };
    const targetHolder = recipientMember.personnel_id ?? recipientMember.id;

    if (run.spatial.personnel_locations[player] !== run.spatial.personnel_locations[targetHolder]) {
      return { ok: false, error: { code: "TRANSFER_OUT_OF_RANGE" }, result: { public_reason: "Both people must share confirmed speaking range for a physical transfer." }, run };
    }

    let action = "HAND_OVER";
    if (item.holder !== player) {
      if (item.holder === targetHolder) {
        action = "RECEIVE";
      } else {
        return { ok: false, error: { code: "ITEM_NOT_IN_CUSTODY" }, result: { public_reason: "The item is not in the custody of either participant." }, run };
      }
    }

    const logisticsContext = {
      player,
      spatial: run.spatial,
      team: run.expedition.team?.members ?? [],
      at: run.expedition.clock?.interval ?? 0
    };
    const definition = logisticsDefinitionFor(run.spatial_pack_id);
    const transacted = logisticsRuntime.transact(run.expedition, definition, {
      action,
      item_id: itemKey,
      actor: player,
      target_holder: targetHolder
    }, logisticsContext);

    if (!transacted.ok) {
      return { ok: false, error: { code: transacted.code }, result: { public_reason: transacted.public_reason }, run };
    }

    spatialRuntime.syncEquipment(run.spatial, run.expedition);
    event(run.expedition, "equipment.transferred", { item: itemKey, from: transacted.item.current_holder === targetHolder ? player : targetHolder, to: transacted.item.current_holder });
    const cycle = resolveOperationalCycle(run, "TRANSFER", 1, "equipment-transfer");
    return {
      ok: true,
      outcome: "succeeded",
      result: {
        public_reason: transacted.public_reason,
        time_advanced: cycle.clock.cost,
        item: transacted.item,
        mission_updates: cycle.mission_updates,
        operational_updates: cycle.public_updates
      },
      run
    };
  }
  if (verb === "ASSIST" && run.spatial) { const assisted = teamRuntime.assist(run, target); if (!assisted.ok) return { ok: false, error: { code: assisted.code }, result: { public_reason: assisted.reason }, run }; const cycle = resolveOperationalCycle(run, verb, dynamicsRuntime.actionCost(dynamicsDefinitionFor(run.spatial_pack_id), verb), "personnel-recovery"); return { ok: true, outcome: "recovered-complication", result: { public_reason: assisted.public_reason, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates }, run }; }
  if (verb === "RECOVER" && run.spatial) { const recovered = consequenceRuntime.recoverEquipment(run, target, run.session.startup.player.observer_id); if (!recovered.ok) return { ok: false, error: { code: recovered.code }, result: { public_reason: recovered.reason }, run }; const cycle = resolveOperationalCycle(run, verb, dynamicsRuntime.actionCost(dynamicsDefinitionFor(run.spatial_pack_id), verb), "equipment-recovery"); return { ok: true, outcome: "recovered-complication", result: { public_reason: recovered.public_reason, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates }, run }; }
  if (verb === "MITIGATE" && run.spatial) { const mitigated = hazardRuntime.mitigate(run, dynamicsDefinitionFor(run.spatial_pack_id), target, run.session.startup.player.observer_id); if (!mitigated.ok) return { ok: false, error: { code: mitigated.code }, result: { public_reason: mitigated.reason }, run }; if (target === "relay-isolation-fault") environment.mutatePower(run.spatial.environment, "relay-circuit", "normal", { at:run.expedition.clock.interval, source:"hazard-mitigation" }); const cycle = resolveOperationalCycle(run, verb, dynamicsRuntime.actionCost(dynamicsDefinitionFor(run.spatial_pack_id), verb), "hazard-mitigation"); return { ok: true, outcome: "mitigated", result: { public_reason: mitigated.public_reason, time_advanced: cycle.clock.cost, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates }, run }; }
  if (verb === "MARK" && run.spatial && !target) { const marker = spatialRuntime.placeMarker(run.spatial, "Survey marker"); event(run.expedition, "spatial.marker.placed", { marker_id: marker.id, location: marker.location }); return { ok: true, outcome: "succeeded", result: { public_reason: `A survey marker now identifies this location for later operations.`, marker, time_advanced: 0, canonical_event_ids: [`spatial.marker.placed:${marker.id}`] }, run }; }
  if (verb === "EXPAND" && run.spatial) {
    const expanded = spatialRuntime.expand(run.spatial, spatialDefinitionFor(run.spatial_pack_id), target);
    if (!expanded.ok) return { ok: false, error: { code: expanded.code }, result: { public_reason: expanded.reason }, run };
    const context = { ...spatialContext(run), observe_objects: () => [] };
    const moved = spatialRuntime.move(run.spatial, spatialDefinitionFor(run.spatial_pack_id), expanded.connection.id, context);
    if (!moved.ok) return { ok: false, error: { code: moved.code }, result: { public_reason: moved.reason }, run };
    const player = run.session.startup.player.observer_id; const present = Object.entries(run.spatial.personnel_locations).filter(([id, location]) => id !== player && location === moved.to).map(([id]) => id);
    surveyFrontier.traverse(run.survey_frontier, topologyFor(run), player, moved.connection_id, moved.from, moved.to, { at: run.expedition.clock?.interval ?? 0, co_present: present });
    event(run.expedition, "spatial.frontier.expanded", { request_id: expanded.request_id, from: moved.from, to: moved.to, connection: moved.connection_id });
    const cycle = resolveOperationalCycle(run, "MOVE", moved.time_cost, "frontier-expansion");
    return { ok: true, outcome: "succeeded", result: { public_reason: `${moved.narration} The surveyed continuation is now part of this world's permanent geography.`, time_advanced: cycle.clock.cost, spatial: { from: moved.from, to: moved.to, connection: moved.connection_id, generation_request: expanded.request_id }, canonical_event_ids: [`spatial.frontier.expanded:${expanded.request_id}`], mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates }, run };
  }
  const authored = objectInteraction(run, verb, target);
  if (authored) return authored;
  if (verb === "RECORD" && run.spatial && !target) return { ok: false, error: { code: "INTERACTION_TARGET_REQUIRED" }, result: { public_reason: "Name the visible object or route you intend to record." }, public_reason: "Name the visible object or route you intend to record.", run };
  if (["COMMUNICATE", "RECORD", "WAIT", "RETURN", "ABORT", "COMPLETE_RETURN"].includes(verb)) return expeditionAction(run, verb, target);
  if (verb === "MOVE" && run.spatial && run._world && phenomenonEcology.isCaptured(run._world, run.session.startup.player.observer_id)) return { ok:false, error:{ code:"PERSONNEL_CAPTURED" }, result:{ public_reason:"Physical restraint prevents free movement." }, public_reason:"Physical restraint prevents free movement.", run };
  if (verb === "MOVE" && run.spatial) { const context = { ...spatialContext(run), observe_objects: () => objectProjection(run).map((object) => object.observation) }; const moved = spatialRuntime.move(run.spatial, spatialDefinitionFor(run.spatial_pack_id), target, context); if (!moved.ok) return { ok: false, error: { code: moved.code }, result: { public_reason: moved.reason }, public_reason: moved.reason, run }; const player = run.session.startup.player.observer_id; const present = Object.entries(run.spatial.personnel_locations).filter(([id, location]) => id !== player && location === moved.to).map(([id]) => id); surveyFrontier.traverse(run.survey_frontier, topologyFor(run), player, moved.connection_id, moved.from, moved.to, { at: run.expedition.clock?.interval ?? 0, co_present: present }); run.checklist.moved = true; observeCurrentObjects(run); event(run.expedition, "spatial.location.entered", { location: moved.to, connection: moved.connection_id, time_cost: moved.time_cost }); const cycle = resolveOperationalCycle(run, verb, moved.time_cost, "spatial-traversal"); const currentView = look(run, { record:false }); run.aliases = Object.fromEntries((currentView.aliases ?? []).map(({ alias, ref }) => [alias, ref])); return { ok: true, outcome: "succeeded", result: { public_reason: moved.narration, time_advanced: cycle.clock.cost, spatial: { from: moved.from, to: moved.to, connection: moved.connection_id }, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates }, run }; }
  if (verb === "MOVE" && run.procedural) { const moved = generatorFor(run.procedural).move(run.procedural, run.session.startup.player.observer_id, target); if (!moved.ok) return { ok: false, error: { code: "TARGET_UNAVAILABLE" }, result: { public_reason: moved.public_reason }, run }; run.checklist.moved = true; event(run.expedition, "procedural.space.discovered", { location: moved.view.location.alias }); return { ok: true, outcome: "succeeded", result: { public_reason: null, view: moved.view }, run }; }
  if (verb === "USE" && target && target !== "field-light") {
    if (target !== "survey-instrument") return { ok: false, error: { code: "EQUIPMENT_UNAVAILABLE" }, run };
    const operator = run.expedition.equipment?.[target]?.holder ?? run.session.startup.player.observer_id;
    if (run.spatial && run.spatial.personnel_locations?.[operator] !== run.spatial.player_location) return { ok: false, error: { code: "EQUIPMENT_NOT_ACCESSIBLE" }, run };
    const used = useEquipment(run.expedition, target, operator); if (!used.ok) return { ok: false, error: { code: used.code }, run };
    run.checklist.used = true;
    event(run.expedition, "measurement.recorded", { equipment: target, interval: run.expedition.clock.interval, type: "qualitative-survey" });
    const referenceMeasurement = referenceExpedition.measurementEvidence(run, operator);
    if (referenceMeasurement) {
      referenceMeasurement.mission_id = run.expedition.mission?.id ?? null;
      referenceMeasurement.environmental_conditions = environment.captureContext(run.spatial.environment, run.spatial.player_location, { has_field_light:q4Equipment.stateUsable(run.expedition.equipment?.["field-light"]) });
      if (run._world) evidenceAuthority.capture(run._world, run, referenceMeasurement);
      if (!(run.expedition.evidence ?? []).some((item) => item.id === referenceMeasurement.id)) run.expedition.evidence.push(referenceMeasurement);
      event(run.expedition, "evidence.recorded", referenceMeasurement);
    }
    const cycle = run.spatial_pack_id ? resolveOperationalCycle(run, verb, dynamicsRuntime.actionCost(dynamicsDefinitionFor(run.spatial_pack_id), verb), "equipment-use") : (operationalTime.advance(run.expedition, 1, "equipment-use"), { clock: { cost: 1 }, mission_updates: [] });
    return { ok: true, outcome: "succeeded", result: { public_reason: referenceMeasurement?.target_observation ?? null, time_advanced: cycle.clock.cost, measurement: referenceMeasurement?.measurement ?? "qualitative-survey", evidence: referenceMeasurement ? { id:referenceMeasurement.id, type:referenceMeasurement.type } : null, mission_updates: cycle.mission_updates, operational_updates: cycle.public_updates ?? [] }, run };
  }
  const action = { MOVE: "traverse-controlled-route", USE: "toggle-light" }[verb];
  if (!action) return { ok: false, error: { code: "UNSUPPORTED_VERB" }, run };
  if (verb === "USE") { const lamp = run.expedition?.equipment?.["field-light"]; if (!lamp || lamp.holder !== run.session.startup.player.observer_id) return { ok: false, error: { code: "EQUIPMENT_NOT_ACCESSIBLE" }, run }; if (!q4Equipment.stateUsable(lamp) || lamp.charges <= 0) return { ok: false, error: { code: "EQUIPMENT_UNAVAILABLE" }, run }; }
  const result = submitSessionAction({ session: run.session, actor: run.session.startup.player.observer_id, action, target });
  if (result.session) run.session = result.session;
  if (result.ok && result.outcome === "succeeded") { if (verb === "MOVE") run.checklist.moved = true; if (verb === "USE") { run.checklist.used = true; if (run.expedition) useEquipment(run.expedition, "field-light", run.session.startup.player.observer_id); } }
  return { ...result, run };
}
function crossThreshold(runValue, { require_radio_check = true } = {}) {
  const run = normalizeRun(runValue);
  if (run.spatial_pack_id && run.spatial) {
    const definition = spatialDefinitionFor(run.spatial_pack_id);
    if (run.spatial.player_location !== definition.phase_locations?.THRESHOLD) return { ok: false, error: { code: "THRESHOLD_CROSSING_UNAVAILABLE" }, result: { public_reason: "The party is not at the Threshold crossing point." }, run };
    if (run.spatial.route_history.some((item) => item.connection_id === "threshold-crossing")) return { ok: false, error: { code: "THRESHOLD_ALREADY_CROSSED" }, result: { public_reason: "The recorded Threshold crossing has already occurred." }, run };
    if (require_radio_check && !q4Radio.read(run.expedition).check_completed) return { ok: false, error: { code: "RADIO_CHECK_REQUIRED" }, result: { public_reason: "Complete the acknowledged Standard radio check before crossing." }, run };
  }
  const result = submitSessionAction({ session: run.session, actor: run.session.startup.player.observer_id, action: "traverse-controlled-route" });
  if (!result.ok) return { ...result, run };
  if (result.session) run.session = result.session;
  if (!run.spatial_pack_id || !run.spatial) return { ...result, run };
  run.spatial.authorizations["threshold-authorized"] = true;
  run.spatial.authorizations["radio-check-complete"] = q4Radio.read(run.expedition).check_completed;
  const moved = spatialRuntime.move(run.spatial, spatialDefinitionFor(run.spatial_pack_id), "threshold-crossing", spatialContext(run));
  if (!moved.ok) return { ok: false, error: { code: moved.code }, result: { public_reason: moved.reason }, run };
  const route = run.spatial.route_history.at(-1);
  recordFacilityEvent(run.expedition, "THRESHOLD_CROSSING", { at:{ interval:run.expedition.clock?.interval ?? 0, spatial_time:route?.at ?? run.spatial.time ?? 0 }, source:"canonical-spatial-traversal", source_ref:`threshold-crossing:${route?.sequence ?? 1}` });
  return { ...result, result: { ...(result.result ?? {}), public_reason: moved.narration }, spatial: { from: moved.from, to: moved.to, connection: moved.connection_id }, run };
}
function saveRun(runValue) { const run = normalizeRun(runValue); return { version: "yellow-beast-save@v9", profile_id: run.profile_id, profile_title: run.profile_title, scenario: run.scenario, seed: run.seed, lifecycle: run.lifecycle, checklist: clone(run.checklist), aliases: clone(run.aliases), expedition: clone(run.expedition), procedural: clone(run.procedural), spatial_pack_id: run.spatial_pack_id, spatial: clone(run.spatial), object_state: clone(run.object_state), survey_frontier: clone(run.survey_frontier), interpretation_state: clone(run.interpretation_state), world_id: run.world_id, run_id: run.run_id, envelope: exportSession(run.session).envelope }; }
function resumeRun(save, { world = null, spatial_worldpack = null, phase = "BRIEFING" } = {}) {
  const supported = new Set(Array.from({ length: 9 }, (_, index) => `yellow-beast-save@v${index + 1}`));
  if (!supported.has(save?.version)) return { ok: false, error: { code: "SAVE_VERSION_UNSUPPORTED" } };
  const restored = restoreSession(save.envelope); if (!restored.ok) return restored;
  const packId = save.spatial_pack_id ?? spatial_worldpack;
  try { if (save.procedural) generatorFor(save.procedural); if (packId) { spatialDefinitionFor(packId); interactionDefinitionFor(packId); missionDefinitionFor(packId); } } catch (error) { return { ok: false, error: { code: error.code ?? "GENERATOR_VERSION_UNSUPPORTED" } }; }
  if (world && save.world_id && world.world_id !== save.world_id) return { ok: false, error: { code: "WORLD_ID_MISMATCH" } };
  if (save.version === "yellow-beast-save@v9") {
    const run = { version:"yellow-beast-run@v9", profile_id:save.profile_id, profile_title:save.profile_title, scenario:save.scenario, seed:save.seed, session:restored.session, lifecycle:save.lifecycle ?? "active", checklist:clone(save.checklist), aliases:clone(save.aliases), expedition:clone(save.expedition), procedural:clone(save.procedural), spatial_pack_id:packId, spatial:clone(save.spatial), object_state:clone(save.object_state), survey_frontier:clone(save.survey_frontier), interpretation_state:clone(save.interpretation_state), world_id:save.world_id, run_id:save.run_id, _world:world };
    try { normalizeRun(run); } catch (error) { return { ok:false, error:{ code:error.code ?? "RUN_STATE_INVALID" } }; }
    missionRuntime.attachCompatibilityView(run.expedition);
    run.identity = runIdentity.describe(run);
    return { ok:true, run };
  }
  const run = newRun({ profile: save.profile_id, seed: save.seed, session: restored.session, expedition: clone(save.expedition), procedural_state: clone(save.procedural), procedural_scenario: Boolean(save.procedural), spatial_pack_id: packId, spatial_state: clone(save.spatial), object_state: clone(save.object_state), survey_frontier: clone(save.survey_frontier), interpretation_state: clone(save.interpretation_state), world_id: save.world_id, run_id: save.run_id, world, phase }); run.lifecycle = save.lifecycle ?? "active"; run.checklist = clone(save.checklist ?? run.checklist); run.aliases = clone(save.aliases ?? {}); evaluateMissionState(run, phase); return { ok: true, run };
}

if (require.main === module) { const args = process.argv.slice(2); const value = (name) => args[args.indexOf(name) + 1]; const result = startRun({ profile: value("--profile") || "lost", seed: value("--seed") || "yellow-beast-bootstrap" }); console.log(JSON.stringify(result.ok ? result.summary : result, null, 2)); process.exitCode = result.ok ? 0 : 1; }
module.exports = { startRun, status, look, inspect, act, resolveCoordinatedAttempts, saveRun, resumeRun, generatorFor, spatialDefinitionFor, topologyFor, interactionDefinitionFor, missionDefinitionFor, dynamicsDefinitionFor, logisticsDefinitionFor, institutionalDefinitionFor, ensureSpatial, setSpatialPhase, enterSpatialField, crossThreshold, objectProjection, evaluateMissionState, resolveOperationalCycle, synchronizeMissionOutcome };
