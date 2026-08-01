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
const runIdentity = require("./run-identity");

const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const clone = (value) => structuredClone(value);
const FIELD_PROFILE = "field-researcher";
function generatorFor(stateOrVersion) { const version = typeof stateOrVersion === "string" ? stateOrVersion : stateOrVersion?.version; if (version === procedural.VERSION) return procedural; if (version === proceduralV2.VERSION) return proceduralV2; throw Object.assign(new Error(`unsupported generator version: ${version ?? "missing"}`), { code: "GENERATOR_VERSION_UNSUPPORTED" }); }

function profileFor(profileId) { return read("profiles/profiles.json").profiles.find((profile) => profile.id === profileId); }
function startupFor(profileId) {
  const profile = profileFor(profileId);
  const config = read("profiles/startups.json").startups.find((entry) => entry.profile === profileId);
  if (!profile || !config) throw new Error(`unknown profile: ${profileId}`);
  const knowledge = read("profiles/knowledge.json").profiles.find((entry) => entry.id === profile.starting_knowledge_profile);
  const permissions = read("profiles/permissions.json").sets.find((entry) => entry.id === profile.starting_permissions);
  const resources = read("profiles/resources.json").profiles.find((entry) => entry.id === profile.starting_resource_profile);
  const declared = profileId === FIELD_PROFILE ? ["traverse-controlled-route", "toggle-light"] : [];
  return { profile, startup: { profile: { id: profile.id }, player: config.player, knowledge: [...knowledge.institutional_records, ...config.knowledge.map((entry) => entry.reference)].map((reference, index) => ({ observer_id: config.player.observer_id, kind: config.knowledge[index]?.kind ?? "institutional_record", reference })), permissions: [...permissions.permissions, ...declared].map((permission) => ({ observer_id: config.player.observer_id, permission })), resources: resources.resources.map((id) => ({ id, custodian: config.player.observer_id, quantity: 1 })), metadata: config.metadata } };
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
function newRun({ profile, seed, session, expedition, staffing = null, loadout = null, mission = null, procedural_state, procedural_scenario = false, world_id = null, run_id = null, world = null }) {
  const profileRecord = profileFor(profile);
  const player = session.startup.player.observer_id;
  const run = { version: "yellow-beast-run@v4", profile_id: profile, profile_title: profileRecord.title, scenario: procedural_scenario ? "async-clear-q4-procedural-survey" : session.scenario.id, seed, session, lifecycle: "active", checklist: { moved: false, inspected: false, used: false }, aliases: {}, expedition: expedition ?? (profile === FIELD_PROFILE ? fieldExpedition(player, staffing, loadout, mission) : null), procedural: procedural_scenario ? (procedural_state ?? procedural.initialize({ seed, observer: player })) : null, world_id, run_id, _world: world };
  run.identity = runIdentity.describe(run);
  return run;
}
function startRun({ profile, seed = "yellow-beast-bootstrap", scenario = null, world = null, region_id = null, generator_version = null }) {
  const { profile: profileRecord, startup } = startupFor(profile);
  const player = startup.player.observer_id;
  const result = createSession({ world_pack: configuredPack(profile, player), scenario: configuredScenario(profile, player), startup, seed_material: { seed } });
  if (!result.ok) return result;
  const restored = restoreSession(exportSession(result.session).envelope);
  const procedural_scenario = profile === FIELD_PROFILE && scenario === "procedural-survey";
  const run_id = world ? history.beginRun(world, { profile, scenario: procedural_scenario ? "async-clear-q4-procedural-survey" : result.session.scenario.id, seed }) : null;
  const staffing = profile === FIELD_PROFILE && world ? q4Personnel.staffQ4(world, run_id, player) : null;
  if (staffing && !staffing.ok) return { ok: false, error: { code: staffing.code } };
  const mission = profile === FIELD_PROFILE ? q4Missions.generate({ world, run_id, seed, staffing }) : null;
  if (mission && world) history.recordQ4Mission(world, run_id, mission);
  const loadout = profile === FIELD_PROFILE && world ? q4Equipment.prepare(world, run_id, { player: staffing.player.identity, peer: staffing.peer.identity, required_keys: mission.required_equipment }) : null;
  const existing = region_id && world?.regions?.[region_id];
  let generator; try { generator = generatorFor(existing?.generator_version ?? generator_version ?? procedural.VERSION); } catch (error) { return { ok: false, error: { code: error.code ?? "GENERATOR_VERSION_UNSUPPORTED" } }; }
  const procedural_state = existing ? clone(history.restoreRegion(world, region_id).state) : (procedural_scenario && generator_version === proceduralV2.VERSION ? generator.initialize({ seed, observer: player, policy: "moderate" }) : undefined);
  if (procedural_state) { const known = procedural_state.discovery[player] ?? { spaces: [], edges: [], features: [] }; procedural_state.discovery = { [player]: { spaces: [], edges: [], features: [] } }; procedural_state.current = { [player]: Object.keys(procedural_state.nodes)[0] }; void known; }
  const run = newRun({ profile, seed, session: result.session, staffing, loadout, mission, procedural_scenario, procedural_state, world_id: world?.world_id ?? null, run_id, world });
  return { ok: restored.ok, session: result.session, run, restored_equivalent: restored.ok && stableSerialize(restored.session) === stableSerialize(result.session), summary: { session_id: result.session.id, profile, profile_title: profileRecord.title, scenario: result.session.scenario.id, seed, player: startup.player, knowledge: startup.knowledge, permissions: startup.permissions, resources: startup.resources } };
}
function normalizeRun(value) {
  if (value?.version === "yellow-beast-run@v4") return value;
  if (value?.version === "yellow-beast-run@v3" || value?.version === "yellow-beast-run@v2" || value?.version === "yellow-beast-run@v1") return newRun({ profile: value.profile_id, seed: value.seed, session: value.session, expedition: value.expedition, procedural_state: value.procedural, procedural_scenario: Boolean(value.procedural), world_id: value.world_id, run_id: value.run_id });
  if (value?.session) return newRun({ profile: value.session.startup.profile.id, seed: value.session.seed_material?.seed ?? "restored", session: value.session });
  return newRun({ profile: value.startup.profile.id, seed: value.seed_material?.seed ?? "restored", session: value });
}
function look(runValue) {
  const run = normalizeRun(runValue);
  const observer = run.session.startup.player.observer_id;
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
  if (run.procedural) {
    const result = generatorFor(run.procedural).inspect(run.procedural, observer, alias);
    if (result.ok && run.expedition) { run.checklist.inspected = true; run.expedition.objectives.survey.state = "satisfied"; event(run.expedition, "procedural.feature.inspected", result.detail); }
    return { outcome: result.ok ? "succeeded" : "rejected", ...(result.ok ? { details: result.detail } : {}), public_reason: result.public_reason ?? null };
  }
  const target = run.aliases?.[alias] ?? alias;
  const result = inspectSessionObserver({ session: run.session, observer, request: { id: `inspect-${run.session.id}-${alias ?? ""}`, kind: "inspect", target } });
  if (result.outcome === "succeeded" && run.profile_id === FIELD_PROFILE) { run.checklist.inspected = true; if (run.expedition) { run.expedition.objectives.survey.state = "satisfied"; event(run.expedition, "survey.inspected", { alias, location: look(run).view?.location ?? null }); } }
  return result;
}
function status(runValue) {
  const run = normalizeRun(runValue);
  const observer = run.session.startup.player.observer_id;
  const view = look(run);
  const actions = getAvailableSessionActions({ session: run.session, actor: observer }).actions;
  const active = run.lifecycle === "active";
  const expeditionVerbs = active && run.expedition ? ["COMMUNICATE", "RECORD", "WAIT", "RETURN", "ABORT"] : [];
  return { profile_id: run.profile_id, profile_title: run.profile_title, scenario: run.scenario, lifecycle: run.lifecycle, player: observer, run_identity: runIdentity.describe(run), known_resources: (run.session.startup.resources ?? []).filter((entry) => entry.custodian === observer).map((entry) => entry.id), available_verbs: ["LOOK", ...(active && view.targets?.length ? ["INSPECT"] : []), ...(active && (run.procedural ? view.view?.exits?.length : actions.includes("traverse-controlled-route")) ? ["MOVE"] : []), ...(active && actions.includes("toggle-light") ? ["USE"] : []), ...expeditionVerbs], view: { outcome: view.outcome, location: view.view?.location ?? null, targets: (view.aliases ?? []).map(({ alias }) => ({ alias })), observations: { environment: view.view?.environment ?? {}, landmark: view.view?.landmark ?? null, objects: view.view?.objects ?? [], route_character: view.view?.route_character ?? null }, public_reason: view.public_reason ?? null }, ...(run.expedition ? { expedition: safeSummary(run.expedition) } : {}), ...(run.procedural ? { discovered_topology: generatorFor(run.procedural).map(run.procedural, observer), generator_version: generatorFor(run.procedural).VERSION } : {}) };
}
function terminal(run, decision) { finalize(run.expedition, decision); run.lifecycle = "completed"; if (run._world && run.run_id && run.expedition?.mission) history.updateQ4Mission(run._world, run.run_id, run.expedition.mission.id, { status: run.expedition.mission.status }); const ingestion = run._world && run.run_id ? history.ingestRun(run._world, run) : null; return { ok: true, outcome: "succeeded", result: { public_reason: null, expedition_result: clone(run.expedition.result), ...(ingestion ? { history: { run_id: ingestion.run_id, region_id: ingestion.region_id } } : {}) }, run }; }
function expeditionAction(run, verb, target) {
  const expedition = run.expedition; const player = run.session.startup.player.observer_id;
  if (!expedition) return { ok: false, error: { code: "UNSUPPORTED_VERB" }, run };
  if (verb === "WAIT") { expedition.clock.interval += 1; if (expedition.objectives.check_in.state !== "satisfied" && expedition.clock.interval >= expedition.clock.check_in_due_at) { expedition.clock.check_in_overdue = true; expedition.objectives.check_in.state = "failed"; expedition.deviations.push("missed-declared-check-in"); } event(expedition, "expedition.waited", { interval: expedition.clock.interval }); return { ok: true, outcome: "succeeded", result: { public_reason: expedition.clock.check_in_overdue ? "check-in overdue" : "no notable event" }, run }; }
  if (verb === "COMMUNICATE") { if (!["standard", "teammate", "team"].includes(target)) return { ok: false, error: { code: "RECIPIENT_UNAVAILABLE" }, run }; const radio = useEquipment(expedition, "survey-radio", player); if (!radio.ok) return { ok: false, error: { code: radio.code }, run }; const recipient = target === "standard" ? "Standard" : "yb-field-peer-observer"; const delivered = target === "standard" || expedition.team.members[1].status === "active"; const message = { id: `message-${expedition.messages.length + 1}`, sender: player, intended_recipient: recipient, delivery_status: delivered ? "delivered" : "unavailable", channel: "survey-radio", provenance: "pack-original-expedition", interval: expedition.clock.interval }; expedition.messages.push(message); if (target === "standard" && delivered) expedition.objectives.check_in.state = "satisfied"; if (target !== "standard") expedition.objectives.optional_peer_status.state = delivered ? "satisfied" : "failed"; event(expedition, "communication.sent", message); return { ok: true, outcome: "succeeded", result: { public_reason: delivered ? "message delivered" : "message unavailable", message: { recipient: target, delivery_status: message.delivery_status } }, run }; }
  if (verb === "RECORD") { const view = look(run); const alias = target ?? view.aliases[0]?.alias; if (!alias || !view.aliases.some((entry) => entry.alias === alias)) return { ok: false, error: { code: "TARGET_UNAVAILABLE" }, run }; const device = useEquipment(expedition, "recording-device", player); if (!device.ok) return { ok: false, error: { code: device.code }, run }; const evidence = { id: `field-note-${expedition.evidence.length + 1}`, type: "field-note", creator: player, custodian: player, target_alias: alias, location: view.view?.location ?? null, provenance: "observer-safe-record", interval: expedition.clock.interval }; expedition.evidence.push(evidence); expedition.objectives.evidence.state = "satisfied"; event(expedition, "evidence.recorded", evidence); return { ok: true, outcome: "succeeded", result: { public_reason: null, evidence: { id: evidence.id, type: evidence.type, target_alias: alias } }, run }; }
  if (verb === "RETURN" || verb === "ABORT") return terminal(run, verb);
  return { ok: false, error: { code: "UNSUPPORTED_VERB" }, run };
}
function act(runValue, verb, target) {
  const run = normalizeRun(runValue);
  if (verb === "LOOK") return { ok: true, outcome: "succeeded", result: look(run), run };
  if (verb === "INSPECT") { const result = inspect(run, target); return { ok: true, outcome: result.outcome === "succeeded" ? "succeeded" : "rejected", result, run }; }
  if (run.lifecycle === "completed") return { ok: false, error: { code: "RUN_COMPLETE" }, run };
  if (["COMMUNICATE", "RECORD", "WAIT", "RETURN", "ABORT"].includes(verb)) return expeditionAction(run, verb, target);
  if (verb === "MOVE" && run.procedural) { const moved = generatorFor(run.procedural).move(run.procedural, run.session.startup.player.observer_id, target); if (!moved.ok) return { ok: false, error: { code: "TARGET_UNAVAILABLE" }, result: { public_reason: moved.public_reason }, run }; run.checklist.moved = true; event(run.expedition, "procedural.space.discovered", { location: moved.view.location.alias }); return { ok: true, outcome: "succeeded", result: { public_reason: null, view: moved.view }, run }; }
  if (verb === "USE" && target && target !== "field-light") {
    if (target !== "survey-instrument") return { ok: false, error: { code: "EQUIPMENT_UNAVAILABLE" }, run };
    const used = useEquipment(run.expedition, target, run.session.startup.player.observer_id); if (!used.ok) return { ok: false, error: { code: used.code }, run };
    run.expedition.objectives.survey.state = "satisfied"; event(run.expedition, "measurement.recorded", { equipment: target, interval: run.expedition.clock.interval, type: "qualitative-survey" });
    return { ok: true, outcome: "succeeded", result: { public_reason: null, measurement: "qualitative-survey" }, run };
  }
  const action = { MOVE: "traverse-controlled-route", USE: "toggle-light" }[verb];
  if (!action) return { ok: false, error: { code: "UNSUPPORTED_VERB" }, run };
  if (verb === "USE") { const lamp = run.expedition?.equipment?.["field-light"]; if (!lamp || lamp.holder !== run.session.startup.player.observer_id) return { ok: false, error: { code: "EQUIPMENT_NOT_ACCESSIBLE" }, run }; if (!q4Equipment.stateUsable(lamp) || lamp.charges <= 0) return { ok: false, error: { code: "EQUIPMENT_UNAVAILABLE" }, run }; }
  const result = submitSessionAction({ session: run.session, actor: run.session.startup.player.observer_id, action, target });
  if (result.session) run.session = result.session;
  if (result.ok && result.outcome === "succeeded") { if (verb === "MOVE") run.checklist.moved = true; if (verb === "USE") { run.checklist.used = true; if (run.expedition) useEquipment(run.expedition, "field-light", run.session.startup.player.observer_id); } }
  return { ...result, run };
}
function saveRun(runValue) { const run = normalizeRun(runValue); return { version: "yellow-beast-save@v4", profile_id: run.profile_id, profile_title: run.profile_title, scenario: run.scenario, seed: run.seed, lifecycle: run.lifecycle, checklist: clone(run.checklist), aliases: clone(run.aliases), expedition: clone(run.expedition), procedural: clone(run.procedural), world_id: run.world_id, run_id: run.run_id, envelope: exportSession(run.session).envelope }; }
function resumeRun(save, { world = null } = {}) { const restored = restoreSession(save.envelope); if (!restored.ok) return restored; try { if (save.procedural) generatorFor(save.procedural); } catch (error) { return { ok: false, error: { code: error.code ?? "GENERATOR_VERSION_UNSUPPORTED" } }; } if (world && save.world_id && world.world_id !== save.world_id) return { ok: false, error: { code: "WORLD_ID_MISMATCH" } }; const run = newRun({ profile: save.profile_id, seed: save.seed, session: restored.session, expedition: clone(save.expedition), procedural_state: clone(save.procedural), procedural_scenario: Boolean(save.procedural), world_id: save.world_id, run_id: save.run_id, world }); run.lifecycle = save.lifecycle ?? "active"; run.checklist = clone(save.checklist ?? run.checklist); run.aliases = clone(save.aliases ?? {}); return { ok: true, run }; }

if (require.main === module) { const args = process.argv.slice(2); const value = (name) => args[args.indexOf(name) + 1]; const result = startRun({ profile: value("--profile") || "lost", seed: value("--seed") || "yellow-beast-bootstrap" }); console.log(JSON.stringify(result.ok ? result.summary : result, null, 2)); process.exitCode = result.ok ? 0 : 1; }
module.exports = { startRun, status, look, inspect, act, saveRun, resumeRun, generatorFor };
