"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const history = require("../tools/world-history");
const evidence = require("../tools/q4-evidence-authority");

function fixture() {
  const world = history.createWorld({ seed:"evidence-archive" });
  history.instantiateCharacter(world, { run_id:"setup", identity:"operator", display_name:"Operator", role:"field researcher", authority:"test" });
  history.instantiateCharacter(world, { run_id:"setup", identity:"custodian", display_name:"Custodian", role:"documentation", authority:"test" });
  const run_id = history.beginRun(world, { profile:"field-researcher", scenario:"field", seed:"evidence" });
  return { world, run:{ run_id, session:{ startup:{ player:{ observer_id:"operator" } } }, expedition:{ mission:{ id:"CQ4-TEST-1" }, clock:{ interval:4 }, evidence:[] } } };
}
function item(id = "CQ4-E-TEST-01") { return { id, type:"photographic-record", creator:"operator", custodian:"operator", source_object:"fixture", source_location:"utility-room", source_location_name:"Utility Room", capture_event:"object.evidence.captured", method:"35mm photograph", device_id:"camera-04", device:"CAM-04", captured_at:{ interval:4 }, visible_objects:["fluorescent fixture"], target_observation:"active intact fixture", provenance:"worldpack-authored-object-interaction", available_to_player:true, available_to_standard:false }; }

test("photographic evidence has stable provenance and presentation-only render input", () => {
  const { world, run } = fixture(); const raw = item(); const record = evidence.capture(world, run, raw);
  assert.equal(record.id, "CQ4-E-TEST-01"); assert.equal(record.creator, "operator"); assert.equal(record.operation_id, "CQ4-TEST-1"); assert.equal(record.location, "utility-room"); assert.equal(record.equipment.id, "camera-04"); assert.equal(record.timestamp.interval, 4); assert.equal(record.source.object_id, "fixture"); assert.equal(record.standard_available, false); assert.equal(record.render_spec.source, "canonical-evidence-record"); assert.doesNotMatch(JSON.stringify(record.render_spec), /hidden|trajectory/i);
});
test("custody and Standard availability remain distinct", () => {
  const { world, run } = fixture(); evidence.capture(world, run, item()); evidence.transfer(world, "CQ4-E-TEST-01", { state:"carried", holder:"custodian", at:{interval:5} }); evidence.transfer(world, "CQ4-E-TEST-01", { state:"lost", holder:null, at:{interval:6} });
  let record = evidence.archive(world).records[0]; assert.equal(record.custody.state, "lost"); assert.equal(record.standard_available, false); assert.equal(record.custody.history.length, 3);
  evidence.returnToStandard(world, record.id, {interval:8}); record = evidence.archive(world, { observer:"standard" }).records[0]; assert.equal(record.custody.state, "archived"); assert.equal(record.standard_available, true);
});
test("archive hides unavailable evidence and retains simulation-authored conflicts", () => {
  const { world, run } = fixture(); evidence.capture(world, run, item("CQ4-E-ONE")); evidence.capture(world, run, item("CQ4-E-TWO")); evidence.returnToStandard(world, "CQ4-E-ONE"); evidence.contradict(world, { left:"CQ4-E-ONE", right:"CQ4-E-TWO", claim:"fixture condition", source:"canonical comparison" });
  const standard = evidence.archive(world, { observer:"standard" }); assert.deepEqual(standard.records.map((record) => record.id), ["CQ4-E-ONE"]); assert.equal(standard.contradictions.length, 0);
  const player = evidence.archive(world); assert.equal(player.records.length, 2); assert.equal(player.contradictions[0].claim, "fixture condition"); assert.equal(evidence.validate(world).ok, true);
});
test("legacy evidence rejects missing custody, provenance, or access without mutation and accepts a well-formed control", () => {
  const legacyWorld = (seed) => {
    const world = history.createWorld({ seed });
    history.instantiateCharacter(world, { run_id:"legacy-setup", identity:"operator", display_name:"Operator", role:"field researcher", authority:"legacy-record" });
    delete world.canonical_shape_version;
    delete world.storage_migrations;
    delete world.q4_evidence_archive;
    world.evidence.legacy = { id:"legacy", type:"field-note", creator:"operator", origin_run:"legacy-run", custody:[{ holder:"operator", event:"created" }], availability:"observer-held", provenance:"preserved-legacy-field-note", available_to_player:true };
    return world;
  };

  const corruptions = [
    (record) => { record.custody = []; },
    (record) => { delete record.provenance; },
    (record) => { delete record.available_to_player; }
  ];
  for (const corrupt of corruptions) {
    const input = legacyWorld("legacy-evidence-invalid");
    corrupt(input.evidence.legacy);
    const before = structuredClone(input);
    assert.throws(() => history.migrateWorld(input), { code:"EVIDENCE_ARCHIVE_INVALID" });
    assert.deepEqual(input, before);
    assert.equal(input.q4_evidence_archive, undefined);
  }

  const control = legacyWorld("legacy-evidence-control");
  const controlBefore = structuredClone(control);
  const migrated = history.migrateWorld(control);
  assert.deepEqual(control, controlBefore);
  assert.deepEqual(evidence.validate(migrated), { ok:true, broken:[] });
  const record = migrated.q4_evidence_archive.records.legacy;
  assert.equal(record.method, "unknown / legacy record");
  assert.equal(record.provenance.source, "preserved-legacy-field-note");
  assert.deepEqual(record.custody.history, control.evidence.legacy.custody);
  assert.equal(record.custody.state, "observer-held");
  assert.equal(record.player_access, true);
  assert.equal(record.standard_available, false);
  assert.deepEqual(evidence.archive(migrated, { observer:"standard" }).records, []);
});
