"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const missionRuntime = require("../tools/mission-runtime");
const bootstrap = require("../tools/run-bootstrap");
const q4Equipment = require("../tools/q4-equipment");
const surfaces = require("../desktop/renderer/surfaces");

const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const clearMission = read("data/worldpacks/clear-q4/mission.json");
const clearSpatial = read("data/worldpacks/clear-q4/spatial.json");
const clearInteractions = read("data/worldpacks/clear-q4/interactions.json");
const minimalMission = read("data/worldpacks/minimal-mission/mission.json");
const minimalSpatial = read("data/worldpacks/minimal-mission/spatial.json");
const minimalInteractions = read("data/worldpacks/minimal-mission/interactions.json");
const clone = (value) => structuredClone(value);

function catalogs(spatial, interactions, equipment = []) {
  return {
    objects: interactions.objects.map((item) => item.id),
    locations: spatial.locations.map((item) => item.id),
    connections: spatial.connections.map((item) => item.id),
    equipment,
    personnel_roles: []
  };
}

const clearCatalogs = catalogs(clearSpatial, clearInteractions, Object.keys(q4Equipment.DEFINITIONS));
const minimalCatalogs = catalogs(minimalSpatial, minimalInteractions);

function fixture(seed = "mission-state") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-mission-state-"));
  const service = new DesktopService({ appDataPath });
  const world = service.createWorld({ name: "Mission state acceptance", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" }).ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true }).ok, true);
  return { appDataPath, service, world };
}

function action(service, world, verb, target = null) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: verb, target });
  assert.equal(result.ok, true, `${verb} ${target ?? ""} should succeed: ${result.error?.message ?? "unknown"}`);
  return result;
}

function reachField(service, world, { markerKit = true } = {}) {
  action(service, world, "READY");
  if (markerKit) assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);
  for (const verb of ["PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION"]) action(service, world, verb);
  return service.session(world.id, "field-researcher");
}

function requiredFieldwork(service, world, { optional = false } = {}) {
  action(service, world, "INSPECT", "fluorescent fixture");
  action(service, world, "TEST", "fluorescent fixture");
  action(service, world, "INSPECT", "scuffed floor");
  if (optional) action(service, world, "PHOTOGRAPH", "scuffed floor");
  action(service, world, "MARK", "scuffed floor");
  action(service, world, "INSPECT", "service panel");
  const report = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Scheduled check-in and evidence report." });
  assert.equal(report.ok, true);
  return report;
}

function verifyRoute(service, world) {
  action(service, world, "MOVE", "back");
  action(service, world, "INSPECT", "return marker");
  return action(service, world, "SECURE", "return marker");
}

function closeMission(service, world) {
  const begun = action(service, world, "RETURN");
  assert.equal(begun.projection.phase.phase_id, "RETURN");
  assert.equal(begun.projection.q4.review, null);
  assert.equal(service.session(world.id, "field-researcher").run.lifecycle, "active");
  return action(service, world, "COMPLETE_RETURN");
}

