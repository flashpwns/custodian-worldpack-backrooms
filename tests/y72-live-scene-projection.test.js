"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const equipment = require("../tools/q4-equipment");
const reference = require("../tools/reference-expedition");
const { VERSION, projectLiveScene } = require("../tools/live-scene-projection");

function fixture(seed = "live-scene") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-live-scene-"));
  const service = new DesktopService({ appDataPath });
  const world = service.createWorld({ name:"Live Scene Reference", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id:world.id, first_name:"Casey", last_name:"Morgan" }).ok, true);
  assert.equal(service.startSession({ world_id:world.id, mode:"field-researcher", seed, require_personnel:true, scenario:"reference-expedition" }).ok, true);
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, Reference team. Four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"CROSS" }).ok, true);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"MOVE", target:"open passage" }).ok, true);
  return { service, world, run:service.session(world.id, "field-researcher").run };
}

function playerId(run) { return run.session.startup.player.observer_id; }
function member(run, role) { return run.expedition.team.members.find((item) => item.role === role); }
function project(run, observer_id) { const result = projectLiveScene(run, { observer_id }); assert.equal(result.ok, true); return result.packet; }

test("player live-scene projection is deterministic, read-only, and excludes hidden canonical truth", () => {
  const { run } = fixture("scene-purity"); const player = playerId(run);
  run._world.q4_phenomenon_ecology ??= { version:"test-hidden-ecology", records:{ secret:{ canonical_family:"HIDDEN_TEST_FAMILY", location_id:"relay-alcove" } }, future_schedule:["secret-event"] };
  const before = structuredClone(run); const interval = run.expedition.clock.interval;
  const first = projectLiveScene(run, { observer_id:player }); const second = projectLiveScene(run, { observer_id:player });

  assert.equal(first.ok, true);
  assert.equal(first.packet.version, VERSION);
  assert.deepEqual(first, second);
  assert.deepEqual(run, before);
  assert.equal(run.expedition.clock.interval, interval);
  assert.equal(first.packet.location.known_name, "Open Passage");
  assert.equal(first.packet.observer_knowledge.known_records.length, 1);
  assert.equal(first.packet.observer_knowledge.known_records[0].record_kind, "prior-layout-record");
  assert.equal(first.packet.observer_knowledge.established_measurements.length, 0);
  assert.equal(first.packet.observer_knowledge.established_conclusions.length, 0);
  const exposed = JSON.stringify(first.packet);
  for (const forbidden of ["canonical_geometry", "euclidean_relation", "overlap_depth_m", "canonical_family", "HIDDEN_TEST_FAMILY", "future_schedule", "relay-alcove", "random_seed", "provider_prompt"]) assert.equal(exposed.includes(forbidden), false);
});

test("qualified evidence exposes a current measurement with truthful provenance but does not derive a conclusion", () => {
  const { service, world, run } = fixture("scene-measurement"); const player = playerId(run);
  const instrumentHolder = run.expedition.equipment["survey-instrument"].holder;
  assert.notEqual(instrumentHolder, player);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"USE", target:"survey-instrument" }).ok, true);
  assert.equal(reference.deriveContradiction(run).established, true);

  const playerPacket = project(run, player);
  const measurement = playerPacket.observer_knowledge.established_measurements[0];
  assert.deepEqual(measurement.measurement, { kind:"passage-depth", value:18, unit:"metre" });
  assert.equal(measurement.record_kind, "current-measurement");
  assert.equal(measurement.operator, instrumentHolder);
  assert.equal(measurement.creator, instrumentHolder);
  assert.equal(measurement.capturing_observer, instrumentHolder);
  assert.equal(measurement.custodian, instrumentHolder);
  assert.equal(playerPacket.observer_knowledge.known_records[0].recorded_passage_depth_m, 9.5);
  assert.equal(playerPacket.observer_knowledge.established_conclusions.length, 0);

  const operatorPacket = project(run, instrumentHolder);
  assert.equal(operatorPacket.observer_knowledge.established_measurements[0].operator, instrumentHolder);
  assert.equal(operatorPacket.observer_knowledge.known_records.length, 0);

  const playerMember = run.expedition.team.members.find((item) => (item.personnel_id ?? item.id) === player);
  playerMember.known_information.push({ kind:"observer-conclusion", conclusion:"The current measurement conflicts with the prior layout record.", basis_evidence_ids:[measurement.evidence_id], at:run.expedition.clock.interval, source:"observer-comparison" });
  const established = project(run, player);
  assert.equal(established.observer_knowledge.established_conclusions.length, 1);
  assert.equal(project(run, instrumentHolder).observer_knowledge.established_conclusions.length, 0);
});

