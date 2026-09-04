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

function fixture(seed = "coordinated") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-coordinated-"));
  const service = new DesktopService({ appDataPath });
  const world = service.createWorld({ name:"Coordinated Reference", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id:world.id, first_name:"Casey", last_name:"Morgan" }).ok, true);
  assert.equal(service.startSession({ world_id:world.id, mode:"field-researcher", seed, require_personnel:true, scenario:"reference-expedition" }).ok, true);
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, Reference team. Four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"CROSS" }).ok, true);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"MOVE", target:"open passage" }).ok, true);
  return { appDataPath, service, world, entry:service.session(world.id, "field-researcher") };
}

function bundle(run, overrides = {}) {
  const player = run.session.startup.player.observer_id;
  const survey = run.expedition.team.members.find((member) => member.role === "survey technician");
  return {
    submission_id:overrides.submission_id ?? "structured-coordinated-001",
    player_attempt:Object.hasOwn(overrides, "player_attempt") ? overrides.player_attempt : { actor:player, action:"USE", target:"open-passage", equipment:"survey-instrument" },
    coworker_attempts:Object.hasOwn(overrides, "coworker_attempts") ? overrides.coworker_attempts : [{ actor:survey.personnel_id, action:"INSPECT", target:"descending grade" }]
  };
}

function canonicalSnapshot(run) {
  return structuredClone({
    clock:run.expedition.clock,
    operational:run.expedition.operational,
    evidence:run.expedition.evidence,
    history:run.expedition.history,
    object_state:run.object_state,
    equipment:run.expedition.equipment,
    team:run.expedition.team,
    geometry:run.spatial.reference_expedition
  });
}

test("player measurement and coworker inspection commit as one authoritative interval", () => {
  const { entry } = fixture("coordinated-success"); const run = entry.run; const player = run.session.startup.player.observer_id;
  const survey = run.expedition.team.members.find((member) => member.role === "survey technician");
  assert.equal(equipment.transfer(run.expedition, "survey-instrument", survey.personnel_id, player).ok, true);
  const beforeClock = run.expedition.clock.interval;
  const beforeCycles = run.expedition.operational.cycle_history.filter((item) => item.kind === "operational-cycle").length;
  const beforeEvaluation = run.expedition.operational.evaluation_revision;
  const geometry = structuredClone(run.spatial.reference_expedition.canonical_geometry);

  const result = bootstrap.resolveCoordinatedAttempts(run, bundle(run));
  assert.equal(result.ok, true);
  assert.equal(run.expedition.clock.interval, beforeClock + 1);
  assert.equal(run.expedition.operational.cycle_history.filter((item) => item.kind === "operational-cycle").length, beforeCycles + 1);
  assert.equal(run.expedition.operational.evaluation_revision, beforeEvaluation + 1);
  assert.equal(result.result.outcomes.length, 2);
  assert.equal(new Set(result.result.outcomes.map((item) => item.interval_id)).size, 1);
  assert.equal(new Set(result.result.outcomes.map((item) => item.interval)).size, 1);
  const playerOutcome = result.result.outcomes.find((item) => item.role === "player");
  const coworkerOutcome = result.result.outcomes.find((item) => item.role === "coworker");
  assert.equal(playerOutcome.actor, player);
  assert.equal(playerOutcome.operator, player);
  assert.equal(coworkerOutcome.actor, survey.personnel_id);
  assert.equal(coworkerOutcome.operator, survey.personnel_id);
  assert.equal(coworkerOutcome.action, "INSPECT");
  const measurement = run.expedition.evidence.find((item) => item.id === playerOutcome.evidence_id);
  assert.equal(measurement.type, "passage-depth-measurement");
  assert.equal(measurement.operator, player);
  assert.equal(measurement.creator, player);
  assert.equal(measurement.capturing_observer, player);
  assert.equal(measurement.custodian, player);
  assert.equal(measurement.captured_at.interval, result.result.interval);
  assert.ok(survey.known_information.some((item) => item.kind === "coordinated-inspection" && item.target === "descending grade" && item.interval_id === result.result.interval_id));
  assert.ok(run.expedition.history.some((item) => item.kind === "coordinated.attempt.resolved" && item.payload.actor === survey.personnel_id));
  assert.deepEqual(run.spatial.reference_expedition.canonical_geometry, geometry);
  const beforeDerivation = structuredClone(run.spatial.reference_expedition.canonical_geometry);
  assert.equal(reference.deriveContradiction(run).established, true);
  assert.deepEqual(run.spatial.reference_expedition.canonical_geometry, beforeDerivation);
  assert.equal(run.expedition.team.members.some((member) => member.belief || member.conclusion), false);
  assert.equal(run.expedition.messages.some((message) => /overlap|contradiction|anomal/i.test(message.text ?? "")), false);
});