function evaluatorContext() {
  const missionState = missionRuntime.createState(minimalMission, { phase: "FIELD_OPERATION" });
  missionState.objectives["inspect-record"].state = "satisfied";
  missionState.lifecycle = "returning";
  missionState.return = { ...missionState.return, requested: true, abort_requested: true, closure_requested: true, route_available: true };
  const run = {
    session: { startup: { player: { observer_id: "player" } } },
    spatial: {
      player_location: "origin",
      discovered_locations: { origin: true, site: true },
      visited_locations: ["origin", "site"],
      route_history: [{ connection_id: "origin-to-site", from: "origin", to: "site" }],
      discovered_connections: { "origin-to-site": { status: "confirmed" }, unresolved: { status: "observed" } },
      blocked_paths: {},
      personnel_locations: { player: "origin", peer: "origin" }
    },
    object_state: {
      objects: { "sample-record": { state: { condition: "secured", open: true, moved: true, marked: true, damaged: false, custom: { repaired: true } }, knowledge: { player: { known_properties: ["record-legible"] } }, interaction_history: [1] } },
      interaction_history: [{ sequence: 1, action: "open", state_after: { open: true, condition: "secured" } }]
    },
    expedition: {
      evidence: [{ id: "e-1", valid: true, type: "photograph", source_object: "sample-record", condition_fingerprint: "fp-1", available_to_player: true, available_to_standard: true, reporting_state: "reported-to-standard", custodian: "player", captured_at: { interval: 4 } }],
      equipment: { tool: { id: "tool", assigned_to: "player", holder: "player", state: "operational", charges: 2, container: "field case", location: "carrying", history: [{ event: "handed-over" }] } },
      team: { members: [{ personnel_id: "player", role: "lead", status: "active", observed_condition: "normal" }, { personnel_id: "peer", role: "technician", status: "active", observed_condition: "normal" }] },
      radio: { state: "available", authorized: true, check_completed: true },
      clock: { interval: 5, check_in_due_at: 3, check_in_completed_at: 2, check_in_overdue: false, check_in_missed: false },
      messages: [{ delivery_status: "delivered", intended_recipient: "Standard", purpose: "mission-closure" }],
      interaction_history: [{ channel: "standard", delivery: "delivered", purpose: "field-report" }],
      history: [{ kind: "sample.action", payload: { interval: 2 } }]
    }
  };
  return { run, player: "player", mission_state: missionState };
}

test("mission schema validates Clear-Q4 and a second worldpack while rejecting unsafe or unresolved data", () => {
  assert.equal(missionRuntime.validateDefinition(clearMission, clearCatalogs), true);
  assert.equal(missionRuntime.validateDefinition(minimalMission, minimalCatalogs), true);
  assert.equal(missionRuntime.validateDefinitions([clearMission, minimalMission], { "clear-q4": clearCatalogs, "minimal-mission": minimalCatalogs }), true);
  const source = fs.readFileSync(path.join(root, "tools/mission-runtime.js"), "utf8");
  assert.doesNotMatch(source, /clear-q4|utility room|threshold-side|nora|alex/i);

  const duplicateMission = clone(minimalMission); duplicateMission.mission.id = clearMission.mission.id;
  assert.throws(() => missionRuntime.validateDefinitions([clearMission, duplicateMission], { "clear-q4": clearCatalogs, "minimal-mission": minimalCatalogs }), /duplicate mission id/);
  const duplicateObjective = clone(minimalMission); duplicateObjective.mission.objectives.push(clone(duplicateObjective.mission.objectives[0]));
  assert.throws(() => missionRuntime.validateDefinition(duplicateObjective, minimalCatalogs), /duplicate objective id/);
  const unresolved = clone(minimalMission); unresolved.mission.objectives[0].satisfaction.object_id = "missing-object";
  assert.throws(() => missionRuntime.validateDefinition(unresolved, minimalCatalogs), /object reference does not resolve/);
  const unknownLocation = clone(minimalMission); unknownLocation.mission.return_policy.return_location = "missing-location";
  assert.throws(() => missionRuntime.validateDefinition(unknownLocation, minimalCatalogs), /return location does not resolve/);
  const circular = clone(minimalMission); const second = clone(circular.mission.objectives[0]); second.id = "second-record"; second.name = "Second record"; circular.mission.objectives[0].dependencies = [second.id]; second.dependencies = [circular.mission.objectives[0].id]; circular.mission.objectives.push(second);
  assert.throws(() => missionRuntime.validateDefinition(circular, minimalCatalogs), /circular objective dependency/);
  const invalidTransition = clone(minimalMission); invalidTransition.mission.objectives[0].legal_transitions = { satisfied: ["active"] };
  assert.throws(() => missionRuntime.validateDefinition(invalidTransition, minimalCatalogs), /incoherent transition/);
  const executable = clone(minimalMission); executable.mission.objectives[0].satisfaction = { source: "object", predicate: "state", object_id: "sample-record", path: "open", equals: true, expression: "process.exit()" };
  assert.throws(() => missionRuntime.validateDefinition(executable, minimalCatalogs), /unsupported field/);
  const invalidOperator = clone(minimalMission); invalidOperator.mission.objectives[0].satisfaction.predicate = "run_code";
  assert.throws(() => missionRuntime.validateDefinition(invalidOperator, minimalCatalogs), /invalid condition operator/);
  const impossible = clone(minimalMission); impossible.mission.objectives[0].activation = { constant: false };
  assert.throws(() => missionRuntime.validateDefinition(impossible, minimalCatalogs), /can never activate/);
  const unknownOutcome = clone(minimalMission); unknownOutcome.mission.outcome_rules[0].when = { source: "mission", predicate: "objective_state", objective_id: "unknown", states: ["satisfied"] };
  assert.throws(() => missionRuntime.validateDefinition(unknownOutcome, minimalCatalogs), /objective reference does not resolve/);
});

