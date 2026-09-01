"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const history = require("../tools/world-history");
const personnel = require("../tools/q4-personnel");
const reference = require("../tools/reference-expedition");

function fixture() {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-reference-expedition-"));
  const service = new DesktopService({ appDataPath });
  const world = service.createWorld({ name:"Reference Expedition", seed:"reference-expedition" }).world;
  assert.equal(service.createQ4Personnel({ world_id:world.id, first_name:"Jack", last_name:"Rocha" }).ok, true);
  const started = service.startSession({ world_id:world.id, mode:"field-researcher", seed:"reference-seed", require_personnel:true, scenario:"reference-expedition" });
  assert.equal(started.ok, true);
  return { appDataPath, service, world, started };
}

function phase(service, world, action) { const result = service.submitAction({ world_id:world.id, mode:"field-researcher", action }); assert.equal(result.ok, true); return result; }

test("DesktopService defaults field-researcher starts to generic procedural survey", () => {
  const service = new DesktopService({ appDataPath:fs.mkdtempSync(path.join(os.tmpdir(), "yb-default-expedition-")) });
  const world = service.createWorld({ name:"Default Expedition", seed:"default-expedition" }).world;
  assert.equal(service.createQ4Personnel({ world_id:world.id, first_name:"Default", last_name:"Researcher" }).ok, true);
  const started = service.startSession({ world_id:world.id, mode:"field-researcher", seed:"default-seed", require_personnel:true });
  assert.equal(started.ok, true);
  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.run.scenario, "async-clear-q4-procedural-survey");
  assert.equal(entry.run.expedition.mission.specimen_id, undefined);
  assert.equal(entry.run.spatial.reference_expedition, undefined);
});

test("fresh Reference Expedition is a four-person authored specimen while generic staffing remains variable", () => {
  const { service, world, started } = fixture();
  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.run.scenario, reference.RUNTIME_SCENARIO);
  assert.equal(entry.run.expedition.mission.specimen_id, reference.definition.id);
  assert.equal(entry.run.expedition.team.members.length, 4);
  assert.equal(entry.run.expedition.team.members.filter((member) => member.personnel_id !== entry.run.session.startup.player.observer_id).length, 3);
  assert.deepEqual(entry.run.expedition.team.members.filter((member) => member.personnel_id !== entry.run.session.startup.player.observer_id).map((member) => member.role).sort(), ["documentation specialist", "route specialist", "survey technician"]);
  assert.deepEqual(entry.run.expedition.mission.assigned_personnel, entry.run.expedition.team.members.map((member) => member.personnel_id));
  assert.equal(started.projection.q4.team.length, 4);

  const genericWorld = history.createWorld({ id:"generic-q4-staffing", seed:"generic-q4-staffing" });
  const genericPlayer = personnel.createPlayer(genericWorld, { first_name:"Generic", last_name:"Researcher" }).player.identity;
  const generic = bootstrap.startRun({ profile:"field-researcher", scenario:"procedural-survey", seed:"generic-seed", world:genericWorld, player_identity:genericPlayer, spatial_worldpack:"clear-q4" });
  assert.equal(generic.ok, true);
  assert.ok(generic.run.expedition.team.members.length >= 3 && generic.run.expedition.team.members.length <= 5);
  assert.notEqual(generic.run.scenario, reference.RUNTIME_SCENARIO);
  assert.equal(generic.run.spatial.reference_expedition, undefined);
  const legacySave = bootstrap.saveRun(generic.run);
  legacySave.version = "yellow-beast-save@v8";
  const legacy = bootstrap.resumeRun(legacySave, { world:genericWorld, spatial_worldpack:"clear-q4" });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.run.spatial.reference_expedition, undefined);
  assert.notEqual(legacy.run.scenario, reference.RUNTIME_SCENARIO);
});

