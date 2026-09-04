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

function enterField(service, world) {
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) phase(service, world, action);
  assert.equal(service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, four personnel accounted for outside the Threshold. Radio check." }).ok, true);
  phase(service, world, "CROSS");
  return service.session(world.id, "field-researcher");
}

function returnToReport(service, world) {
  const entry = service.session(world.id, "field-researcher");
  if (entry.phase.phase_id !== "RETURN") phase(service, world, "ABORT");
  for (let guard = 0; entry.run.spatial.player_location !== "threshold-side-entry" && guard < 4; guard += 1) {
    const projection = service.getGameplayProjection({ world_id:world.id, mode:"field-researcher" }).projection;
    const desired = entry.run.spatial.player_location === "open-passage" ? "Utility Room" : "Threshold-Side Entry";
    const target = projection.available_actions.find((action) => action.type === "MOVE")?.targets.find((item) => item.label.includes(desired));
    assert.ok(target, `expected a confirmed return route to ${desired}`);
    const moved = service.submitAction({ world_id:world.id, mode:"field-researcher", action:"MOVE", target:target.ref });
    assert.equal(moved.ok, true, moved.error?.message);
  }
  assert.equal(entry.run.spatial.player_location, "threshold-side-entry");
  const closed = phase(service, world, "COMPLETE_RETURN");
  assert.equal(closed.projection.phase.phase_id, "REPORT");
  assert.equal(entry.run.expedition.return_processing.evidence_custody_completed, true);
  assert.equal(entry.run.expedition.institutional_closure_ingested, undefined);
  return closed;
}

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

test("returned evidence, player report, and institutional assessment remain separate through reload", async () => {
  const { appDataPath, service, world } = fixture();
  const entry = enterField(service, world);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"MOVE", target:"open passage" }).ok, true);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"USE", target:"survey-instrument" }).ok, true);
  const evidence = entry.run.expedition.evidence.find((item) => item.type === "passage-depth-measurement");
  assert.ok(evidence);
  returnToReport(service, world);
  const missionId = entry.run.expedition.mission.id;
  const custody = service.getWorld(world.id).q4_evidence_archive.records[evidence.id];
  assert.equal(custody.standard_available, true);
  assert.equal(custody.custody.state, "archived");
  assert.deepEqual(custody.measurement, evidence.measurement);
  assert.equal(service.getWorld(world.id).q4_reviews?.[missionId], undefined, "institutional closure must wait for the player's written claim");
  service.shutdown();

  const restarted = new DesktopService({ appDataPath });
  const resumed = restarted.resumeSession({ world_id:world.id, mode:"field-researcher" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.projection.phase.phase_id, "REPORT");
  assert.equal(resumed.projection.q4.written_report, null);
  const submitted = await restarted.submitNatural({ world_id:world.id, mode:"field-researcher", text:"The Open Passage measured 18.0 metres from the south-wall datum. This conflicts with layout sheet 17-B and requires review." });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.projection.phase.phase_id, "DEBRIEF");
  assert.equal(submitted.result.turn_status, "REPORT_SUBMITTED");
  assert.equal(submitted.result.institutional_assessment.status, "provisional-spatial-discrepancy");
  assert.deepEqual(submitted.result.institutional_assessment.basis.evidence_ids, [evidence.id]);
  assert.equal(submitted.projection.q4.review.written_report.text, "The Open Passage measured 18.0 metres from the south-wall datum. This conflicts with layout sheet 17-B and requires review.");
  assert.equal(submitted.projection.q4.review.institutional_findings.reference_assessment.claims_cause, false);
});

test("contrasting report paths preserve unresolved claim and omission outcomes", async () => {
  const claimed = fixture();
  enterField(claimed.service, claimed.world);
  returnToReport(claimed.service, claimed.world);
  const weak = await claimed.service.submitNatural({ world_id:claimed.world.id, mode:"field-researcher", text:"I believe the layout contains a discrepancy, but we returned without a measurement." });
  assert.equal(weak.result.institutional_assessment.status, "unresolved-field-claim");
  assert.deepEqual(weak.result.institutional_assessment.basis.evidence_ids, []);
  assert.ok(claimed.service.getWorld(claimed.world.id).institutional_response.uncertain_claims.some((item) => item.provenance.id === weak.result.report_id));

  const omitted = fixture();
  enterField(omitted.service, omitted.world);
  returnToReport(omitted.service, omitted.world);
  const routine = await omitted.service.submitNatural({ world_id:omitted.world.id, mode:"field-researcher", text:"The team returned accounted for. No additional spatial finding is entered in this report." });
  assert.equal(routine.result.institutional_assessment.status, "no-spatial-discrepancy-entered");
  assert.deepEqual(routine.result.institutional_assessment.basis.evidence_ids, []);
  assert.equal(routine.projection.q4.review.written_report.kind, "player-authored-claim");
  assert.equal(reference.deriveContradiction(omitted.service.session(omitted.world.id, "field-researcher").run).established, false);
});