test("structured conditions read every authoritative source without side effects", () => {
  const context = evaluatorContext();
  const yes = (condition) => assert.equal(missionRuntime.evaluateCondition(condition, context, { "inspect-record": "satisfied" }), true, JSON.stringify(condition));
  const before = clone(context.run);
  for (const condition of [
    { source: "object", predicate: "exists", object_id: "sample-record" },
    { source: "object", predicate: "property_known", object_id: "sample-record", property: "record-legible" },
    { source: "object", predicate: "state", object_id: "sample-record", path: "state.open", equals: true },
    { source: "object", predicate: "state", object_id: "sample-record", path: "state.moved", equals: true },
    { source: "object", predicate: "state", object_id: "sample-record", path: "state.marked", equals: true },
    { source: "object", predicate: "state", object_id: "sample-record", path: "state.custom.repaired", equals: true },
    { source: "object", predicate: "mutation", object_id: "sample-record", action: "open", path: "open", equals: true },
    { source: "object", predicate: "interaction_completed", object_id: "sample-record", action: "open" },
    { source: "evidence", predicate: "exists", source_object: "sample-record", type: "photograph" },
    { source: "evidence", predicate: "retained", condition_fingerprint: "fp-1" },
    { source: "evidence", predicate: "reported", source_object: "sample-record" },
    { source: "evidence", predicate: "count", minimum: 1 },
    { source: "evidence", predicate: "distinct_count", distinct_by: "source_object", minimum: 1 },
    { source: "evidence", predicate: "created_after", after: 3 },
    { source: "spatial", predicate: "location_discovered", location_id: "site" },
    { source: "spatial", predicate: "location_visited", location_id: "site" },
    { source: "spatial", predicate: "current_location", location_id: "origin" },
    { source: "spatial", predicate: "route_traversed", connection_id: "origin-to-site" },
    { source: "spatial", predicate: "connection_verified", connection_id: "origin-to-site" },
    { source: "spatial", predicate: "returned", location_id: "origin" },
    { source: "spatial", predicate: "unresolved_exit_remains" },
    { source: "spatial", predicate: "route_available", connection_id: "origin-to-site" },
    { source: "equipment", predicate: "assigned", equipment_id: "tool" },
    { source: "equipment", predicate: "carried", equipment_id: "tool" },
    { source: "equipment", predicate: "accessible", equipment_id: "tool" },
    { source: "equipment", predicate: "operational", equipment_id: "tool" },
    { source: "equipment", predicate: "stored", equipment_id: "tool" },
    { source: "equipment", predicate: "transferred", equipment_id: "tool" },
    { source: "equipment", predicate: "consumable_remaining", equipment_id: "tool", minimum: 1 },
    { source: "personnel", predicate: "alive", role: "all_assigned" },
    { source: "personnel", predicate: "active", role: "all_assigned" },
    { source: "personnel", predicate: "within_speaking_range", role: "all_assigned" },
    { source: "personnel", predicate: "returned", role: "all_assigned", location_id: "origin" },
    { source: "personnel", predicate: "accounted", role: "all_assigned" },
    { source: "personnel", predicate: "assigned_equipment_retained", role: "all_assigned" },
    { source: "communication", predicate: "radio_check_completed" },
    { source: "communication", predicate: "message_delivered", target: "standard", purpose: "mission-closure" },
    { source: "communication", predicate: "report_sent", purpose: "field-report" },
    { source: "communication", predicate: "evidence_reported" },
    { source: "communication", predicate: "check_in_completed" },
    { source: "communication", predicate: "acknowledgment_received" },
    { source: "communication", predicate: "closure_delivered" },
    { source: "time", predicate: "interval_reached", amount: 5 },
    { source: "time", predicate: "deadline_exceeded", deadline: "check_in" },
    { source: "time", predicate: "action_before", action: "sample.action", deadline: 3 },
    { source: "mission", predicate: "objective_state", objective_id: "inspect-record", states: ["satisfied"] },
    { source: "mission", predicate: "minimum_objective_count", objective_ids: ["inspect-record"], count: 1, states: ["satisfied"] },
    { source: "mission", predicate: "required_group_complete", objective_ids: ["inspect-record"], states: ["satisfied"] },
    { source: "mission", predicate: "return_authorized" },
    { source: "mission", predicate: "abort_condition" },
    { source: "mission", predicate: "phase_in", values: ["FIELD_OPERATION"] },
    { source: "mission", predicate: "lifecycle", states: ["returning"] },
    { source: "mission", predicate: "return_requested" },
    { source: "mission", predicate: "abort_requested" },
    { source: "mission", predicate: "closure_requested" },
    { all: [{ constant: true }, { any: [{ constant: false }, { not: { constant: false } }] }] }
  ]) yes(condition);
  assert.deepEqual(context.run, before, "condition evaluation is side-effect free");

  const equipmentStates = { damaged: "damaged", depleted: "depleted", lost: "lost" };
  for (const [predicate, state] of Object.entries(equipmentStates)) { const variant = evaluatorContext(); variant.run.expedition.equipment.tool.state = state; if (predicate === "depleted") variant.run.expedition.equipment.tool.charges = 0; assert.equal(missionRuntime.evaluateCondition({ source: "equipment", predicate, equipment_id: "tool" }, variant, {}), true); }
  const injured = evaluatorContext(); injured.run.expedition.team.members[1].observed_condition = "injured"; assert.equal(missionRuntime.evaluateCondition({ source: "personnel", predicate: "injured", role: "team" }, injured, {}), true);
  const missing = evaluatorContext(); missing.run.expedition.team.members[1].status = "missing"; assert.equal(missionRuntime.evaluateCondition({ source: "personnel", predicate: "missing", role: "team" }, missing, {}), true);
  const separated = evaluatorContext(); separated.run.spatial.personnel_locations.peer = "site"; assert.equal(missionRuntime.evaluateCondition({ source: "personnel", predicate: "separated", role: "team" }, separated, {}), true);
  const lostEquipment = evaluatorContext(); lostEquipment.run.expedition.equipment.tool.state = "lost"; assert.equal(missionRuntime.evaluateCondition({ source: "personnel", predicate: "assigned_equipment_lost", role: "team" }, lostEquipment, {}), true);
  const missed = evaluatorContext(); missed.run.expedition.clock.check_in_missed = true; assert.equal(missionRuntime.evaluateCondition({ source: "communication", predicate: "check_in_missed" }, missed, {}), true);
  const unavailable = evaluatorContext(); unavailable.run.expedition.equipment.tool.state = "depleted"; unavailable.run.expedition.equipment.tool.charges = 0; assert.equal(missionRuntime.evaluateCondition({ source: "communication", predicate: "unavailable", equipment_id: "tool" }, unavailable, {}), true);
  const due = evaluatorContext(); due.run.expedition.clock.interval = 3; assert.equal(missionRuntime.evaluateCondition({ source: "time", predicate: "deadline_due", deadline: "check_in" }, due, {}), true);
  const pending = evaluatorContext(); pending.run.expedition.clock.interval = 2; assert.equal(missionRuntime.evaluateCondition({ source: "time", predicate: "deadline_pending", deadline: "check_in" }, pending, {}), true);
  const after = evaluatorContext(); after.run.expedition.history[0].payload.interval = 4; assert.equal(missionRuntime.evaluateCondition({ source: "time", predicate: "action_after", action: "sample.action", deadline: 3 }, after, {}), true);
});

