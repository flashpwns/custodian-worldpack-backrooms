"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const history = require("../tools/world-history");
const bootstrap = require("../tools/run-bootstrap");
const assignments = require("../tools/q4-assignment-engine");
const institution = require("../tools/institutional-runtime");
const frontier = require("../tools/survey-frontier");
const spatial = require("../data/worldpacks/clear-q4/spatial.json");
const institutionDefinition = require("../data/worldpacks/clear-q4/institution.json");

function world(seed) { return history.createWorld({ seed }); }
function reportedRoute(seed = "reported-route") {
  const value = world(seed); const state = frontier.create(spatial, { player: "observer" });
  frontier.observe(state, spatial, "observer", "utility-room", { at: 1 });
  frontier.report(state, "observer", { at: 2, message_id: "delivered-route" }); value.q4_survey_frontier = state;
  return value;
}
function lostEquipment(seed = "lost-equipment") {
  const value = world(seed); value.q4_equipment = { "q4-camera-lost": { id: "q4-camera-lost", label: "35mm field camera", type: "35mm-camera", state: "abandoned", location: "utility-room" } };
  institution.ensure(value, institutionDefinition);
  institution.ingest(value, null, institutionDefinition, { type: "equipment-loss", state: "confirmed", summary: "Returned equipment record identifies the camera as unrecovered.", facts: [{ kind: "equipment-outcome", id: "q4-camera-lost", state: "abandoned" }], provenance: { kind: "recovered-equipment-record", id: "camera-loss-record" } });
  return value;
}

test("routine frontier work is issued from a real declared boundary and starts through the fixed Threshold", () => {
  const value = world("routine-history"); const started = bootstrap.startRun({ profile: "field-researcher", seed: "routine-run", scenario: "procedural-survey", world: value, spatial_worldpack: "clear-q4" });
  assert.equal(started.ok, true); assert.equal(started.run.expedition.mission.family, "routine-survey");
  assert.equal(started.run.expedition.mission.site.location_id, "utility-room"); assert.equal(started.run.expedition.mission.site.kind, "known-area");
  bootstrap.setSpatialPhase(started.run, "THRESHOLD"); assert.equal(started.run.spatial.player_location, "threshold-room");
  assert.equal(assignments.ensure(value).work_orders[started.run.expedition.mission.id].source_condition.type, "routine-frontier");
});

test("a known lost item produces one recovery order and successful recovery resolves its source condition", () => {
  const value = lostEquipment(); const issued = assignments.issue(value, { seed: "recovery", selection_context: "recovery" });
  assert.equal(issued.ok, true); assert.equal(issued.work_order.archetype, "equipment-recovery"); assert.equal(issued.mission.site.equipment_id, "q4-camera-lost"); assert.equal(issued.mission.site.location_id, "utility-room");
  value.q4_equipment["q4-camera-lost"].state = "operational";
  assert.equal(assignments.resolve(value, issued.work_order.id, { completed: true }).resolved, true);
  assert.equal(assignments.deriveConditions(value).some((entry) => entry.archetype === "equipment-recovery"), false);
});

test("a delivered unconfirmed route produces corroboration work without exposing unreported player knowledge", () => {
  const delivered = reportedRoute("route-history"); const issued = assignments.issue(delivered, { seed: "route", selection_context: "route" });
  assert.equal(issued.work_order.archetype, "route-verification"); assert.ok(["entry-to-utility", "utility-to-passage"].includes(issued.work_order.target.connection_id));
  assert.match(issued.mission.rationale, /delivered but unconfirmed/i);
  const privateObservation = world("private-route"); const state = frontier.create(spatial, { player: "observer" }); frontier.observe(state, spatial, "observer", "utility-room", { at: 1 }); privateObservation.q4_survey_frontier = state;
  assert.equal(assignments.deriveConditions(privateObservation).some((entry) => entry.archetype === "route-verification"), false);
});

test("different canonical histories produce different legitimate work", () => {
  const routine = assignments.issue(world("history-a"), { selection_context: "same" });
  const recovery = assignments.issue(lostEquipment("history-b"), { selection_context: "same" });
  const route = assignments.issue(reportedRoute("history-c"), { selection_context: "same" });
  assert.deepEqual([routine.work_order.archetype, recovery.work_order.archetype, route.work_order.archetype], ["routine-survey", "equipment-recovery", "route-verification"]);
});

test("selection is deterministic, stale candidates are revalidated, and issued work survives run reload", () => {
  const a = reportedRoute("deterministic"); const b = reportedRoute("deterministic");
  assert.equal(assignments.select(assignments.deriveConditions(a), "selection").selection_key, assignments.select(assignments.deriveConditions(b), "selection").selection_key);
  const stale = lostEquipment("stale"); const reevaluated = assignments.issue(stale, { selection_context: "stale", before_commit: (current) => { current.q4_equipment["q4-camera-lost"].state = "operational"; } });
  assert.equal(reevaluated.work_order.archetype, "routine-survey"); assert.equal(Object.hasOwn(assignments.ensure(stale).conditions, "lost-equipment:q4-camera-lost"), false);
  const persistent = world("save-reload"); const started = bootstrap.startRun({ profile: "field-researcher", seed: "save-run", scenario: "procedural-survey", world: persistent, spatial_worldpack: "clear-q4" }); const saved = bootstrap.saveRun(started.run); const restoredWorld = structuredClone(persistent); const restored = bootstrap.resumeRun(saved, { world: restoredWorld, spatial_worldpack: "clear-q4" });
  assert.equal(restored.ok, true); assert.equal(restored.run.expedition.mission.id, started.run.expedition.mission.id); assert.ok(restoredWorld.q4_assignment_state.work_orders[started.run.expedition.mission.id]);
});