test("a player USE attempt cannot execute through a coworker-held instrument", () => {
  const { entry } = fixture("coordinated-holder-provenance"); const run = entry.run;
  const survey = run.expedition.team.members.find((member) => member.role === "survey technician");
  const route = run.expedition.team.members.find((member) => member.role === "route specialist");
  assert.equal(run.expedition.equipment["survey-instrument"].holder, survey.personnel_id);
  const before = canonicalSnapshot(run);
  const result = bootstrap.resolveCoordinatedAttempts(run, bundle(run, { submission_id:"holder-provenance", coworker_attempts:[{ actor:route.personnel_id, action:"INSPECT", target:"descending grade" }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COORDINATED_EQUIPMENT_NOT_HELD");
  assert.deepEqual(canonicalSnapshot(run), before);
  assert.equal(run.expedition.evidence.some((item) => item.type === "passage-depth-measurement"), false);
});

test("all attempts validate against the shared pre-interval scene and invalid bundles mutate nothing", () => {
  const { entry } = fixture("coordinated-rejections"); const run = entry.run; const player = run.session.startup.player.observer_id;
  const survey = run.expedition.team.members.find((member) => member.role === "survey technician");
  const route = run.expedition.team.members.find((member) => member.role === "route specialist");
  assert.equal(equipment.transfer(run.expedition, "survey-instrument", survey.personnel_id, player).ok, true);
  const cases = [
    bundle(run, { submission_id:"unassigned", coworker_attempts:[{ actor:"not-assigned", action:"INSPECT", target:"descending grade" }] }),
    bundle(run, { submission_id:"duplicate", coworker_attempts:[{ actor:survey.personnel_id, action:"INSPECT", target:"descending grade" }, { actor:survey.personnel_id, action:"INSPECT", target:"descending grade" }] }),
    bundle(run, { submission_id:"player-as-coworker", coworker_attempts:[{ actor:player, action:"INSPECT", target:"descending grade" }] }),
    bundle(run, { submission_id:"missing-player", player_attempt:null }),
    bundle(run, { submission_id:"invalid-player", player_attempt:{ actor:player, action:"UNSUPPORTED_ACTION", target:"descending grade" }, coworker_attempts:[{ actor:survey.personnel_id, action:"INSPECT", target:"descending grade" }] }),
    bundle(run, { submission_id:"invalid-coworker", coworker_attempts:[{ actor:survey.personnel_id, action:"INSPECT", target:"missing fixture" }] })
  ];
  for (const candidate of cases) {
    const before = canonicalSnapshot(run); const result = bootstrap.resolveCoordinatedAttempts(run, candidate);
    assert.equal(result.ok, false); assert.deepEqual(canonicalSnapshot(run), before);
  }
  run.spatial.personnel_locations[route.personnel_id] = "utility-room";
  const separatedBefore = canonicalSnapshot(run);
  const separated = bootstrap.resolveCoordinatedAttempts(run, bundle(run, { submission_id:"separated", coworker_attempts:[{ actor:route.personnel_id, action:"INSPECT", target:"descending grade" }] }));
  assert.equal(separated.ok, false); assert.equal(separated.error.code, "COORDINATED_ACTOR_OUT_OF_RANGE"); assert.deepEqual(canonicalSnapshot(run), separatedBefore);
});

test("exclusive equipment conflicts reject the whole bundle without an array-order winner", () => {
  const { entry } = fixture("coordinated-conflict"); const run = entry.run;
  const survey = run.expedition.team.members.find((member) => member.role === "survey technician");
  const conflicted = bundle(run, { submission_id:"equipment-conflict", coworker_attempts:[{ actor:survey.personnel_id, action:"USE", target:"open-passage", equipment:"survey-instrument" }] });
  const before = canonicalSnapshot(run); const result = bootstrap.resolveCoordinatedAttempts(run, conflicted);
  assert.equal(result.ok, false); assert.equal(result.error.code, "COORDINATED_RESOURCE_CONFLICT"); assert.deepEqual(canonicalSnapshot(run), before);
});

test("successful coordinated state survives reload and single-actor paths remain available", () => {
  const { appDataPath, service, world, entry } = fixture("coordinated-persistence"); const run = entry.run; const player = run.session.startup.player.observer_id;
  const survey = run.expedition.team.members.find((member) => member.role === "survey technician");
  assert.equal(equipment.transfer(run.expedition, "survey-instrument", survey.personnel_id, player).ok, true);
  assert.equal(bootstrap.resolveCoordinatedAttempts(run, bundle(run, { submission_id:"persisted-coordination" })).ok, true);
  const expected = structuredClone({ coordinated:run.expedition.coordinated_attempts, evidence:run.expedition.evidence, history:run.expedition.history, object_state:run.object_state, clock:run.expedition.clock });
  service.persistSession(service.getWorld(world.id), "field-researcher", entry); service.shutdown();
  const restarted = new DesktopService({ appDataPath }); assert.equal(restarted.resumeSession({ world_id:world.id, mode:"field-researcher" }).ok, true);
  const restored = restarted.session(world.id, "field-researcher").run;
  assert.deepEqual({ coordinated:restored.expedition.coordinated_attempts, evidence:restored.expedition.evidence, history:restored.expedition.history, object_state:restored.object_state, clock:restored.expedition.clock }, expected);

  const single = fixture("single-actor-paths").entry.run; const singlePlayer = single.session.startup.player.observer_id;
  const singleSurvey = single.expedition.team.members.find((member) => member.role === "survey technician");
  assert.equal(bootstrap.act(single, "USE", "survey-instrument").ok, true);
  assert.equal(single.expedition.evidence.some((item) => item.type === "passage-depth-measurement"), true);
  const coworkerOrder = bootstrap.act(single, "ORDER_HOLD", singleSurvey.personnel_id);
  assert.equal(coworkerOrder.ok, true);
  assert.equal(coworkerOrder.result.order.recipient, singleSurvey.personnel_id);
  assert.equal(single.session.startup.player.observer_id, singlePlayer);
});