test("evaluation is convergent, atomic, idempotent, and records one history entry per transition", () => {
  const definition = clone(minimalMission);
  const dependent = clone(definition.mission.objectives[0]);
  dependent.id = "dependent-record"; dependent.name = "Dependent record"; dependent.dependencies = ["inspect-record"];
  dependent.satisfaction = { source: "mission", predicate: "objective_state", objective_id: "inspect-record", states: ["satisfied"] };
  definition.mission.objectives = [dependent, definition.mission.objectives[0]];
  definition.mission.return_policy.ready_when = { source: "mission", predicate: "required_group_complete", objective_ids: ["inspect-record", "dependent-record"], states: ["satisfied"] };
  definition.mission.outcome_rules[1].when = clone(definition.mission.return_policy.ready_when);
  missionRuntime.validateDefinition(definition, minimalCatalogs);
  const state = missionRuntime.createState(definition, { phase: "FIELD_OPERATION" });
  const context = evaluatorContext(); context.mission_state = state;
  const first = missionRuntime.evaluateAndCommit(state, definition, context, { at: 4 });
  assert.deepEqual(first.transitions.map((item) => item.to), ["satisfied", "satisfied"]);
  assert.equal(state.transition_history.filter((item) => item.kind === "objective").length, 2);
  const revision = state.evaluation_revision; const historyLength = state.transition_history.length;
  const repeated = missionRuntime.evaluateAndCommit(state, definition, context, { at: 4 });
  assert.equal(repeated.changed, false); assert.equal(state.evaluation_revision, revision); assert.equal(state.transition_history.length, historyLength);
  context.run.object_state.objects["sample-record"].knowledge.player.known_properties = [];
  missionRuntime.evaluateAndCommit(state, definition, context, { at: 5 });
  assert.equal(state.objectives["inspect-record"].state, "satisfied", "sticky satisfaction remains true after its source changes");

  const atomic = missionRuntime.createState(minimalMission, { phase: "FIELD_OPERATION" });
  const before = clone(atomic);
  assert.throws(() => missionRuntime.commit(atomic, minimalMission, { proposed: {}, lifecycle: "in_progress", return_state: atomic.return, blockers: [], transitions: [
    { objective_id: "inspect-record", from: "active", to: "satisfied", reason: "valid first", source: "test" },
    { objective_id: "missing", from: "active", to: "satisfied", reason: "invalid second", source: "test" }
  ] }), /illegal transition/);
  assert.deepEqual(atomic, before, "a failed commit leaves every objective untouched");

  const liveDefinition = clone(minimalMission); liveDefinition.mission.objectives[0].behavior = "live";
  const liveState = missionRuntime.createState(liveDefinition, { phase: "FIELD_OPERATION" }); const liveContext = evaluatorContext(); liveContext.mission_state = liveState;
  missionRuntime.evaluateAndCommit(liveState, liveDefinition, liveContext); assert.equal(liveState.objectives["inspect-record"].state, "satisfied");
  liveContext.run.object_state.objects["sample-record"].knowledge.player.known_properties = [];
  missionRuntime.evaluateAndCommit(liveState, liveDefinition, liveContext); assert.equal(liveState.objectives["inspect-record"].state, "active", "a live objective follows current world truth");
});