test("observer packets keep private knowledge separate and project simultaneous outcomes by legitimate visibility", () => {
  const { run } = fixture("scene-coordinated"); const player = playerId(run); const survey = member(run, "survey technician");
  assert.equal(equipment.transfer(run.expedition, "survey-instrument", survey.personnel_id, player).ok, true);
  const resolved = bootstrap.resolveCoordinatedAttempts(run, {
    submission_id:"live-scene-coordination",
    player_attempt:{ actor:player, action:"USE", target:"open-passage", equipment:"survey-instrument" },
    coworker_attempts:[{ actor:survey.personnel_id, action:"INSPECT", target:"descending grade" }]
  });
  assert.equal(resolved.ok, true);

  const playerPacket = project(run, player); const coworkerPacket = project(run, survey.personnel_id);
  assert.equal(playerPacket.interval.coordinated_interval_id, resolved.result.interval_id);
  assert.equal(coworkerPacket.interval.coordinated_interval_id, resolved.result.interval_id);
  assert.equal(playerPacket.recent_observable_events.length, 2);
  assert.equal(coworkerPacket.recent_observable_events.length, 2);
  assert.ok(playerPacket.recent_observable_events.find((event) => event.actor_id === player).directly_observed_result);
  assert.equal(playerPacket.recent_observable_events.find((event) => event.actor_id === survey.personnel_id).directly_observed_result, null);
  assert.ok(coworkerPacket.recent_observable_events.find((event) => event.actor_id === survey.personnel_id).directly_observed_result);
  assert.equal(coworkerPacket.observer_knowledge.unresolved_observations.some((item) => item.kind === "coordinated-inspection"), true);
  assert.equal(playerPacket.observer_knowledge.unresolved_observations.some((item) => item.kind === "coordinated-inspection"), false);
  assert.equal(playerPacket.observer_knowledge.established_measurements[0].operator, player);
  assert.equal(coworkerPacket.observer_knowledge.established_measurements.length, 0);
  assert.equal(coworkerPacket.observer_knowledge.known_records.length, 0);

  survey.known_information.push({ kind:"observer-conclusion", conclusion:"Private coworker assessment.", basis_evidence_ids:[], at:run.expedition.clock.interval, source:"direct-observation" });
  assert.equal(project(run, player).observer_knowledge.established_conclusions.some((item) => item.conclusion === "Private coworker assessment."), false);
  assert.equal(project(run, survey.personnel_id).observer_knowledge.established_conclusions.some((item) => item.conclusion === "Private coworker assessment."), true);
});

test("communications, visible targets, and held equipment are scoped to the selected observer", () => {
  const { run } = fixture("scene-action-context"); const player = playerId(run); const survey = member(run, "survey technician");
  const playerPacket = project(run, player); const coworkerPacket = project(run, survey.personnel_id);
  assert.ok(playerPacket.communication_context.recent_messages.some((message) => message.text === "Standard, Reference team. Four accounted for. Radio check."));
  assert.equal(coworkerPacket.communication_context.recent_messages.some((message) => message.text === "Standard, Reference team. Four accounted for. Radio check."), false);
  assert.ok(playerPacket.available_action_context.visible_targets.some((target) => target.label === "descending grade"));
  assert.ok(coworkerPacket.available_action_context.held_equipment.some((item) => item.equipment_id === "survey-instrument"));
  assert.equal(playerPacket.available_action_context.held_equipment.some((item) => item.equipment_id === "survey-instrument"), false);
  assert.equal(playerPacket.visible_personnel.length, 4);
  assert.equal(coworkerPacket.visible_personnel.length, 4);
});

test("malformed observers fail safely and existing look/status projections remain unchanged", () => {
  const { run } = fixture("scene-errors"); const player = playerId(run);
  const lookBefore = bootstrap.look(structuredClone(run), { record:false });
  const statusBefore = bootstrap.status(structuredClone(run));
  assert.equal(projectLiveScene(run, {}).error.code, "LIVE_SCENE_OBSERVER_INVALID");
  assert.equal(projectLiveScene(run, { observer_id:"unassigned-observer" }).error.code, "LIVE_SCENE_OBSERVER_UNKNOWN");
  assert.equal(projectLiveScene(null, { observer_id:player }).error.code, "LIVE_SCENE_RUN_INVALID");
  project(run, player);
  assert.deepEqual(bootstrap.look(structuredClone(run), { record:false }), lookBefore);
  assert.deepEqual(bootstrap.status(structuredClone(run)), statusBefore);
});
