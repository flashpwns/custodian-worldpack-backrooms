"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSession, exportSession, restoreSession, stableSerialize, getAvailableSessionActions, submitSessionAction, inspectSessionObserver } = require("custodian");
const { FIELD_SCENARIO, fieldExpedition, event, useEquipment, safeSummary, finalize } = require("./expedition");
const procedural = require("./procedural-complex");
const proceduralV2 = require("./procedural-complex-v2");
const history = require("./world-history");
const q4Personnel = require("./q4-personnel");
const q4Equipment = require("./q4-equipment");
const q4Missions = require("./q4-missions");
const q4Continuity = require("./q4-continuity");
const q4Visuals = require("./q4-visuals");
const q4RenderAdapters = require("./q4-render-adapters");
const runIdentity = require("./run-identity");
const spatialRuntime = require("./spatial-runtime");
const objectRuntime = require("./object-runtime");
const missionRuntime = require("./mission-runtime");
const q4Time = require("./q4-time");
const q4Radio = require("./q4-radio");

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
function missionDefinitionFor(packId) {
  if (typeof packId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(packId)) throw new Error("invalid mission worldpack id");
  const definition = read(`data/worldpacks/${packId}/mission.json`);
  const spatial = spatialDefinitionFor(packId);
  const interactions = interactionDefinitionFor(packId);
  missionRuntime.validateDefinition(definition, {
    objects: interactions.objects.map((item) => item.id),
    locations: spatial.locations.map((item) => item.id),
    connections: spatial.connections.map((item) => item.id),
    equipment: Object.keys(q4Equipment.DEFINITIONS),
    personnel_roles: ["field surveyor", "survey technician"]
  });
  return definition;
}
function spatialContext(run) {
  const player = run.session.startup.player.observer_id;
  const members = (run.expedition?.team?.members ?? []).map((member) => member.personnel_id ?? member.id).filter((id) => id && id !== player);
  const equipment = Object.values(run.expedition?.equipment ?? {});
  return { player, personnel: members, equipment, personnel_records: run.expedition?.team?.members ?? [] };
}

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
  if (profileId === FIELD_PROFILE) {
    const peerActor = "yb-field-peer-actor";
    scenario.actors.push({ id: peerActor, position: "complex-side-controlled-area" });
    scenario.observers.push({ id: "yb-field-peer-observer", goals: [], plans: [], actor_id: peerActor, origin: "embodied", capabilities: ["visual"], access: ["field-survey"] });
  }
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
function newRun({ profile, seed, session, expedition, staffing = null, loadout = null, mission = null, procedural_state, procedural_scenario = false, spatial_state = null, object_state = null, spatial_pack_id = null, world_id = null, run_id = null, world = null, phase = "BRIEFING" }) {
  const profileRecord = profileFor(profile);
  const player = session.startup.player.observer_id;
  const run = { version: "yellow-beast-run@v7", profile_id: profile, profile_title: profileRecord.title, scenario: procedural_scenario ? "async-clear-q4-procedural-survey" : session.scenario.id, seed, session, lifecycle: "active", checklist: { moved: false, inspected: false, used: false }, aliases: {}, expedition: expedition ?? (profile === FIELD_PROFILE ? fieldExpedition(player, staffing, loadout, mission) : null), procedural: procedural_scenario ? (procedural_state ?? procedural.initialize({ seed, observer: player })) : null, spatial_pack_id: profile === FIELD_PROFILE ? spatial_pack_id : null, spatial: spatial_state, object_state, world_id, run_id, _world: world };
  if (run.spatial_pack_id) {
    const definition = spatialDefinitionFor(run.spatial_pack_id);
    const context = spatialContext(run);
    run.spatial = spatialRuntime.migrate(run.spatial, definition, { ...context, phase });
    spatialRuntime.syncEquipment(run.spatial, run.expedition);
    const interactions = interactionDefinitionFor(run.spatial_pack_id);
    run.object_state = objectRuntime.migrate(run.object_state, interactions);
    const missionDefinition = missionDefinitionFor(run.spatial_pack_id);
    const legacyObjectives = run.expedition?.objectives ? clone(run.expedition.objectives) : null;
    run.expedition.mission_state = missionRuntime.migrate(run.expedition.mission_state, missionDefinition, { instance_id: run.expedition.mission?.id ?? missionDefinition.mission.id, phase, legacy_objectives: legacyObjectives, at: run.expedition.clock?.interval ?? 0 });
    missionRuntime.attachCompatibilityView(run.expedition);
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
  const run_id = world ? history.beginRun(world, { profile, scenario: procedural_scenario ? "async-clear-q4-procedural-survey" : result.session.scenario.id, seed }) : null;
  const staffing = profile === FIELD_PROFILE && world ? q4Personnel.staffQ4(world, run_id, player, seed) : null;
  if (staffing && !staffing.ok) return { ok: false, error: { code: staffing.code } };
  const mission = profile === FIELD_PROFILE ? q4Missions.generate({ world, run_id, seed, staffing }) : null;
  if (mission && world) history.recordQ4Mission(world, run_id, mission);
  const loadout = profile === FIELD_PROFILE && world ? q4Equipment.prepare(world, run_id, { player: staffing.player.identity, peer: staffing.assistant ? staffing.peer.identity : null, assistant: staffing.assistant?.identity, required_keys: mission.required_equipment }) : null;
  const existing = region_id && world?.regions?.[region_id];
  let generator; try { generator = generatorFor(existing?.generator_version ?? generator_version ?? procedural.VERSION); } catch (error) { return { ok: false, error: { code: error.code ?? "GENERATOR_VERSION_UNSUPPORTED" } }; }
  const procedural_state = existing ? clone(history.restoreRegion(world, region_id).state) : (procedural_scenario && generator_version === proceduralV2.VERSION ? generator.initialize({ seed, observer: player, policy: "moderate" }) : undefined);
  if (procedural_state) { const known = procedural_state.discovery[player] ?? { spaces: [], edges: [], features: [] }; procedural_state.discovery = { [player]: { spaces: [], edges: [], features: [] } }; procedural_state.current = { [player]: Object.keys(procedural_state.nodes)[0] }; void known; }
  const run = newRun({ profile, seed, session: result.session, staffing, loadout, mission, procedural_scenario, procedural_state, spatial_pack_id: spatial_worldpack, world_id: world?.world_id ?? null, run_id, world });
  return { ok: restored.ok, session: result.session, run, restored_equivalent: restored.ok && stableSerialize(restored.session) === stableSerialize(result.session), summary: { session_id: result.session.id, profile, profile_title: profileRecord.title, scenario: result.session.scenario.id, seed, player: startup.player, knowledge: startup.knowledge, permissions: startup.permissions, resources: startup.resources } };
}
function normalizeRun(value) {
  if (value?.version === "yellow-beast-run@v7") { missionRuntime.attachCompatibilityView(value.expedition); return value; }
  if (["yellow-beast-run@v6", "yellow-beast-run@v5", "yellow-beast-run@v4", "yellow-beast-run@v3", "yellow-beast-run@v2", "yellow-beast-run@v1"].includes(value?.version)) return newRun({ profile: value.profile_id, seed: value.seed, session: value.session, expedition: value.expedition, procedural_state: value.procedural, procedural_scenario: Boolean(value.procedural), spatial_state: value.spatial, object_state: value.object_state, spatial_pack_id: value.spatial_pack_id ?? null, world_id: value.world_id, run_id: value.run_id });
  if (value?.session) return newRun({ profile: value.session.startup.profile.id, seed: value.session.seed_material?.seed ?? "restored", session: value.session });
  return newRun({ profile: value.startup.profile.id, seed: value.seed_material?.seed ?? "restored", session: value });
}
function ensureSpatial(runValue, phase = "BRIEFING") {
  const run = normalizeRun(runValue);
  if (!run.spatial_pack_id) return run;
  const definition = spatialDefinitionFor(run.spatial_pack_id);
  const legacy = run.procedural ? generatorFor(run.procedural).visible(run.procedural, run.session.startup.player.observer_id)?.location?.alias : null;
  run.spatial = spatialRuntime.migrate(run.spatial, definition, { ...spatialContext(run), phase, legacy_location: legacy });
  spatialRuntime.syncEquipment(run.spatial, run.expedition);
  const interactions = interactionDefinitionFor(run.spatial_pack_id);
  run.object_state = objectRuntime.migrate(run.object_state, interactions);
  const missionDefinition = missionDefinitionFor(run.spatial_pack_id);
  const legacyObjectives = run.expedition?.objectives ? clone(run.expedition.objectives) : null;
  run.expedition.mission_state = missionRuntime.migrate(run.expedition.mission_state, missionDefinition, { instance_id: run.expedition.mission?.id ?? missionDefinition.mission.id, phase, legacy_objectives: legacyObjectives, at: run.expedition.clock?.interval ?? 0 });
  missionRuntime.attachCompatibilityView(run.expedition);
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
function observeCurrentObjects(run) {
  if (!run.object_state || !run.spatial) return [];
  return objectRuntime.observeLocation(run.object_state, interactionDefinitionFor(run.spatial_pack_id), { observer: run.session.startup.player.observer_id, location: run.spatial.player_location, time: run.expedition?.clock?.interval ?? 0 });
}
function toolAdapter(run) {
  const observer = run.session.startup.player.observer_id;
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
  spatialRuntime.syncEquipment(run.spatial, run.expedition);
  if (["FIELD_OPERATION", "RETURN", "DEBRIEF"].includes(phase)) observeCurrentObjects(run);
  evaluateMissionState(run, phase);
  return run;
}
function enterSpatialField(runValue) {
  const run = ensureSpatial(runValue, "FIELD_OPERATION");
  if (!run.spatial_pack_id) return run;
  spatialRuntime.enterField(run.spatial, spatialDefinitionFor(run.spatial_pack_id), spatialContext(run));
  spatialRuntime.syncEquipment(run.spatial, run.expedition);
  observeCurrentObjects(run);
  evaluateMissionState(run, "FIELD_OPERATION");
  return run;
}
function look(runValue) {
  const run = normalizeRun(runValue);
  const observer = run.session.startup.player.observer_id;
  if (run.spatial) {
    observeCurrentObjects(run);
    evaluateMissionState(run);
    const definition = spatialDefinitionFor(run.spatial_pack_id);
    const location = spatialRuntime.currentLocation(run.spatial, definition);
    const exits = spatialRuntime.visibleExits(run.spatial, definition);
    const objects = objectProjection(run);
    const features = [...(location?.landmarks ?? []).map((feature) => ({ alias: feature.name, kind: "landmark" })), ...objects.map((object) => ({ alias: object.name, kind: object.object_type }))];
    const aliases = Object.fromEntries([...features.map((feature) => [feature.alias, feature.alias]), ...exits.map((exit) => [exit.label, exit.ref])]);
    run.aliases = aliases;
    return { outcome: "succeeded", observer_id: observer, kind: "look", view: { location: { id: location?.id, alias: location?.name, family: location?.type, lighting: location?.environment?.lighting, description: location?.short_description }, features, objects, exits: exits.map((exit) => ({ alias: exit.label, edge_id: exit.ref, destination_known: exit.destination_known, status: exit.status })), environment: clone(location?.environment ?? {}) }, targets: Object.keys(aliases).map((alias) => ({ alias })), aliases: Object.entries(aliases).map(([alias, ref]) => ({ alias, ref })), public_reason: null, spatial_version: spatialRuntime.VERSION, object_state_version: objectRuntime.VERSION };
  }
  if (run.procedural) {
    const generator = generatorFor(run.procedural); const view = generator.visible(run.procedural, observer); if (generator.VERSION === proceduralV2.VERSION) { const local = generator.observe(run.procedural, observer, run.profile_id); view.landmark = local.landmark; view.objects = local.objects; view.environment = local.environment; view.route_character = local.route_character; }
    const aliases = Object.fromEntries([...view.features.map((feature) => [feature.alias, feature.alias]), ...view.exits.map((exit) => [exit.alias, exit.alias])]);
    run.aliases = aliases;
    return { outcome: "succeeded", observer_id: observer, kind: "look", view, targets: Object.keys(aliases).map((alias) => ({ alias })), aliases: Object.keys(aliases).map((alias) => ({ alias, ref: aliases[alias] })), public_reason: null, generator_version: generator.VERSION };
  }
  const result = inspectSessionObserver({ session: run.session, observer, request: { id: `look-${run.session.id}`, kind: "look" } });
  const aliases = Object.fromEntries((result.targets ?? []).map((target, index) => [`fixture-${index + 1}`, target.ref]));
  run.aliases = aliases;
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
  const view = look(run);
  const actions = getAvailableSessionActions({ session: run.session, actor: observer }).actions;
  const active = run.lifecycle === "active";
  const closing = run.expedition?.mission_state?.return?.requested === true;
  const expeditionVerbs = active && run.expedition ? ["COMMUNICATE", "RECORD", "WAIT", "RETURN", "ABORT", ...(closing ? ["COMPLETE_RETURN"] : [])] : [];
  const objectVerbs = active ? [...new Set((view.view?.objects ?? []).flatMap((object) => object.actions ?? []).map((item) => item.action))] : [];
  const discovered = run.spatial ? spatialRuntime.project(run.spatial, spatialDefinitionFor(run.spatial_pack_id), { personnel: (run.expedition?.team?.members ?? []).map((member) => ({ id: member.personnel_id ?? member.id, name: member.display_name })) }) : run.procedural ? generatorFor(run.procedural).map(run.procedural, observer) : null;
  return { profile_id: run.profile_id, profile_title: run.profile_title, scenario: run.scenario, lifecycle: run.lifecycle, player: observer, run_identity: runIdentity.describe(run), known_resources: (run.session.startup.resources ?? []).filter((entry) => entry.custodian === observer).map((entry) => entry.id), available_verbs: [...new Set(["LOOK", ...(active && view.targets?.length ? ["INSPECT"] : []), ...(active && ((run.spatial || run.procedural) ? view.view?.exits?.length : actions.includes("traverse-controlled-route")) ? ["MOVE"] : []), ...(active && actions.includes("toggle-light") ? ["USE"] : []), ...objectVerbs, ...expeditionVerbs])], view: { outcome: view.outcome, location: view.view?.location ?? null, targets: (view.aliases ?? []).map(({ alias }) => ({ alias })), observations: { environment: view.view?.environment ?? {}, landmark: view.view?.landmark ?? null, objects: view.view?.objects ?? [], route_character: view.view?.route_character ?? null }, public_reason: view.public_reason ?? null }, ...(run.expedition ? { expedition: safeSummary(run.expedition) } : {}), ...(discovered ? { discovered_topology: discovered } : {}), ...(run.procedural ? { generator_version: generatorFor(run.procedural).VERSION } : {}), ...(run.spatial ? { spatial_version: spatialRuntime.VERSION, object_state_version: run.object_state?.version ?? null } : {}) };
}
function terminal(run, decision) { finalize(run.expedition, decision, { checklist: run.checklist }); run.lifecycle = "completed"; const continuity = run._world && run.run_id ? q4Continuity.commitOutcome(run._world, run, decision) : null; const ingestion = run._world && run.run_id ? history.ingestRun(run._world, run) : null; return { ok: true, outcome: "succeeded", result: { public_reason: null, expedition_result: clone(run.expedition.result), ...(continuity ? { continuity: { outcome: continuity.outcome, review_id: continuity.review.mission_id } } : {}), ...(ingestion ? { history: { run_id: ingestion.run_id, region_id: ingestion.region_id } } : {}) }, run }; }
function expeditionAction(run, verb, target) {
  const expedition = run.expedition; const player = run.session.startup.player.observer_id;
  if (!expedition) return { ok: false, error: { code: "UNSUPPORTED_VERB" }, run };
  if (verb === "WAIT") { const checkIn = q4Time.advance(expedition, 1); event(expedition, "expedition.waited", { interval: expedition.clock.interval }); const missionUpdates = evaluateMissionState(run); return { ok: true, outcome: "succeeded", result: { public_reason: checkIn.state === "overdue" ? "The scheduled check-in is overdue." : "The team waits and the operational clock advances.", time_advanced: 1, mission_updates: missionUpdates }, run }; }
  if (verb === "COMMUNICATE") { if (!["standard", "teammate", "team"].includes(target)) return { ok: false, error: { code: "RECIPIENT_UNAVAILABLE" }, run }; const radio = useEquipment(expedition, "survey-radio", player); if (!radio.ok) return { ok: false, error: { code: radio.code }, run }; const recipient = target === "standard" ? "Standard" : "yb-field-peer-observer"; const delivered = target === "standard" || expedition.team.members[1].status === "active"; const message = { id: `message-${expedition.messages.length + 1}`, sender: player, intended_recipient: recipient, delivery_status: delivered ? "delivered" : "unavailable", channel: "survey-radio", provenance: "pack-original-expedition", interval: expedition.clock.interval, purpose: target === "standard" ? "scheduled-check-in" : "team-contact" }; expedition.messages.push(message); if (target === "standard" && delivered) q4Time.complete(expedition); event(expedition, "communication.sent", message); const missionUpdates = evaluateMissionState(run); return { ok: true, outcome: "succeeded", result: { public_reason: delivered ? "message delivered" : "message unavailable", message: { recipient: target, delivery_status: message.delivery_status }, mission_updates: missionUpdates }, run }; }
  if (verb === "RECORD") { const view = look(run); const alias = target ?? view.aliases[0]?.alias; if (!alias || !view.aliases.some((entry) => entry.alias === alias)) return { ok: false, error: { code: "TARGET_UNAVAILABLE" }, run }; const device = useEquipment(expedition, "recording-device", player); if (!device.ok) return { ok: false, error: { code: device.code }, run }; const evidence = { id: `field-note-${expedition.evidence.length + 1}`, type: "field-note", creator: player, custodian: player, target_alias: alias, location: view.view?.location ?? null, capture_event: "evidence.recorded", device: "recording-device", storage: "with field record", captured_at: { interval: expedition.clock.interval }, target_observation: "observer-visible target", visible_objects: [alias], provenance: "observer-safe-record", valid: true, available_to_player: true, available_to_standard: false, reporting_state: "unreported", interval: expedition.clock.interval }; const spec = q4Visuals.renderSpec(evidence); const queued = q4RenderAdapters.queue(spec); evidence.render = queued.job; evidence.visual = queued.job.result; expedition.evidence.push(evidence); expedition.render_jobs ??= []; expedition.render_jobs.push(queued.job); event(expedition, "evidence.recorded", evidence); const missionUpdates = evaluateMissionState(run); return { ok: true, outcome: "succeeded", result: { public_reason: null, evidence: { id: evidence.id, type: evidence.type, render_status: evidence.render.status }, mission_updates: missionUpdates }, run }; }
  if (verb === "RETURN") { if (!expedition.mission_state) return terminal(run, verb); const requested = missionRuntime.requestReturn(expedition.mission_state, missionDefinitionFor(run.spatial_pack_id), { run, player }, { at: expedition.clock?.interval ?? 0 }); if (!requested.ok) return { ok: false, error: { code: requested.code }, result: { public_reason: requested.reason }, run }; const missionUpdates = evaluateMissionState(run, "RETURN"); return { ok: true, outcome: "return-begun", result: { public_reason: requested.reason, mission_updates: missionUpdates }, run }; }
  if (verb === "ABORT") { if (!expedition.mission_state) return terminal(run, verb); const requested = missionRuntime.requestAbort(expedition.mission_state, missionDefinitionFor(run.spatial_pack_id), { run, player }, { at: expedition.clock?.interval ?? 0 }); if (!requested.ok) return { ok: false, error: { code: requested.code }, result: { public_reason: requested.reason }, run }; const missionUpdates = [...(requested.transitions ?? []), ...evaluateMissionState(run, "RETURN")]; expedition.mission_state.recent_updates = missionUpdates.slice(-5).map((transition) => ({ headline: transition.headline, summary: transition.reason, state: transition.to, at: expedition.clock?.interval ?? 0 })); return { ok: true, outcome: "controlled-abort-begun", result: { public_reason: requested.reason, mission_updates: missionUpdates }, run }; }
  if (verb === "COMPLETE_RETURN") {
    const definition = missionDefinitionFor(run.spatial_pack_id); const state = expedition.mission_state;
    if (!state?.return?.requested) return { ok: false, error: { code: "RETURN_NOT_REQUESTED" }, result: { public_reason: "Begin the return procedure before mission closure." }, run };
    evaluateMissionState(run, "RETURN");
    const closure = missionRuntime.requestClosure(state, definition, { run, player }, { at: expedition.clock?.interval ?? 0 });
    if (!closure.ok) return { ok: false, error: { code: closure.code }, result: { public_reason: closure.reason }, run };
    const closureRadio = expedition.equipment?.["survey-radio"];
    if (q4Radio.available(expedition) && q4Equipment.stateUsable(closureRadio) && closureRadio.charges > 0 && !(expedition.messages ?? []).some((message) => message.purpose === "mission-closure" && message.delivery_status === "delivered")) {
      useEquipment(expedition, "survey-radio", player);
      const message = { id: `message-${expedition.messages.length + 1}`, sender: player, intended_recipient: "Standard", delivery_status: "delivered", channel: "survey-radio", purpose: "mission-closure", provenance: "condition-driven-return-procedure", interval: expedition.clock.interval };
      expedition.messages.push(message); event(expedition, "communication.sent", message);
    }
    const missionUpdates = evaluateMissionState(run, "RETURN");
    return { ok: true, outcome: run.lifecycle === "completed" ? "mission-closed" : "return-reconciliation-pending", result: { public_reason: expedition.result?.public_debrief_summary ?? closure.reason, mission_updates: missionUpdates, expedition_result: clone(expedition.result) }, run };
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
    const queued = q4RenderAdapters.queue(q4Visuals.renderSpec(evidence));
    evidence.render = queued.job;
    evidence.visual = queued.job.result;
    run.expedition.render_jobs ??= [];
    run.expedition.render_jobs.push(queued.job);
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
    advanceTime: (cost) => { q4Time.advance(run.expedition, cost); run.spatial.time = (run.spatial.time ?? 0) + cost; },
    onEvidence
  });
  if (!result.ok) return { ok: false, error: { code: result.code }, result: { public_reason: result.reason }, public_reason: result.reason, run };
  run.checklist.used = action !== "inspect" ? true : run.checklist.used;
  const objectives = evaluateMissionState(run);
  const eventId = `object.interaction.${result.interaction_sequence ?? run.object_state.interaction_history.length}`;
  event(run.expedition, "object.interacted", { action: result.action, target: result.target, location: run.spatial.player_location, interaction_sequence: result.interaction_sequence, evidence_id: result.evidence?.id ?? null, time_cost: result.time_cost });
  return { ok: true, outcome: "succeeded", result: { public_reason: result.narration, time_advanced: result.time_cost, state_changed: result.state_changed, evidence: result.evidence ? { id: result.evidence.id, type: result.evidence.type, render_status: result.evidence.render?.status ?? "fallback-ready" } : null, mission_updates: objectives, canonical_event_ids: [eventId] }, run };
}
function act(runValue, verb, target) {
  const run = normalizeRun(runValue);
  if (verb === "LOOK") return { ok: true, outcome: "succeeded", result: look(run), run };
  if (verb === "INSPECT") { const result = inspect(run, target); return result.outcome === "succeeded" ? { ok: true, outcome: "succeeded", result, run } : { ok: false, outcome: "rejected", error: { code: "INTERACTION_TARGET_UNAVAILABLE" }, result, public_reason: result.public_reason, run }; }
  if (run.lifecycle === "completed") return { ok: false, error: { code: "RUN_COMPLETE" }, run };
  const authored = objectInteraction(run, verb, target);
  if (authored) return authored;
  if (verb === "RECORD" && run.spatial && !target) return { ok: false, error: { code: "INTERACTION_TARGET_REQUIRED" }, result: { public_reason: "Name the visible object or route you intend to record." }, public_reason: "Name the visible object or route you intend to record.", run };
  if (["COMMUNICATE", "RECORD", "WAIT", "RETURN", "ABORT", "COMPLETE_RETURN"].includes(verb)) return expeditionAction(run, verb, target);
  if (verb === "MOVE" && run.spatial) { const context = { ...spatialContext(run), observe_objects: () => objectProjection(run).map((object) => object.observation) }; const moved = spatialRuntime.move(run.spatial, spatialDefinitionFor(run.spatial_pack_id), target, context); if (!moved.ok) return { ok: false, error: { code: moved.code }, result: { public_reason: moved.reason }, public_reason: moved.reason, run }; run.checklist.moved = true; q4Time.advance(run.expedition, moved.time_cost); spatialRuntime.syncEquipment(run.spatial, run.expedition); observeCurrentObjects(run); event(run.expedition, "spatial.location.entered", { location: moved.to, connection: moved.connection_id, time_cost: moved.time_cost }); const missionUpdates = evaluateMissionState(run); return { ok: true, outcome: "succeeded", result: { public_reason: moved.narration, time_advanced: moved.time_cost, spatial: { from: moved.from, to: moved.to, connection: moved.connection_id }, mission_updates: missionUpdates }, run }; }
  if (verb === "MOVE" && run.procedural) { const moved = generatorFor(run.procedural).move(run.procedural, run.session.startup.player.observer_id, target); if (!moved.ok) return { ok: false, error: { code: "TARGET_UNAVAILABLE" }, result: { public_reason: moved.public_reason }, run }; run.checklist.moved = true; event(run.expedition, "procedural.space.discovered", { location: moved.view.location.alias }); return { ok: true, outcome: "succeeded", result: { public_reason: null, view: moved.view }, run }; }
  if (verb === "USE" && target && target !== "field-light") {
    if (target !== "survey-instrument") return { ok: false, error: { code: "EQUIPMENT_UNAVAILABLE" }, run };
    const used = useEquipment(run.expedition, target, run.session.startup.player.observer_id); if (!used.ok) return { ok: false, error: { code: used.code }, run };
    run.checklist.used = true;
    event(run.expedition, "measurement.recorded", { equipment: target, interval: run.expedition.clock.interval, type: "qualitative-survey" });
    const missionUpdates = evaluateMissionState(run);
    return { ok: true, outcome: "succeeded", result: { public_reason: null, measurement: "qualitative-survey", mission_updates: missionUpdates }, run };
  }
  const action = { MOVE: "traverse-controlled-route", USE: "toggle-light" }[verb];
  if (!action) return { ok: false, error: { code: "UNSUPPORTED_VERB" }, run };
  if (verb === "USE") { const lamp = run.expedition?.equipment?.["field-light"]; if (!lamp || lamp.holder !== run.session.startup.player.observer_id) return { ok: false, error: { code: "EQUIPMENT_NOT_ACCESSIBLE" }, run }; if (!q4Equipment.stateUsable(lamp) || lamp.charges <= 0) return { ok: false, error: { code: "EQUIPMENT_UNAVAILABLE" }, run }; }
  const result = submitSessionAction({ session: run.session, actor: run.session.startup.player.observer_id, action, target });
  if (result.session) run.session = result.session;
  if (result.ok && result.outcome === "succeeded") { if (verb === "MOVE") run.checklist.moved = true; if (verb === "USE") { run.checklist.used = true; if (run.expedition) useEquipment(run.expedition, "field-light", run.session.startup.player.observer_id); } }
  return { ...result, run };
}
function crossThreshold(runValue) { const run = normalizeRun(runValue); const result = submitSessionAction({ session: run.session, actor: run.session.startup.player.observer_id, action: "traverse-controlled-route" }); if (result.session) run.session = result.session; return { ...result, run }; }
function saveRun(runValue) { const run = normalizeRun(runValue); return { version: "yellow-beast-save@v7", profile_id: run.profile_id, profile_title: run.profile_title, scenario: run.scenario, seed: run.seed, lifecycle: run.lifecycle, checklist: clone(run.checklist), aliases: clone(run.aliases), expedition: clone(run.expedition), procedural: clone(run.procedural), spatial_pack_id: run.spatial_pack_id, spatial: clone(run.spatial), object_state: clone(run.object_state), world_id: run.world_id, run_id: run.run_id, envelope: exportSession(run.session).envelope }; }
function resumeRun(save, { world = null, spatial_worldpack = null, phase = "BRIEFING" } = {}) { const restored = restoreSession(save.envelope); if (!restored.ok) return restored; const packId = save.spatial_pack_id ?? spatial_worldpack; try { if (save.procedural) generatorFor(save.procedural); if (packId) { spatialDefinitionFor(packId); interactionDefinitionFor(packId); missionDefinitionFor(packId); } } catch (error) { return { ok: false, error: { code: error.code ?? "GENERATOR_VERSION_UNSUPPORTED" } }; } if (world && save.world_id && world.world_id !== save.world_id) return { ok: false, error: { code: "WORLD_ID_MISMATCH" } }; const run = newRun({ profile: save.profile_id, seed: save.seed, session: restored.session, expedition: clone(save.expedition), procedural_state: clone(save.procedural), procedural_scenario: Boolean(save.procedural), spatial_pack_id: packId, spatial_state: clone(save.spatial), object_state: clone(save.object_state), world_id: save.world_id, run_id: save.run_id, world, phase }); run.lifecycle = save.lifecycle ?? "active"; run.checklist = clone(save.checklist ?? run.checklist); run.aliases = clone(save.aliases ?? {}); evaluateMissionState(run, phase); return { ok: true, run }; }

if (require.main === module) { const args = process.argv.slice(2); const value = (name) => args[args.indexOf(name) + 1]; const result = startRun({ profile: value("--profile") || "lost", seed: value("--seed") || "yellow-beast-bootstrap" }); console.log(JSON.stringify(result.ok ? result.summary : result, null, 2)); process.exitCode = result.ok ? 0 : 1; }
module.exports = { startRun, status, look, inspect, act, saveRun, resumeRun, generatorFor, spatialDefinitionFor, interactionDefinitionFor, missionDefinitionFor, ensureSpatial, setSpatialPhase, enterSpatialField, crossThreshold, objectProjection, evaluateMissionState, synchronizeMissionOutcome };