test("Clear-Q4 objectives activate, block, recover, satisfy, and update only from authoritative state", () => {
  const { service, world } = fixture("mission-lifecycle");
  let projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(projection.q4.mission_progress.lifecycle, "briefing");
  assert.equal(projection.q4.mission_progress.required_objectives.length, 8);
  assert.equal(projection.q4.mission_progress.optional_objectives.length, 1);
  const briefingMission = JSON.stringify(projection.q4.mission_progress);
  assert.doesNotMatch(briefingMission, /threshold-return-marker|custom\.route_verified|utility-route-surface/);
  assert.equal(projection.q4.mission_progress.required_objectives.find((item) => item.name === "Verify the return route").next_requirement, null);

  action(service, world, "READY");
  assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);
  for (const verb of ["PROCEED", "APPROACH", "CROSS"]) action(service, world, verb);
  projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(projection.q4.mission_progress.required_objectives.find((item) => item.name === "Establish radio contact").state, "active");
  const radio = action(service, world, "RADIO_CHECK");
  assert.ok(radio.result.mission_updates.some((item) => item.headline === "Establish radio contact complete"));
  const field = action(service, world, "BEGIN_FIELD_OPERATION");
  assert.ok(field.result.mission_updates.some((item) => item.headline === "Enter the declared survey area complete"));
  assert.equal(field.projection.q4.mission_progress.required_objectives.find((item) => item.name === "Report field evidence").state, "blocked");
  assert.match(surfaces.render(field.projection), /Current blockers[\s\S]*A valid object-specific field record is required/i);

  action(service, world, "INSPECT", "fluorescent fixture");
  const tested = action(service, world, "TEST", "fluorescent fixture");
  assert.ok(tested.result.mission_updates.some((item) => item.headline === "Capture mission evidence complete"));
  action(service, world, "INSPECT", "scuffed floor");
  action(service, world, "MARK", "scuffed floor");
  const survey = action(service, world, "INSPECT", "service panel");
  assert.ok(survey.result.mission_updates.some((item) => item.headline === "Establish Utility Room conditions complete"));
  const report = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Evidence report and scheduled check-in." });
  assert.ok(report.result.mission_updates.some((item) => item.headline === "Report field evidence complete"));

  const entry = service.session(world.id, "field-researcher");
  entry.run.spatial.blocked_paths ??= {}; entry.run.spatial.blocked_paths["entry-to-utility"] = true;
  bootstrap.evaluateMissionState(entry.run, "FIELD_OPERATION");
  assert.equal(entry.run.expedition.objectives["verify-return-route"].state, "failed");
  delete entry.run.spatial.blocked_paths["entry-to-utility"];
  bootstrap.evaluateMissionState(entry.run, "FIELD_OPERATION");
  assert.equal(entry.run.expedition.objectives["verify-return-route"].state, "active", "recoverable route verification returns to active");
  const routeHistory = entry.run.expedition.objectives["verify-return-route"].history;
  assert.deepEqual(routeHistory.slice(-2).map((item) => item.to), ["failed", "active"]);
});