test("objective geometry precedes observation and only qualified evidence supports a derived contradiction", () => {
  const { service, world, started } = fixture();
  let entry = service.session(world.id, "field-researcher");
  const truthBefore = structuredClone(entry.run.spatial.reference_expedition.canonical_geometry);
  assert.equal(truthBefore.current_passage.depth_m, 18);
  assert.deepEqual(truthBefore.parallel_corridor_volume.axis_interval_m, [14, 18.5]);
  assert.equal(truthBefore.euclidean_relation.overlap_depth_m, 4);
  const prior = entry.run.expedition.mission.prior_history[0];
  assert.equal(prior.recorded_passage_depth_m, 9.5);
  assert.equal(prior.recorded_clearance_m, 4.5);
  assert.notEqual(prior.recorded_passage_depth_m, truthBefore.current_passage.depth_m);
  assert.equal(JSON.stringify(started.projection).includes("18.0 metres"), false);
  assert.equal(reference.deriveContradiction(entry.run).established, false);
  assert.equal(entry.run.expedition.evidence.length, 0);
  assert.equal(entry.run.expedition.team.members.some((member) => member.belief || member.conclusion), false);

  phase(service, world, "READY");
  phase(service, world, "PROCEED");
  phase(service, world, "APPROACH");
  phase(service, world, "READY");
  const statement = "Standard, Reference team at Threshold. Four personnel accounted for. Radio check.";
  assert.equal(service.submitQ4Communication({ world_id:world.id, channel:"standard", text:statement }).ok, true);
  phase(service, world, "CROSS");
  entry = service.session(world.id, "field-researcher");
  assert.equal(entry.phase.phase_id, "FIELD_OPERATION");
  assert.equal(entry.run.expedition.team.members.length, 4);
  assert.equal(entry.run.spatial.route_history.filter((item) => item.connection_id === "threshold-crossing").length, 1);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"MOVE", target:"open passage" }).ok, true);

  entry = service.session(world.id, "field-researcher");
  const priorMap = entry.run.expedition.mission.prior_history.find((item) => item.id === reference.definition.prior_record.id);
  assert.ok(priorMap);
  assert.equal(entry.run.expedition.evidence.length, 0);
  assert.equal(reference.deriveContradiction(entry.run).established, false);
  const measured = service.submitAction({ world_id:world.id, mode:"field-researcher", action:"USE", target:"survey-instrument" });
  assert.equal(measured.ok, true);
  entry = service.session(world.id, "field-researcher");
  assert.deepEqual(entry.run.spatial.reference_expedition.canonical_geometry, truthBefore);
  const evidence = entry.run.expedition.evidence.find((item) => item.type === "passage-depth-measurement");
  const instrumentHolder = entry.run.expedition.equipment["survey-instrument"].holder;
  assert.notEqual(instrumentHolder, entry.run.session.startup.player.observer_id);
  assert.equal(entry.run.spatial.personnel_locations[instrumentHolder], entry.run.spatial.player_location);
  assert.equal(evidence.operator, instrumentHolder);
  assert.equal(evidence.creator, instrumentHolder);
  assert.equal(evidence.custodian, instrumentHolder);
  assert.deepEqual(evidence.measurement, { kind:"passage-depth", value:18, unit:"metre", datum_id:"open-passage-south-wall-datum" });
  assert.equal(evidence.reporting_state, "unreported");
  assert.equal(evidence.available_to_standard, false);
  const derived = reference.deriveContradiction(entry.run);
  assert.equal(derived.established, true);
  assert.equal(derived.basis.current_evidence_id, evidence.id);
  assert.equal(derived.basis.prior_record_id, prior.id);
  assert.equal(derived.overlap_depth_m, 4);
  assert.equal(entry.run.expedition.team.members.some((member) => member.belief || member.conclusion), false);
});

test("the party may return without observing, deriving, or reporting the discrepancy", () => {
  const { service, world } = fixture();
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) phase(service, world, action);
  assert.equal(service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, four accounted for. Radio check." }).ok, true);
  phase(service, world, "CROSS");
  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.run.expedition.evidence.some((item) => item.type === "passage-depth-measurement"), false);
  assert.equal(reference.deriveContradiction(entry.run).established, false);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"ABORT" }).ok, true);
  assert.equal(entry.run.expedition.evidence.some((item) => item.type === "passage-depth-measurement"), false);
  assert.equal(entry.run.expedition.messages.some((item) => /overlap|intrud|contradiction|anomal/i.test(item.text ?? "")), false);
});

test("Reference geometry, prior record, evidence, and party survive restart without forced reporting", () => {
  const { appDataPath, service, world } = fixture();
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) phase(service, world, action);
  assert.equal(service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, four accounted for. Radio check." }).ok, true);
  phase(service, world, "CROSS");
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"MOVE", target:"open passage" }).ok, true);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"USE", target:"survey-instrument" }).ok, true);
  const before = service.session(world.id, "field-researcher");
  const snapshot = structuredClone({ scenario:before.run.scenario, team:before.run.expedition.team, geometry:before.run.spatial.reference_expedition, prior:before.run.expedition.mission.prior_history, evidence:before.run.expedition.evidence });
  assert.equal(before.run.expedition.evidence.every((item) => item.reporting_state === "unreported"), true);
  service.shutdown();

  const restarted = new DesktopService({ appDataPath });
  assert.equal(restarted.resumeSession({ world_id:world.id, mode:"field-researcher" }).ok, true);
  const after = restarted.session(world.id, "field-researcher");
  assert.deepEqual({ scenario:after.run.scenario, team:after.run.expedition.team, geometry:after.run.spatial.reference_expedition, prior:after.run.expedition.mission.prior_history, evidence:after.run.expedition.evidence }, snapshot);
  assert.equal(reference.deriveContradiction(after.run).established, true);
  assert.equal(after.run.expedition.team.members.some((member) => member.belief || member.conclusion), false);
  assert.equal(restarted.submitAction({ world_id:world.id, mode:"field-researcher", action:"ABORT" }).ok, true);
  assert.equal(after.run.expedition.evidence.every((item) => item.reporting_state === "unreported"), true);
});