test("optional work changes the debrief but never blocks a clean required completion", () => {
  const withoutOptional = fixture("mission-clean-required"); reachField(withoutOptional.service, withoutOptional.world); requiredFieldwork(withoutOptional.service, withoutOptional.world); verifyRoute(withoutOptional.service, withoutOptional.world); const clean = closeMission(withoutOptional.service, withoutOptional.world);
  assert.equal(clean.projection.q4.review.outcome, "clean-completion");
  assert.equal(clean.projection.q4.review.assignment.objective_outcomes.find((item) => item.name === "Document an additional field condition").state, "abandoned");

  const withOptional = fixture("mission-clean-optional"); reachField(withOptional.service, withOptional.world); requiredFieldwork(withOptional.service, withOptional.world, { optional: true }); verifyRoute(withOptional.service, withOptional.world); const enhanced = closeMission(withOptional.service, withOptional.world);
  assert.equal(enhanced.projection.q4.review.outcome, "enhanced-completion");
  assert.ok(enhanced.projection.q4.review.institutional_consequence_hooks.includes("optional_success"));
});

test("missed check-ins can recover without erasing the operational consequence", () => {
  const { service, world } = fixture("mission-missed-check-in"); reachField(service, world);
  while (service.session(world.id, "field-researcher").run.expedition.communications.check_ins[0].state !== "missed") action(service, world, "WAIT");
  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.run.expedition.objectives["maintain-check-ins"].state, "failed");
  requiredFieldwork(service, world, { optional: true }); verifyRoute(service, world); const closed = closeMission(service, world);
  assert.equal(closed.projection.q4.review.outcome, "recovered-complication");
  assert.equal(closed.projection.q4.review.communications.outcome.check_in_missed, true);
  assert.ok(closed.projection.q4.review.institutional_consequence_hooks.includes("missed_check_in"));
});

test("communication loss can waive a declared check-in only under the authored rule", () => {
  const { service, world } = fixture("mission-check-in-waiver"); const entry = reachField(service, world);
  entry.run.expedition.equipment["survey-radio"].state = "damaged";
  while (entry.run.expedition.objectives["maintain-check-ins"].state !== "waived") action(service, world, "WAIT");
  assert.equal(entry.run.expedition.objectives["maintain-check-ins"].state, "waived");
  assert.equal(entry.run.expedition.objectives["establish-radio-contact"].state, "satisfied", "the earlier acknowledged radio check is sticky");
});

test("personnel separation blocks return accountability and recovery removes the blocker", () => {
  const { service, world } = fixture("mission-accountability-block"); const entry = reachField(service, world);
  const player = entry.run.session.startup.player.observer_id; const peer = entry.run.expedition.team.members.find((item) => item.personnel_id !== player);
  entry.run.spatial.team_behavior[peer.personnel_id] = "independent";
  action(service, world, "MOVE", "back"); action(service, world, "RETURN");
  assert.equal(entry.run.expedition.objectives["return-accountability"].state, "blocked");
  const rejected = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "COMPLETE_RETURN" });
  assert.equal(rejected.ok, false); assert.equal(rejected.error.code, "RETURN_RECONCILIATION_INCOMPLETE");
  entry.run.spatial.personnel_locations[peer.personnel_id] = "threshold-side-entry"; entry.run.spatial.team_behavior[peer.personnel_id] = "follow-player";
  bootstrap.evaluateMissionState(entry.run, "RETURN");
  assert.equal(entry.run.expedition.objectives["return-accountability"].state, "satisfied");
  assert.equal(action(service, world, "COMPLETE_RETURN").projection.q4.review.outcome, "degraded-completion");
});

test("an irrecoverable missing-person return produces a failed mission result", () => {
  const { service, world } = fixture("mission-failed-return"); const entry = reachField(service, world);
  const player = entry.run.session.startup.player.observer_id; const peer = entry.run.expedition.team.members.find((item) => item.personnel_id !== player);
  peer.status = "missing"; peer.contact_category = "UNKNOWN"; entry.run.spatial.team_behavior[peer.personnel_id] = "independent";
  action(service, world, "MOVE", "back"); action(service, world, "RETURN");
  assert.equal(entry.run.expedition.objectives["return-accountability"].state, "failed");
  const closed = action(service, world, "COMPLETE_RETURN");
  assert.equal(closed.projection.q4.review.outcome, "mission-failure");
  assert.equal(closed.projection.q4.review.final_mission_state, "failed");
  assert.ok(closed.projection.q4.review.institutional_consequence_hooks.includes("missing_personnel"));
});

test("RETURN requests a procedure, controlled abort abandons unresolved work, and closure derives a stable result", () => {
  const { service, world } = fixture("mission-controlled-abort"); const entry = reachField(service, world);
  const begun = action(service, world, "ABORT");
  assert.equal(begun.projection.phase.phase_id, "RETURN");
  assert.equal(entry.run.lifecycle, "active");
  assert.equal(entry.run.expedition.result, null);
  assert.ok(Object.values(entry.run.expedition.objectives).some((item) => item.state === "abandoned"));
  action(service, world, "MOVE", "back");
  const closed = action(service, world, "COMPLETE_RETURN");
  const result = entry.run.expedition.mission_state.final_result;
  assert.equal(closed.projection.phase.phase_id, "DEBRIEF");
  assert.equal(result.final_mission_state, "aborted");
  assert.equal(result.classification, "controlled-abort");
  assert.ok(result.required_objectives_abandoned.length > 0);
  assert.equal(result.return_outcome.controlled_abort, true);
  assert.ok(result.institutional_consequence_hooks.includes("controlled_abort"));
  const stable = clone(result); const historyLength = entry.run.expedition.mission_state.transition_history.length;
  bootstrap.evaluateMissionState(entry.run, "DEBRIEF");
  assert.deepEqual(entry.run.expedition.mission_state.final_result, stable);
  assert.equal(entry.run.expedition.mission_state.transition_history.length, historyLength);
});

test("mission state, blockers, history, readiness, and final results survive full shutdown and restart", () => {
  const partial = fixture("mission-partial-persistence"); const entry = reachField(partial.service, partial.world);
  entry.run.spatial.blocked_paths ??= {}; entry.run.spatial.blocked_paths["entry-to-utility"] = true; bootstrap.evaluateMissionState(entry.run, "FIELD_OPERATION"); partial.service.persistSession(partial.service.getWorld(partial.world.id), "field-researcher", entry);
  const before = clone(entry.run.expedition.mission_state); partial.service.shutdown();
  const restarted = new DesktopService({ appDataPath: partial.appDataPath }); const resumed = restarted.resumeSession({ world_id: partial.world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true); assert.deepEqual(restarted.session(partial.world.id, "field-researcher").run.expedition.mission_state, before);

  const final = fixture("mission-final-persistence"); reachField(final.service, final.world); requiredFieldwork(final.service, final.world, { optional: true }); verifyRoute(final.service, final.world); const closed = closeMission(final.service, final.world); const finalResult = clone(closed.projection.q4.mission_progress.result); const finalState = clone(final.service.session(final.world.id, "field-researcher").run.expedition.mission_state); final.service.shutdown();
  const reopenedService = new DesktopService({ appDataPath: final.appDataPath }); const reopened = reopenedService.resumeSession({ world_id: final.world.id, mode: "field-researcher" });
  assert.equal(reopened.ok, true); assert.equal(reopened.projection.phase.phase_id, "DEBRIEF"); assert.deepEqual(reopened.projection.q4.mission_progress.result, finalResult); assert.deepEqual(reopenedService.session(final.world.id, "field-researcher").run.expedition.mission_state, finalState);
  assert.equal(Object.hasOwn(reopened.projection.q4.mission_progress.result.return_outcome, "location"), false, "public result omits internal return-location IDs");
});

test("legacy objective progress migrates explicitly without duplication or reset", () => {
  const legacy = {
    survey: { state: "satisfied", history: [{ state: "satisfied", at: 2 }] },
    evidence: { state: "satisfied", history: [{ state: "satisfied", at: 3 }] },
    check_in: { state: "satisfied", history: [{ state: "satisfied", at: 4 }] },
    route_verification: { state: "satisfied", history: [{ state: "satisfied", at: 5 }] }
  };
  const state = missionRuntime.createState(clearMission, { legacy_objectives: legacy, phase: "FIELD_OPERATION", at: 5 });
  assert.equal(Object.keys(state.objectives).length, clearMission.mission.objectives.length);
  assert.equal(state.objectives["establish-utility-conditions"].state, "satisfied");
  assert.equal(state.objectives["capture-field-evidence"].state, "satisfied");
  assert.equal(state.objectives["maintain-check-ins"].state, "satisfied");
  assert.equal(state.objectives["verify-return-route"].state, "satisfied");
  assert.equal(state.migrated_from, "legacy-expedition-objectives");
  assert.ok(state.objectives["capture-field-evidence"].history.every((item) => item.source === "explicit-save-migration"));
});

test("mission projection and renderer are compact, grounded, accessible, and free of evaluator internals", () => {
  const { service, world } = fixture("mission-ui"); const entry = reachField(service, world);
  action(service, world, "INSPECT", "fluorescent fixture");
  const projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  const publicMission = JSON.stringify(projection.q4.mission_progress);
  assert.doesNotMatch(publicMission, /objective_id|object_id|predicate|custom\.|utility-fluorescent-fixture|utility-route-surface|threshold-return-marker/);
  assert.doesNotMatch(publicMission, /dead|deceased|health|position/i);
  const html = surfaces.render(projection);
  for (const heading of ["MISSION STATUS", "Required objectives", "Optional objectives", "Current blockers", "Recent mission updates", "Return readiness"]) assert.match(html, new RegExp(heading, "i"));
  assert.match(html, /aria-labelledby="mission-status-heading"/);
  assert.match(html, /aria-label="Capture mission evidence: Active\./);
  assert.match(html, /mission-blocked[\s\S]*Blocked/);
  assert.doesNotMatch(html, /objective_id|object_id|predicate|utility-route-surface/);
  assert.equal(entry.run.expedition.mission_state.active_blockers.length > 0, true);
});
